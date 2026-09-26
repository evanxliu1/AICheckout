import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { reviewConfigSchema, type ReviewConfig } from '@ai-checkout/catalog-review';

export async function reviewSite(app: FastifyInstance, { root, config }: { root: string; config: ReviewConfig }) {
  const safeConfig = reviewConfigSchema.parse(config);
  const origin = new URL(safeConfig.supabaseUrl).origin;
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${origin}; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`)
      .header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store');
  });
  app.get('/config.json', async () => safeConfig);
  await app.register(fastifyStatic, { root, prefix: '/', redirect: true, dotfiles: 'deny', cacheControl: false });
}
