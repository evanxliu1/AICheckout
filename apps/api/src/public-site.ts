import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { staticErrorHandling } from './static-errors.ts';

/** Paths the public site must never answer: the API, the review app and the health check. */
const RESERVED = /^\/(?:v1|review|health)(?:\/|$)/i;
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * The public static site (apps/site) at `/`, in its own encapsulated context with its own security
 * headers. Precedence does not depend on registration order: the router always prefers the static
 * and prefixed routes (`/health`, `/v1/catalog`, `/v1/review/*`, `/review/*`) over the site's `/*`
 * wildcard, and the allowedPath guard also refuses the reserved prefixes, so an unknown API path is
 * a JSON 404, never a page.
 */
export async function publicSite(app: FastifyInstance, { root }: { root: string }) {
  try {
    await access(join(root, 'index.html'));
  } catch {
    throw new Error('SITE_DIST_DIR must point to a built site containing index.html.');
  }
  app.addHook('onSend', async (request, reply) => {
    reply
      .header('Content-Security-Policy', SITE_CSP)
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Opener-Policy', 'same-origin')
      // Hashed build assets never change; pages and copied data are revalidated.
      .header(
        'Cache-Control',
        request.url.startsWith('/assets/') && (reply.statusCode === 200 || reply.statusCode === 304)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
  });
  staticErrorHandling(app, 'site_request_failed');
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
