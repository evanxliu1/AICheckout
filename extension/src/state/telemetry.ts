// The worker side of consented usage reporting (Phase 15.3, plan §5 and the decisions of 2026-10-10 and
// 2026-10-19). Events are built here, in the worker, from what it already holds, validated against the API's
// own contract, queued in `chrome.storage.local` and flushed by the `telemetry-flush` alarm through the
// fixed-URL sender. Nothing is queued before the shopper chooses Share, except the two tap events, which are
// the shopper's own action and carry no id when sharing is off. Content scripts never reach this module.
import { telemetryEventSchema, TELEMETRY_LIMITS } from '@ai-checkout/catalog-review/telemetry';
import type { TelemetryEvent } from '@ai-checkout/catalog-review/telemetry';
import type { EventSender } from '@ai-checkout/catalog-client';
import { GENERIC_READER_VERSION } from '../checkout/merchants';
import { localDate, TELEMETRY_KEY } from './keys';
import {
  daysSinceInstallBucket,
  emptyTelemetryState,
  installMonth,
  TELEMETRY_CONSENT_VERSION,
  TELEMETRY_ERRORS_PER_DAY,
  TELEMETRY_FLUSH_ALARM,
  TELEMETRY_FLUSH_AT,
  TELEMETRY_FLUSH_MINUTES,
  TELEMETRY_PAUSE_MS,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_RETRY_MAX_MS,
  TELEMETRY_RETRY_MS,
  TELEMETRY_SEND_TIMEOUT_MS,
  telemetryStateSchema,
} from './telemetry-contracts';
import type { TelemetryState, TelemetryStatus } from './telemetry-contracts';

/** An event as a caller describes it: the type and its own fields; the worker adds the envelope. */
export type EventInput = {
  [T in TelemetryEvent['type']]: Omit<
    Extract<TelemetryEvent, { type: T }>,
    | 'event_id'
    | 'client_at'
    | 'install_id'
    | 'install_month'
    | 'days_since_install'
    | 'consent_version'
    | 'schema_version'
    | 'extension_version'
    | 'catalog_version'
    | 'merchants_version'
    | 'reader_version'
  >;
}[TelemetryEvent['type']];
export type TapInput = Extract<EventInput, { type: 'store_suggested' | 'problem_reported' }>;
export type AutomaticInput = Exclude<EventInput, TapInput>;

export interface TelemetryAlarms {
  get: (name: string) => Promise<{ name: string } | undefined>;
  create: (name: string, info: { delayInMinutes?: number; periodInMinutes?: number }) => Promise<void> | void;
  clear: (name: string) => Promise<boolean> | boolean;
}
export interface TelemetryDeps {
  local: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  };
  /** Undefined in a build without `VITE_TELEMETRY`: nothing is queued and nothing is sent. */
  client?: EventSender;
  alarms?: TelemetryAlarms;
  clock?: () => number;
  /** The catalog and merchant release versions in effect (the envelope). */
  versions: () => Promise<{ catalog: string; merchants: string }>;
  extensionVersion: string;
  randomUUID?: () => string;
}
/** What `consent(true)` records besides the consent itself: the wallet owned (`wallet_changed`, so a new id
 * starts with the cards known) and, from the onboarding screen, `onboarding_completed`. */
export interface ConsentContext {
  cardIds: string[];
  onboarding: boolean;
}
export type DeleteOutcome = 'deleted' | 'nothing-to-delete' | 'unavailable';

const SEND_BYTES = TELEMETRY_LIMITS.batchBytes;
const RETRY_STATUSES = new Set([429, 503]);

