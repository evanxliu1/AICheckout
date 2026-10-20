import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  TELEMETRY_LIMITS,
  deleteInstallInputSchema,
  deleteInstallResultSchema,
  eventBatchSchema,
  ingestResultSchema,
} from '@ai-checkout/catalog-review';
import { TelemetryError, type TelemetryRpc } from './telemetry-repository.ts';

export type TelemetryIngest = 'on' | 'off';
export type TelemetryOptions = {
  /** `TELEMETRY_INGEST`: `off` makes `POST /v1/events` answer 410 and clients pause (the kill switch);
   * Delete my data keeps working. */
  ingest?: TelemetryIngest;
  /** `EXTENSION_IDS`: when non-empty, `Origin` must be `chrome-extension://<id>` for one of them. A
   * filter against casual abuse, not authentication: any client can send the header. */
  extensionIds?: readonly string[];
  /** `TELEMETRY_PROXY_HOPS`: how many trusted proxies appended to `X-Forwarded-For` (1 on Render). The
   * client IP is the entry that many places from the right, so entries a client forged on the left never
   * move its bucket; 0 (local) uses the socket address. Fastify's `trustProxy` stays false server-wide. */
  proxyHops?: number;
  /** Requests a minute per client IP and across all clients, per process. */
  ipLimit?: number;
  globalLimit?: number;
};
/** `POST /v1/events/delete` body: one install id plus JSON punctuation. */
const DELETE_BODY_LIMIT = 1024;
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const EXTENSION_ID = /^[a-p]{32}$/;

/** A fixed-window counter per key; returns null when allowed, else the seconds until the window resets. */
export function createLimiter(max: number, clock: () => number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const now = clock();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) {
        for (const [other, value] of buckets) if (value.resetAt <= now) buckets.delete(other);
        if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
      }
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= max ? null : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  };
}

/** The client IP for rate limiting, used transiently and never stored or logged. */
export function clientAddress(request: FastifyRequest, proxyHops: number) {
  if (proxyHops > 0) {
    const header = request.headers['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const address = entries[entries.length - proxyHops];
    if (address && address.length <= 64) return address;
  }
  return request.ip;
}

export function allowedOrigin(origin: string | undefined, extensionIds: readonly string[]) {
  if (extensionIds.length === 0) return true;
  if (!origin || !origin.startsWith('chrome-extension://')) return false;
  const id = origin.slice('chrome-extension://'.length);
  return EXTENSION_ID.test(id) && extensionIds.includes(id);
}

/**
 * Anonymous telemetry routes (Phase 15.2): `POST /events` and `POST /events/delete`. In order: the kill
 * switch (410), the `Origin` filter (403), the per-IP and global buckets (429 with `Retry-After`), the body
 * limit (413), Zod (400), then the anonymous RPC, which re-validates and holds the batch, per-install and
 * retention caps. No body, address or event is logged.
 */
export async function telemetryRoutes(
  app: FastifyInstance,
  {
    rpc,
    ingest = 'on',
    extensionIds = [],
    proxyHops = 0,
    ipLimit = 60,
    globalLimit = 600,
    clock = Date.now,
  }: TelemetryOptions & { rpc: TelemetryRpc; clock?: () => number },
) {
  const perIp = createLimiter(ipLimit, clock),
    global = createLimiter(globalLimit, clock);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (ingest === 'off' && (request.routeOptions.config as { ingest?: boolean }).ingest)
      throw new TelemetryError(410, 'telemetry_disabled');
    if (!allowedOrigin(request.headers.origin, extensionIds))
      throw new TelemetryError(403, 'origin_not_allowed');
    const retry = perIp(clientAddress(request, proxyHops)) ?? global('*');
    if (retry !== null) {
      reply.header('Retry-After', String(retry));
      throw new TelemetryError(429, 'too_many_requests');
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TelemetryError) return reply.code(error.status).send({ error: error.code });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ error: 'request_too_large' });
    if (status === 400 || status === 415) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(503).send({ error: 'telemetry_unavailable' });
  });
  const input = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new TelemetryError(400, 'invalid_request');
    return parsed.data;
  };
  app.post(
    '/events',
    { bodyLimit: TELEMETRY_LIMITS.batchBytes, config: { ingest: true } },
    async (request) => {
      input(z.strictObject({}), request.query);
      const batch = input(eventBatchSchema, request.body);
      return ingestResultSchema.parse(await rpc('ingest_events', { p_batch: batch.events }));
    },
  );
  app.post('/events/delete', { bodyLimit: DELETE_BODY_LIMIT }, async (request) => {
    input(z.strictObject({}), request.query);
    const value = input(deleteInstallInputSchema, request.body);
    return deleteInstallResultSchema.parse(await rpc('delete_install', { p_install_id: value.install_id }));
  });
}
