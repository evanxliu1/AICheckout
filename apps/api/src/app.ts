import Fastify, { LogController } from 'fastify';
import { catalogResponseSchema } from '@ai-checkout/rewards-core';
import { reviewRoutes } from './review-routes.ts';
import type { ReviewRpc } from './review-repository.ts';
import { reviewSite } from './review-site.ts';
import type { ReviewConfig } from '@ai-checkout/catalog-review';
import type { CurationExecution } from './curation/service';

export function createApp({ readCatalog, clock = Date.now, logging = false, reviewRpc, reviewLimit, reviewRoot, reviewConfig, curation, shutdownSignal, curationLimit }: {
  readCatalog: () => Promise<unknown>; clock?: () => number; logging?: boolean; reviewRpc?: ReviewRpc; reviewLimit?: number;
  reviewRoot?: string; reviewConfig?: ReviewConfig;
  curation?: CurationExecution; shutdownSignal?: AbortSignal; curationLimit?: number;
}) {
  const app = Fastify({ logger: logging, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 262144,
    requestTimeout: 10000, connectionTimeout: 10000, requestIdHeader: false });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ requestId: request.id, route: request.routeOptions.url ?? 'unmatched',
      method: request.method, statusCode: reply.statusCode, durationMs: reply.elapsedTime }, 'request_completed');
  });
  app.get('/health', async () => ({ status: 'ok' }));
  if (reviewRpc) void app.register(reviewRoutes, { prefix: '/v1/review', rpc: reviewRpc, limit: reviewLimit, curation, shutdownSignal, curationLimit });
  if (reviewRoot && reviewConfig) void app.register(reviewSite, { prefix: '/review', root: reviewRoot, config: reviewConfig });
  app.get('/v1/catalog', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    try {
      const body = catalogResponseSchema.parse({ release: await readCatalog() });
      const now = clock(), release = body.release;
      if (release && (Date.parse(release.catalog.verifiedAt) > now || Date.parse(release.published_at) > now || Date.parse(release.catalog.expiresAt) <= now)) {
        return reply.code(503).send({ error: 'catalog_unavailable' });
      }
      return body;
    } catch {
      return reply.code(503).send({ error: 'catalog_unavailable' });
    }
  });
  app.setErrorHandler((_error, request, reply) => {
    request.log.warn({ requestId: request.id, event: 'request_failed' });
    void reply.code(500).send({ error: 'request_failed' });
  });
  return app;
}