export function createTelemetry({
  local,
  client,
  alarms,
  clock = Date.now,
  versions,
  extensionVersion,
  randomUUID = () => crypto.randomUUID(),
}: TelemetryDeps) {
  let queue = Promise.resolve<unknown>(undefined);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async function read(): Promise<TelemetryState> {
    const parsed = telemetryStateSchema.safeParse((await local.get(TELEMETRY_KEY))[TELEMETRY_KEY]);
    return parsed.success ? parsed.data : emptyTelemetryState();
  }
  const write = (state: TelemetryState) => local.set({ [TELEMETRY_KEY]: state });
  const enabled = !!client;

  /** The queue's alarm: created once while events wait, cleared when none do. */
  async function syncAlarm(state: TelemetryState) {
    if (!alarms) return;
    try {
      if (state.queue.length === 0) await alarms.clear(TELEMETRY_FLUSH_ALARM);
      else if (!(await alarms.get(TELEMETRY_FLUSH_ALARM)))
        await alarms.create(TELEMETRY_FLUSH_ALARM, {
          delayInMinutes: TELEMETRY_FLUSH_MINUTES,
          periodInMinutes: TELEMETRY_FLUSH_MINUTES,
        });
    } catch {
      // Without the alarm the queue still flushes at 50 events, at consent and on each tap.
    }
  }
  /** Builds and validates one event; null when the API's contract would refuse it (then it is never sent). */
  async function build(
    input: EventInput,
    state: TelemetryState,
    installId: string | null,
    now: number,
  ): Promise<TelemetryEvent | null> {
    const since = state.installedAt ?? now;
    let inEffect: { catalog: string; merchants: string };
    try {
      inEffect = await versions();
    } catch {
      return null;
    }
    const candidate = {
      ...input,
      event_id: randomUUID(),
      client_at: new Date(now).toISOString(),
      install_id: installId,
      install_month: installMonth(since),
      days_since_install: daysSinceInstallBucket(since, now),
      consent_version: TELEMETRY_CONSENT_VERSION,
      schema_version: 1,
      extension_version: extensionVersion,
      catalog_version: inEffect.catalog,
      merchants_version: inEffect.merchants,
      reader_version: GENERIC_READER_VERSION,
    };
    const parsed = telemetryEventSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  /** Appends to the queue (oldest dropped beyond the cap) and writes. */
  async function enqueue(state: TelemetryState, events: TelemetryEvent[]): Promise<TelemetryState> {
    const next = { ...state, queue: [...state.queue, ...events].slice(-TELEMETRY_QUEUE_MAX) };
    await write(next);
    await syncAlarm(next);
    return next;
  }

  /** One flush: the oldest events that fit one request. Serialised with every other operation. */
  async function flushNow(): Promise<void> {
    if (!client) return;
    const state = await read();
    const now = clock();
    if (state.queue.length === 0) return;
    if ((state.pausedUntil ?? 0) > now || (state.retryAt ?? 0) > now) return;
    const batch: TelemetryEvent[] = [];
    let bytes = 2 + '"events":[]'.length;
    for (const event of state.queue.slice(0, TELEMETRY_LIMITS.batchEvents)) {
      const size = JSON.stringify(event).length + 1;
      if (batch.length && bytes + size > SEND_BYTES) break;
      batch.push(event);
      bytes += size;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEMETRY_SEND_TIMEOUT_MS);
    let result: Awaited<ReturnType<EventSender['send']>>;
    try {
      result = await client.send({ events: batch }, controller.signal);
    } catch {
      // Offline or the service asleep: the next alarm tries again.
      return;
    } finally {
      clearTimeout(timer);
    }
    const sent = new Set(batch.map((e) => e.event_id));
    const remaining = state.queue.filter((e) => !sent.has(e.event_id));
    let next: TelemetryState;
    if (result.status >= 200 && result.status < 300) next = { ...state, queue: remaining, retryAt: null };
    else if (result.status === 410)
      // The kill switch: nothing is sent for a week, and nothing waits for it.
      next = { ...state, queue: [], pausedUntil: now + TELEMETRY_PAUSE_MS, retryAt: null };
    else if (RETRY_STATUSES.has(result.status) || result.status >= 500)
      next = {
        ...state,
        retryAt: now + Math.min(result.retryAfterMs ?? TELEMETRY_RETRY_MS, TELEMETRY_RETRY_MAX_MS),
      };
    // Any other refusal (400 schema, 403 origin, 413): the batch would never be accepted; drop it.
    else next = { ...state, queue: remaining };
    await write(next);
    await syncAlarm(next);
  }

  const status = (state: TelemetryState): TelemetryStatus => ({ enabled, consent: state.consent });

  return {
    enabled,
    status: () => serial(async () => status(await read())),
    /** An automatic event: queued only while sharing is on, built from the caller's fields and the envelope. */
    record: (input: AutomaticInput) =>
      serial(async () => {
        if (!client) return;
        const state = await read();
        if (state.consent !== 'granted' || !state.installId) return;
        const now = clock();
        let counted = state;
        if (input.type === 'error') {
          const day = localDate(now);
          const count = state.errorDay === day ? state.errorCount : 0;
          if (count >= TELEMETRY_ERRORS_PER_DAY) return;
          counted = { ...state, errorDay: day, errorCount: count + 1 };
        }
        const event = await build(input, counted, counted.installId, now);
        if (!event) {
          if (counted !== state) await write(counted);
          return;
        }
        const next = await enqueue(counted, [event]);
        if (next.queue.length >= TELEMETRY_FLUSH_AT) await flushNow();
      }),
    /** A tap event (Suggest this store, Report a problem): sent whether sharing is on or not, with the id only
     * when it is; flushed at once. Returns false when the event could not be built (an address the contract
     * refuses). */
    recordTap: (input: TapInput): Promise<boolean> =>
      serial(async () => {
        if (!client) return false;
        let state = await read();
        if (state.installedAt === null) {
          // The anchor for `install_month` and the day bucket when no id exists: this first tap's time.
          state = { ...state, installedAt: clock() };
          await write(state);
        }
        const event = await build(
          input,
          state,
          state.consent === 'granted' ? state.installId : null,
          clock(),
        );
        if (!event) return false;
        await enqueue(state, [event]);
        await flushNow();
        return true;
      }),
    /** Share (true): a new random id unless one exists, `consent_granted` first, then the onboarding funnel and
     * the wallet when given; flushed at once. Not now or Stop sharing (false): the queue and the id are cleared
     * and nothing is sent. */
    consent: (granted: boolean, context?: ConsentContext) =>
      serial(async (): Promise<TelemetryStatus> => {
        const state = await read();
        if (!client) return status(state);
        const now = clock();
        if (!granted) {
          const next: TelemetryState = {
            ...state,
            consent: 'declined',
            installId: null,
            installedAt: state.installedAt ?? now,
            queue: [],
          };
          await write(next);
          await syncAlarm(next);
          return status(next);
        }
        const consenting: TelemetryState =
          state.consent === 'granted' && state.installId
            ? state
            : { ...state, consent: 'granted', installId: randomUUID(), installedAt: now, queue: [] };
        const inputs: AutomaticInput[] = [];
        if (consenting !== state) inputs.push({ type: 'consent_granted' });
        if (context?.onboarding)
          inputs.push({ type: 'onboarding_completed', cards_count: context.cardIds.length });
        if (context) inputs.push({ type: 'wallet_changed', card_ids: context.cardIds });
        const events: TelemetryEvent[] = [];
        for (const input of inputs) {
          const event = await build(input, consenting, consenting.installId, now);
          if (event) events.push(event);
        }
        const next = await enqueue(consenting, events);
        await flushNow();
        return status(next);
      }),
    /** Delete my data: the current id to `/v1/events/delete`; on success sharing stops and the id, the queue
     * are cleared (a new Share mints a new id). With no id there is nothing to delete beyond the queue. */
    deleteData: (): Promise<DeleteOutcome> =>
      serial(async () => {
        const state = await read();
        const reset = async (): Promise<void> => {
          const next: TelemetryState = { ...state, consent: 'declined', installId: null, queue: [] };
          await write(next);
          await syncAlarm(next);
        };
        if (!client || !state.installId) {
          await reset();
          return 'nothing-to-delete';
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TELEMETRY_SEND_TIMEOUT_MS);
        try {
          const result = await client.deleteInstall(state.installId, controller.signal);
          if (RETRY_STATUSES.has(result.status) || result.status >= 500) return 'unavailable';
        } catch {
          return 'unavailable';
        } finally {
          clearTimeout(timer);
        }
        await reset();
        return 'deleted';
      }),
    flush: () => serial(flushNow),
    /** The `telemetry-flush` alarm; other alarms are ignored. */
    onAlarm: (name: string) => (name === TELEMETRY_FLUSH_ALARM ? serial(flushNow) : Promise.resolve()),
  };
}
export type Telemetry = ReturnType<typeof createTelemetry>;
