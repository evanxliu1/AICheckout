import { useCallback, useEffect, useRef, useState } from 'react';
import { draftIdSchema, type ReviewQueue, type ReviewSummary } from '@ai-checkout/catalog-review';
import type { Catalog } from '@ai-checkout/rewards-core';
import { AlertInline, ApplicationState, Badge, Button } from '@ai-checkout/ui';
import { ReviewApiError, type ReviewApi } from './client';
import ExtractionPanel from './ExtractionPanel';
import { DraftPanel, type CaptureItem } from './DraftPanel';
import StartDraft from './StartDraft';

/** Consecutive rate-limit waits allowed for one capture before the bulk capture gives up. */
const MAX_RATE_LIMIT_WAITS = 10;
/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export default function ReviewWorkspace({
  api,
  bundled,
}: {
  api: ReviewApi;
  /** Catalogs offered by Start a new draft; defaults to the bundled ones. */
  bundled?: Catalog[];
}) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null),
    [detail, setDetail] = useState<ReviewSummary | null>(null);
  const [pending, setPending] = useState('Loading drafts…'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0),
    [dirty, setDirty] = useState(false),
    [starting, setStarting] = useState(false);
  const controller = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const busy = !!pending;
  const draftId = detail?.draft.id;
  // Stable per draft, so the memoized source list is not redrawn on every keystroke.
  const loadSource = useCallback(
    (sourceId: string, signal: AbortSignal) => api.source(draftId!, sourceId, signal),
    [api, draftId],
  );
  const showDetail = useCallback((value: ReviewSummary | null) => {
    setDetail(value);
    setGeneration((previous) => previous + 1);
    setDirty(false);
    if (value && new URLSearchParams(location.hash.slice(1)).get('draft') !== value.draft.id)
      history.replaceState(null, '', `#${value.draft.id}`);
  }, []);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void (async () => {
      try {
        const next = await api.queue(active.signal);
        const parsed = draftIdSchema.safeParse(
          new URLSearchParams(location.hash.slice(1)).get('draft') ?? location.hash.slice(1),
        );
        const selected = parsed.success ? parsed.data : next.drafts[0]?.id;
        const selectedDetail = selected ? await api.detail(selected, active.signal) : null;
        if (!active.signal.aborted) {
          setQueue(next);
          showDetail(selectedDetail);
        }
      } catch (failure) {
        if (!active.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Drafts could not be loaded. Try again.');
      } finally {
        if (!active.signal.aborted) setPending('');
      }
    })();
    return () => active.abort();
  }, [api, showDetail]);
  useEffect(() => {
    if (detail) heading.current?.focus({ preventScroll: true });
  }, [detail]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function perform(label: string, action: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setPending(label);
    setError('');
    setNotice('');
    try {
      await action(signal);
    } catch (failure) {
      if (!signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The action could not finish. Reload the draft.',
        );
    } finally {
      if (!signal.aborted) setPending('');
    }
  }
  async function refresh(id: string | undefined, signal: AbortSignal) {
    const nextQueue = await api.queue(signal);
    // Without an explicit draft, prefer the one in the URL (for example one just created).
    const fromHash = draftIdSchema.safeParse(location.hash.slice(1));
    const selected =
      id ??
      (fromHash.success && nextQueue.drafts.some((draft) => draft.id === fromHash.data)
        ? fromHash.data
        : nextQueue.drafts[0]?.id);
    const nextDetail = selected ? await api.detail(selected, signal) : null;
    if (!signal.aborted) {
      setQueue(nextQueue);
      showDetail(nextDetail);
    }
  }
  function load(id?: string) {
    if (dirty && !window.confirm('Discard unsaved draft or source edits and load the latest version?'))
      return;
    setStarting(false);
    void perform('Loading draft…', (signal) => refresh(id, signal));
  }
  async function update(catalog: Catalog, baseSequence: number | null) {
    if (!detail) return;
    await perform('Saving draft…', async (signal) => {
      await api.update(
        detail.draft.id,
        {
          catalog,
          baseSequence,
          sourceDocumentIds: detail.draft.source_document_ids,
          expectedRevision: detail.draft.revision,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted) setNotice('Draft saved. Review this new revision before publishing.');
    });
  }
  async function capture(sourceKey: string, body: string) {
    if (!detail) return;
    const source = detail.draft.catalog.sources.find((value) => value.id === sourceKey);
    if (!source) return;
    await perform('Capturing evidence…', async (signal) => {
      const doc = await api.capture(
        { sourceKey, title: source.title, url: source.url, checkedOn: source.checkedOn, body },
        signal,
      );
      const sourceDocumentIds = [
        ...detail.sources.filter((value) => value.source_key !== sourceKey).map((value) => value.id),
        doc.id,
      ];
      await api.update(
        detail.draft.id,
        {
          catalog: detail.draft.catalog,
          baseSequence: detail.draft.base_sequence,
          sourceDocumentIds,
          expectedRevision: detail.draft.revision,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted) setNotice('Evidence captured and attached to a new draft revision.');
    });
  }
  /** Captures several sources, then attaches them all in one new draft revision. */
  async function captureMany(items: CaptureItem[]) {
    if (!detail || !items.length) return;
    await perform(`Capturing ${items.length} sources…`, async (signal) => {
      const captured = new Map<string, string>();
      for (const [index, item] of items.entries()) {
        const source = detail.draft.catalog.sources.find((value) => value.id === item.sourceKey);
        if (!source) continue;
        if (items.length > 1) setPending(`Capturing source ${index + 1} of ${items.length}…`);
        const body = {
          sourceKey: source.id,
          title: source.title,
          url: source.url,
          checkedOn: source.checkedOn,
          body: item.body,
        };
        // `/sources` allows MAX_CAPTURES_PER_MINUTE requests; past it, wait as the server asks and
        // retry the same capture (identical captures are deduplicated by the database).
        for (let waits = 0; ; waits++) {
          try {
            const doc = await api.capture(body, signal);
            captured.set(source.id, doc.id);
            break;
          } catch (failure) {
            if (
              signal.aborted ||
              !(failure instanceof ReviewApiError) ||
              failure.status !== 429 ||
              waits >= MAX_RATE_LIMIT_WAITS
            )
              throw failure;
            const wait = failure.retryAfterMs ?? 15000;
            setPending(
              `Capturing source ${index + 1} of ${items.length}: waiting ${Math.ceil(wait / 1000)} s for the capture rate limit…`,
            );
            await pause(wait, signal);
          }
        }
      }
      const sourceDocumentIds = [
        ...detail.sources.filter((value) => !captured.has(value.source_key)).map((value) => value.id),
        ...captured.values(),
      ];
      await api.update(
        detail.draft.id,
        {
          catalog: detail.draft.catalog,
          baseSequence: detail.draft.base_sequence,
          sourceDocumentIds,
          expectedRevision: detail.draft.revision,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted)
        setNotice(`Captured ${captured.size} sources and attached them to a new draft revision.`);
    });
  }
  /** Creates a draft with no sources attached, reviewed against the current head, and opens it. */
  async function create(catalog: Catalog) {
    await perform('Creating draft…', async (signal) => {
      const draft = await api.create(
        { catalog, sourceDocumentIds: [], baseSequence: queue?.head ?? null },
        signal,
      );
      // The draft exists now: leave the start form and record its id before loading it, so a failed
      // load is retried by reloading this draft instead of creating another.
      setStarting(false);
      history.replaceState(null, '', `#${draft.id}`);
      setQueue((current) =>
        current && !current.drafts.some((queued) => queued.id === draft.id)
          ? {
              ...current,
              drafts: [
                {
                  id: draft.id,
                  revision: draft.revision,
                  status: draft.status,
                  updated_at: draft.updated_at,
                  base_sequence: draft.base_sequence,
                  version: draft.catalog.version,
                },
                ...current.drafts,
              ],
            }
          : current,
      );
      await refresh(draft.id, signal);
      if (!signal.aborted) {
        setNotice(
          `Draft ${catalog.version} created. Attach its source evidence with Capture all missing sources, then review it.`,
        );
        requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
      }
    });
  }
  function startNew() {
    if (dirty && !window.confirm('Discard unsaved draft or source edits and start a new draft?')) return;
    setDirty(false);
    setNotice('');
    setError('');
    setStarting(true);
    requestAnimationFrame(() => document.getElementById('start-draft-heading')?.focus());
  }
  function cancelStart() {
    setStarting(false);
    requestAnimationFrame(() =>
      (heading.current ?? document.getElementById('start-new-draft'))?.focus({ preventScroll: true }),
    );
  }
  async function publish(note: string) {
    if (!detail) return;
    await perform('Publishing reviewed terms…', async (signal) => {
      const release = await api.publish(
        detail.draft.id,
        {
          expectedRevision: detail.draft.revision,
          expectedHash: detail.draft.catalog_hash,
          expectedHead: detail.head,
          reviewNote: note,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted) {
        setNotice(
          `Published ${release.version} as release ${release.sequence}. Extensions can now request these reviewed terms.`,
        );
        // The dialog's opener is gone or disabled after publication; land on the refreshed heading.
        requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
      }
    });
  }

  return (
    <main id="main" className="workspace" aria-busy={busy}>
      <aside className="queue" aria-labelledby="queue-heading">
        <div className="row">
          <h2 id="queue-heading">Pending drafts</h2>
          <Button
            size="small"
            color="tertiary"
            icon="swap-vertical"
            onClick={() => load(detail?.draft.id)}
            disabled={busy}
          >
            Reload
          </Button>
        </div>
        {queue && (
          <p className="muted small">
            {queue.drafts.length} awaiting review ·{' '}
            {queue.head === null ? 'No published release' : `Published release ${queue.head}`}
          </p>
        )}
        <nav aria-label="Pending drafts">
          <ul>
            {queue?.drafts.map((draft) => (
              <li key={draft.id}>
                <button
                  type="button"
                  className="queue-item"
                  disabled={busy}
                  aria-current={detail?.draft.id === draft.id ? 'page' : undefined}
                  onClick={() => load(draft.id)}
                >
                  <strong>{draft.version}</strong>
                  <span>Revision {draft.revision}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {queue?.drafts.length === 0 && (
          <p>No pending drafts. New candidates appear here when they are saved for review.</p>
        )}
        {queue && !starting && (detail || queue.drafts.length > 0) && (
          <Button
            id="start-new-draft"
            size="small"
            color="secondary"
            icon="arrow-right"
            disabled={busy}
            onClick={startNew}
          >
            Start a new draft
          </Button>
        )}
        <p className="muted small">
          Only the latest 30 pending drafts are shown. Opening a draft does not approve it.
        </p>
      </aside>
      <section className="review-content stack" aria-label="Selected draft">
        {pending && <ApplicationState status="loading" titleTag="p" title={pending} align="left" />}
        {error && (
          <AlertInline
            color="critical"
            role="alert"
            actions={
              <Button size="small" color="secondary" disabled={busy} onClick={() => load(detail?.draft.id)}>
                Reload latest draft
              </Button>
            }
          >
            {error}
          </AlertInline>
        )}
        {notice && (
          <AlertInline color="success" role="status">
            {notice}
          </AlertInline>
        )}
        {queue && (starting || (!detail && queue.drafts.length === 0)) ? (
          // Stays mounted while busy, so a failed create keeps the form, its input and focus.
          <StartDraft
            bundled={bundled}
            head={queue.head}
            busy={busy}
            now={Date.now()}
            queuedVersions={queue.drafts.map((draft) => draft.version)}
            intro={starting ? undefined : 'No drafts are waiting for review.'}
            onCreate={create}
            onCancel={starting ? cancelStart : undefined}
          />
        ) : detail ? (
          <>
            <div className="draft-heading">
              <h1 ref={heading} tabIndex={-1}>
                {detail.draft.catalog.version}
              </h1>
              <Badge color={detail.draft.status === 'draft' ? 'highlight' : 'success'}>
                {detail.draft.status === 'draft' ? 'Awaiting approval' : 'Published'}
              </Badge>
            </div>
            <p className="muted">
              Revision {detail.draft.revision} · {detail.draft.catalog.cards.length} card{' '}
              {detail.draft.catalog.cards.length === 1 ? 'product' : 'products'} ·{' '}
              {detail.draft.catalog.sources.length}{' '}
              {detail.draft.catalog.sources.length === 1 ? 'source' : 'sources'} · catalog schema{' '}
              {detail.draft.catalog.schemaVersion}
            </p>
            {detail.draft.catalog.schemaVersion !== 1 ? (
              <p className="muted small">
                Extraction applies only to schema 1 drafts; edit schema {detail.draft.catalog.schemaVersion}{' '}
                drafts with the editors below.
              </p>
            ) : (
              <ExtractionPanel
                key={detail.draft.id}
                api={api}
                detail={detail}
                busy={busy}
                dirty={dirty}
                perform={perform}
                onApplied={async (signal) => {
                  await refresh(detail.draft.id, signal);
                  if (!signal.aborted)
                    setNotice(
                      'Extraction review recorded in a new draft revision. Review the complete draft and give fresh approval before publishing.',
                    );
                }}
              />
            )}
            <DraftPanel
              key={`${detail.draft.id}:${generation}`}
              detail={detail}
              busy={busy}
              onDirty={setDirty}
              onUpdate={update}
              onCapture={capture}
              onCaptureMany={captureMany}
              onPublish={publish}
              onLoadSource={loadSource}
            />
          </>
        ) : (
          !busy && (
            <ApplicationState status="empty" titleTag="h1" title="Select a draft to review.">
              Compare its changes with the published catalog and inspect the captured issuer text before
              approving.
            </ApplicationState>
          )
        )}
      </section>
    </main>
  );
}

export { DraftPanel } from './DraftPanel';
