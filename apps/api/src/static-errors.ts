import type { FastifyInstance } from 'fastify';

/**
 * Error and not-found handling for a static-file context (@fastify/static). It refuses
 * non-canonical or differently spelled paths with a 403 error, which is answered like any missing
 * file; other client errors from the file sender (416 range not satisfiable, 412 failed
 * precondition) keep their status; only server-side failures become a 500. Bodies are small and
 * fixed and never echo the requested path.
 */
export function staticErrorHandling(app: FastifyInstance, event: string) {
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((error: { statusCode?: number; status?: number }, request, reply) => {
    const status = error.statusCode ?? error.status;
    if (status === 403 || status === 404) return reply.code(404).send({ error: 'not_found' });
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: 'request_rejected' });
    request.log.warn({ requestId: request.id, event });
    return reply.code(500).send({ error: 'request_failed' });
  });
}
