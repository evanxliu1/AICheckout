import { readBoundedJson } from '@ai-checkout/catalog-client';

/** The two anonymous telemetry RPCs (Phase 15.2): the write path and Delete my data. */
export type TelemetryOperation = 'ingest_events' | 'delete_install';
export type TelemetryRpc = (
  operation: TelemetryOperation,
  parameters: Record<string, unknown>,
) => Promise<unknown>;
export class TelemetryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
/** Largest RPC answer: `{"accepted":n,"dropped":n}` or `{"deleted":n}`. */
const MAX_TELEMETRY_READ_BYTES = 8192;

/** Calls the Data API as `anon` with the publishable key only (no bearer token, no privileged credential):
 * the database functions are `security definer` and hold every cap. A validation refusal (22023) is the
 * API's own bug or a forged request, reported as 400; anything else is a generic 503. */
export function createTelemetryRepository(
  supabaseUrl: string,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
): TelemetryRpc {
  const base = new URL(supabaseUrl);
  const local = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if (
    (!local && base.protocol !== 'https:') ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !publishableKey
  ) {
    throw new Error('Invalid telemetry database configuration.');
  }
  return async (operation, parameters) => {
    try {
      const response = await fetcher(new URL(`/rest/v1/rpc/${operation}`, base), {
        method: 'POST',
        signal: AbortSignal.timeout(7000),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { apikey: publishableKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
      });
      if (response.ok) return await readBoundedJson(response, MAX_TELEMETRY_READ_BYTES);
      let code: unknown;
      try {
        const normalized = new Response(response.body, { status: 200, headers: response.headers });
        const body = await readBoundedJson(normalized, 8192);
        if (body && typeof body === 'object' && 'code' in body) code = body.code;
      } catch {
        /* An unreadable failure body is a generic unavailable answer. */
      }
      if (code === '22023') throw new TelemetryError(400, 'invalid_request');
      throw new TelemetryError(503, 'telemetry_unavailable');
    } catch (error) {
      if (error instanceof TelemetryError) throw error;
      throw new TelemetryError(503, 'telemetry_unavailable');
    }
  };
}
