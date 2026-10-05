// Local control server for an operator-driven (`serve`) session. It exposes exactly the driver's steps.
// Bound to 127.0.0.1 on a random port. Every request must carry the session's random bearer token, a Host header of
// 127.0.0.1:<port> (stops DNS rebinding), Content-Type application/json, and no Origin or Sec-Fetch-Site header (so
// no web page in any browser can drive it, even one that learned the port). One command at a time.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_BODY = 64 * 1024;

/** Check a request's headers. Returns null when acceptable, else [status, reason]. */
export function checkRequest({ method, headers }, { token, port }) {
  if (method !== 'POST') return [405, 'POST only'];
  if (headers.origin !== undefined) return [403, 'browser origin refused'];
  if (headers['sec-fetch-site'] !== undefined || headers['sec-fetch-mode'] !== undefined)
    return [403, 'browser request refused'];
  if (headers.host !== `127.0.0.1:${port}`) return [403, 'bad host'];
  if (!/^application\/json\b/i.test(headers['content-type'] ?? '')) return [415, 'application/json only'];
  const auth = /^Bearer ([0-9a-f]{64})$/.exec(headers.authorization ?? '');
  if (!auth) return [401, 'token required'];
  const given = Buffer.from(auth[1], 'hex');
  const expected = Buffer.from(token, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [401, 'bad token'];
  return null;
}

/**
 * Start the server. handle(command) -> Promise<result>; it throws errors with { name, code, exclusionCode }.
 * Returns { port, token, close }.
 */
export async function startControlServer(handle, { port = 0 } = {}) {
  const token = randomBytes(32).toString('hex');
  let busy = false;
  let bound = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const bad = checkRequest({ method: req.method, headers: req.headers }, { token, port: bound });
    if (bad) {
      req.resume();
      return send(bad[0], { error: bad[1] });
    }
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else parts.push(c);
    });
    req.on('end', async () => {
      if (busy) return send(409, { error: 'one command at a time' });
      let cmd;
      try {
        cmd = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        return send(400, { error: 'bad JSON' });
      }
      busy = true;
      try {
        send(200, { ok: true, result: await handle(cmd) });
      } catch (e) {
        send(e?.name === 'RefusalError' || e?.name === 'StopError' ? 422 : 500, {
          ok: false,
          error: {
            name: e?.name ?? 'Error',
            code: e?.code ?? null,
            exclusionCode: e?.exclusionCode ?? null,
            message: String(e?.message ?? e),
          },
        });
      } finally {
        busy = false;
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  bound = server.address().port;
  return {
    port: bound,
    token,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
