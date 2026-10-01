import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** Paths the public site must never answer: the API, the review app and the health check. */
const RESERVED = /^\/(?:v1|review|health)(?:\/|$)/i;
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * The public static site (apps/site) at `/`. It is registered in its own encapsulated context with
 * its own security headers, after the API and review routes, whose more specific routes win; the
 * allowedPath guard also refuses reserved prefixes, so an unknown API path is a 404, not a page.
 */
export async function publicSite(app: FastifyInstance, { root }: { root: string }) {
  app.addHook('onSend', async (request, reply) => {
    reply
      .header('Content-Security-Policy', SITE_CSP)
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Opener-Policy', 'same-origin')
      // Hashed build assets never change; pages and copied data are revalidated.
      .header(
        'Cache-Control',
        request.url.startsWith('/assets/') && reply.statusCode === 200
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
  });
  // @fastify/static refuses non-canonical or differently spelled paths with a 403 error; answer
  // those like any missing page instead of letting the app's handler turn them into a 500.
  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (error.statusCode === 403 || error.statusCode === 404)
      return reply.code(404).send({ error: 'not_found' });
    request.log.warn({ requestId: request.id, event: 'site_request_failed' });
    return reply.code(500).send({ error: 'request_failed' });
  });
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: false,
    redirect: true,
    dotfiles: 'deny',
    cacheControl: false,
    allowedPath: (pathName) => !RESERVED.test(pathName),
  });
}
