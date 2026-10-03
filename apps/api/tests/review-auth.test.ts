import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createTokenVerifier } from '../src/review-auth.ts';

const supabaseUrl = 'https://project.supabase.co';
const issuer = `${supabaseUrl}/auth/v1`;
const now = Date.parse('2026-10-02T12:00:00Z');
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = (key: KeyObject, kid: string, alg: string) => ({
  ...key.export({ format: 'jwk' }),
  kid,
  alg,
  use: 'sig',
});
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const claims = {
  iss: issuer,
  sub: '10000000-0000-4000-8000-000000000001',
  role: 'authenticated',
  aud: 'authenticated',
  exp: now / 1000 + 3600,
};
function token({
  alg = 'ES256',
  kid = 'ec-1',
  key = ec.privateKey,
  payload = claims,
}: { alg?: string; kid?: string; key?: KeyObject; payload?: object } = {}) {
  const data = `${part({ alg, kid, typ: 'JWT' })}.${part(payload)}`;
  const signature =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(data), key);
  return `${data}.${signature.toString('base64url')}`;
}
const hs256 = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`;

function setup({
  keys = [jwk(ec.publicKey, 'ec-1', 'ES256'), jwk(rsa.publicKey, 'rsa-1', 'RS256')] as object[],
  userStatus = 200,
  clock = () => now,
} = {}) {
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/v1/.well-known/jwks.json') return Response.json({ keys });
    if (path === '/auth/v1/user') return Response.json({}, { status: userStatus });
    throw new Error(`unexpected ${path}`);
  });
  const calls = (path: string) =>
    fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname === path).length;
  return {
    verify: createTokenVerifier(supabaseUrl, 'sb_publishable_test', {
      fetcher: fetcher as unknown as typeof fetch,
      clock,
    }),
    fetcher,
    jwksCalls: () => calls('/auth/v1/.well-known/jwks.json'),
    userCalls: () => calls('/auth/v1/user'),
  };
}

describe('review token pre-check', () => {
  it('verifies ES256 and RS256 tokens locally against a cached JWKS without asking Auth', async () => {
    const { verify, jwksCalls, userCalls } = setup();
    expect(await verify(token())).toBe(true);
    expect(await verify(token({ alg: 'RS256', kid: 'rsa-1', key: rsa.privateKey }))).toBe(true);
    expect(await verify(token())).toBe(true);
    expect(jwksCalls()).toBe(1);
    expect(userCalls()).toBe(0);
  });
  it.each([
    ['a forged signature', () => token({ key: other.privateKey })],
    ['an expired token', () => token({ payload: { ...claims, exp: now / 1000 - 1 } })],
    ['the anon role', () => token({ payload: { ...claims, role: 'anon' } })],
    ['no subject', () => token({ payload: { ...claims, sub: '' } })],
    ['an algorithm that does not match the key', () => token({ alg: 'RS256', kid: 'ec-1' })],
  ])('rejects %s signed for a known key, without asking Auth', async (_label, make) => {
    const { verify, userCalls } = setup();
    expect(await verify(make())).toBe(false);
    expect(userCalls()).toBe(0);
  });
  it('asks Auth when a validly signed token names another issuer (SUPABASE_URL not the signing URL)', async () => {
    const other = token({ payload: { ...claims, iss: 'https://auth.custom.example/auth/v1' } });
    const accepted = setup();
    expect(await accepted.verify(other)).toBe(true);
    expect(accepted.userCalls()).toBe(1);
    const refused = setup({ userStatus: 401 });
    expect(await refused.verify(other)).toBe(false);
  });
  it.each([500, 429, 502])(
    'throws when Auth answers %i, so the route reports it as unavailable',
    async (status) => {
      const { verify } = setup({ keys: [], userStatus: status });
      await expect(verify(hs256)).rejects.toThrow();
    },
  );
  it.each([400, 403])('treats an Auth %i as an invalid token', async (status) => {
    const { verify } = setup({ keys: [], userStatus: status });
    expect(await verify(hs256)).toBe(false);
  });
  it.each(['', 'a.b', 'not.json.here', `${part({ alg: 'ES256' })}.${part({ sub: 'x' })}.sig`])(
    'rejects a malformed or exp-less token without any request (%s)',
    async (value) => {
      const { verify, fetcher } = setup();
      expect(await verify(value)).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('asks Auth for HS256 tokens (a legacy project with an empty JWKS) and caches a valid answer', async () => {
    let time = now;
    const { verify, userCalls, jwksCalls } = setup({ keys: [], clock: () => time });
    expect(await verify(hs256)).toBe(true);
    expect(await verify(hs256)).toBe(true);
    expect(userCalls()).toBe(1);
    expect(jwksCalls()).toBe(0);
    time += 61_000;
    expect(await verify(hs256)).toBe(true);
    expect(userCalls()).toBe(2);
  });
  it('rejects a token Auth refuses and does not cache the refusal', async () => {
    const { verify, userCalls } = setup({ userStatus: 401 });
    expect(await verify(hs256)).toBe(false);
    expect(await verify(hs256)).toBe(false);
    expect(userCalls()).toBe(2);
  });
  it('refreshes the JWKS for an unknown key at most once a minute, then asks Auth', async () => {
    let time = now;
    const { verify, jwksCalls, userCalls } = setup({ clock: () => time });
    expect(await verify(token({ kid: 'new' }))).toBe(true);
    expect(await verify(token({ kid: 'new', payload: { ...claims, sub: 'other' } }))).toBe(true);
    expect(jwksCalls()).toBe(1);
    expect(userCalls()).toBe(2);
    time += 61_000;
    await verify(token({ kid: 'new' }));
    expect(jwksCalls()).toBe(2);
  });
  it('falls back to Auth when the JWKS cannot be read', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) =>
      new URL(String(url)).pathname === '/auth/v1/user'
        ? Response.json({})
        : new Response('down', { status: 503 }),
    );
    const verify = createTokenVerifier(supabaseUrl, 'sb_publishable_test', {
      fetcher: fetcher as unknown as typeof fetch,
      clock: () => now,
    });
    expect(await verify(token())).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('lets an Auth outage surface as an error for the route to report', async () => {
    const verify = createTokenVerifier(supabaseUrl, 'sb_publishable_test', {
      fetcher: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
      clock: () => now,
    });
    await expect(verify(hs256)).rejects.toThrow();
  });
});
