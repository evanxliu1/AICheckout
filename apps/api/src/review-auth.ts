import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { readBoundedJson } from '@ai-checkout/catalog-client';

/** Resolves true for a signed-in Supabase user's access token. A pre-check only: every review RPC
 * still verifies the token and checks reviewer membership and a live session in the database. */
export type VerifyToken = (token: string) => Promise<boolean>;

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_RETRY_MS = 60_000;
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX = 256;
const ASYMMETRIC: Record<string, { hash: string; dsaEncoding?: 'ieee-p1363' }> = {
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  RS256: { hash: 'sha256' },
};

function decodePart(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verifies review tokens before a large request body is read. With asymmetric JWT signing keys
 * (ES256/RS256) the signature is checked locally against the project's JWKS, cached for 10 minutes.
 * When it cannot be checked locally (a legacy HS256 project, whose JWKS is empty, an unknown key
 * ID, an unreachable JWKS, or a valid signature whose issuer differs from `SUPABASE_URL`, as with a
 * custom domain), Supabase Auth is asked once (`GET /auth/v1/user`) and a valid answer is cached for
 * up to a minute. A token that is malformed, expired, signed with a known key but invalid, or refused
 * by Auth (400, 401, 403) resolves false; any other Auth answer or a network failure throws, so the
 * route reports the service as unavailable rather than signing the reviewer out.
 */
export function createTokenVerifier(
  supabaseUrl: string,
  publishableKey: string,
  { fetcher = fetch, clock = Date.now }: { fetcher?: typeof fetch; clock?: () => number } = {},
): VerifyToken {
  const base = new URL(supabaseUrl);
  const issuer = new URL('/auth/v1', base).href;
  let keys = new Map<string, { key: KeyObject; alg: string }>(),
    keysAt = -Infinity,
    keysPending: Promise<void> | undefined;
  const users = new Map<string, number>();

  async function loadKeys() {
    keysAt = clock();
    try {
      const response = await fetcher(new URL('/auth/v1/.well-known/jwks.json', base), {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        cache: 'no-store',
        headers: { apikey: publishableKey, Accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      const body = (await readBoundedJson(response, 65536)) as { keys?: unknown } | null;
      if (!body || typeof body !== 'object') return;
      const next = new Map<string, { key: KeyObject; alg: string }>();
      for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
        if (!jwk || typeof jwk !== 'object') continue;
        const { kid, alg } = jwk as { kid?: unknown; alg?: unknown };
        if (typeof kid !== 'string' || typeof alg !== 'string' || !ASYMMETRIC[alg]) continue;
        try {
          next.set(kid, { key: createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }), alg });
        } catch {
          /* A key Node cannot import is treated as unknown. */
        }
      }
      keys = next;
    } catch {
      /* Keep the previous keys; the Auth server answers in the meantime. */
    }
  }
  async function keyFor(kid: string) {
    const now = clock();
    const stale = now - keysAt > JWKS_TTL_MS,
      unknown = !keys.has(kid) && now - keysAt > JWKS_RETRY_MS;
    if (stale || unknown) {
      keysPending ??= loadKeys().finally(() => {
        keysPending = undefined;
      });
      await keysPending;
    }
    return keys.get(kid);
  }
  async function askAuth(token: string) {
    const digest = createHash('sha256').update(token).digest('hex');
    const until = users.get(digest);
    if (until !== undefined && until > clock()) return true;
    users.delete(digest);
    const response = await fetcher(new URL('/auth/v1/user', base), {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    await response.body?.cancel();
    if ([400, 401, 403].includes(response.status)) return false;
    if (!response.ok) throw new Error(`Auth answered ${response.status}.`);
    if (users.size >= USER_CACHE_MAX) users.delete(users.keys().next().value!);
    users.set(digest, clock() + USER_CACHE_TTL_MS);
    return true;
  }

  return async (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = decodePart(parts[0]!),
      claims = decodePart(parts[1]!);
    if (!header || !claims) return false;
    const exp = claims.exp;
    if (typeof exp !== 'number' || exp * 1000 <= clock()) return false;
    const alg = header.alg,
      kid = header.kid;
    if (typeof alg === 'string' && ASYMMETRIC[alg] && typeof kid === 'string') {
      const known = await keyFor(kid);
      if (known) {
        if (known.alg !== alg) return false;
        const { hash, dsaEncoding } = ASYMMETRIC[alg]!;
        let valid: boolean;
        try {
          valid = verify(
            hash,
            Buffer.from(`${parts[0]}.${parts[1]}`),
            dsaEncoding ? { key: known.key, dsaEncoding } : known.key,
            Buffer.from(parts[2]!, 'base64url'),
          );
        } catch {
          valid = false;
        }
        if (!valid || claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub)
          return false;
        // Signed by this project's key; a different issuer means SUPABASE_URL is not the URL Auth
        // signs with (a custom domain, localhost vs 127.0.0.1), so let Auth decide.
        if (claims.iss === issuer) return true;
      }
    }
    return askAuth(token);
  };
}
