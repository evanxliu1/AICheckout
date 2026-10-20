import Fastify, { LogController } from 'fastify';
import { catalogResponseSchema, merchantsResponseSchema } from '@ai-checkout/rewards-core';
import { reviewRoutes } from './review-routes.ts';
import type { ReviewRpc } from './review-repository.ts';
import type { VerifyToken } from './review-auth.ts';
import { reviewSite } from './review-site.ts';
import { publicSite } from './public-site.ts';
import type { ReviewConfig } from '@ai-checkout/catalog-review';
import type { CurationExecution } from './curation/service.ts';
import { telemetryRoutes, type TelemetryOptions } from './telemetry-routes.ts';
import type { TelemetryRpc } from './telemetry-repository.ts';

export function createApp({
  readCatalog,
  readMerchants,
  clock = Date.now,
  logging = false,
  reviewRpc,
  verifyReviewToken,
  reviewLimit,
  reviewRoot,
  reviewConfig,
  siteRoot,
  curation,
  shutdownSignal,
  curationLimit,
  telemetryRpc,
  telemetry,
}: {
  readCatalog: () => Promise<unknown>;
  /** The head merchant release (Phase 14.6); `/v1/merchants` answers 503 while it is not configured. */
  readMerchants?: () => Promise<unknown>;
  /** The anonymous telemetry RPCs (Phase 15.2); without it `/v1/events` does not exist. */
  telemetryRpc?: TelemetryRpc;
  telemetry?: TelemetryOptions;
  clock?: () => number;
  logging?: boolean;
  reviewRpc?: ReviewRpc;
  /** Required with `reviewRpc`: checks the session before large review bodies are read. */
  verifyReviewToken?: VerifyToken;
  reviewLimit?: number;
  reviewRoot?: string;
  reviewConfig?: ReviewConfig;
  /** Built public site (apps/site/dist), served at `/` behind the API and review routes. */
  siteRoot?: string;
  curation?: CurationExecution;
  shutdownSignal?: AbortSignal;
  curationLimit?: number;
}) {
  const app = Fastify({
    logger: logging,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 262144,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    requestIdHeader: false,
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        route: request.routeOptions.url ?? 'unmatched',
        method: request.method,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'request_completed',
    );
  });
  app.get('/health', async () => ({ status: 'ok' }));
  if (reviewRpc && !verifyReviewToken) throw new Error('Review routes need a token verifier.');
  if (reviewRpc && verifyReviewToken)
    void app.register(reviewRoutes, {
      prefix: '/v1/review',
      rpc: reviewRpc,
      verifyToken: verifyReviewToken,
      limit: reviewLimit,
      curation,
      shutdownSignal,
      curationLimit,
    });
  if (reviewRoot && reviewConfig)
    void app.register(reviewSite, { prefix: '/review', root: reviewRoot, config: reviewConfig });
  if (telemetryRpc)
    void app.register(telemetryRoutes, { prefix: '/v1', rpc: telemetryRpc, clock, ...telemetry });
  if (siteRoot) void app.register(publicSite, { root: siteRoot });
  app.get('/v1/catalog', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    try {
      const body = catalogResponseSchema.parse({ release: await readCatalog() });
      const now = clock(),
        release = body.release;
      if (
        release &&
        (Date.parse(release.catalog.verifiedAt) > now ||
          Date.parse(release.published_at) > now ||
          Date.parse(release.catalog.expiresAt) <= now)
      ) {
        return reply.code(503).send({ error: 'catalog_unavailable' });
      }
      return body;
    } catch {
      return reply.code(503).send({ error: 'catalog_unavailable' });
    }
  });
  // Like /v1/catalog: public, never cached, fails closed. A merchant release has no expiry; it is unusable
  // when it does not parse or claims a verification or publication time in the future.
  app.get('/v1/merchants', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    try {
      if (!readMerchants) throw new Error('merchants not configured');
      const body = merchantsResponseSchema.parse({ release: await readMerchants() });
      const now = clock(),
        release = body.release;
      if (
        release &&
        (Date.parse(release.release.verifiedAt) > now || Date.parse(release.published_at) > now)
      ) {
        return reply.code(503).send({ error: 'merchants_unavailable' });
      }
      return body;
    } catch {
      return reply.code(503).send({ error: 'merchants_unavailable' });
    }
  });
  app.setErrorHandler((_error, request, reply) => {
    request.log.warn({ requestId: request.id, event: 'request_failed' });
    void reply.code(500).send({ error: 'request_failed' });
  });
  return app;
}
