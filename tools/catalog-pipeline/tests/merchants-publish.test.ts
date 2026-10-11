// `pipeline merchants publish` against the in-memory hosted stand-in (tests/hosted.ts) with the shared merchant
// release fixture, an injected git state and clock. Nothing here contacts a network.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { MerchantRelease } from '@ai-checkout/rewards-core';
import { MERCHANT_RELEASE_FIXTURE } from '../../../packages/rewards-core/test-cases.ts';
import { jsonSha256 } from '../src/hash.ts';
import { MERCHANT_CLEAN_PATHS, merchantReviewNote, publishMerchants } from '../src/merchants/publish.ts';
import type { MerchantPublishDeps, MerchantPublishOptions } from '../src/merchants/publish.ts';
import type { Env } from '../src/run.ts';
import { writeSession } from '../src/session.ts';
import { API, EMAIL, PUBLISHABLE_KEY, REVIEWER_ID, SECRET, SUPABASE, hosted } from './hosted.ts';
import type { Hosted } from './hosted.ts';

const RELEASE: MerchantRelease = MERCHANT_RELEASE_FIXTURE;
const VERSION = RELEASE.version;
const NOW = new Date('2026-10-11T12:00:00Z');
const INSTRUCTION = '2026-10-11T11:58:00Z';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
/** Valid variants of the fixture: an earlier version with the same verification date, a later one, and the
 * same version with one record changed. */
const EARLIER: MerchantRelease = { ...RELEASE, version: '2026-10-10.seed.0' };
const LATER: MerchantRelease = {
  ...RELEASE,
  version: '2026-10-11.later.1',
  verifiedAt: '2026-10-11T00:00:00Z',
};
const CHANGED: MerchantRelease = {
  ...RELEASE,
  merchants: RELEASE.merchants.map((m) => (m.id === 'target-us' ? { ...m, disabled: true } : m)),
};

const allOutput: string[] = [];
afterAll(() => {
  expect(allOutput.join('\n')).not.toContain(SECRET);
});

interface Setup {
  server: Hosted;
  deps: MerchantPublishDeps;
  logs: string[];
  git: { head: string; origin: string; status: string; fetchFails: boolean };
  run: (options?: Partial<MerchantPublishOptions>) => Promise<number>;
  output: () => string;
  /** Review API requests as "METHOD /path". */
  review: () => string[];
}

async function setup(options: { session?: boolean; release?: MerchantRelease } = {}): Promise<Setup> {
  const server = hosted();
  const root = await mkdtemp(join(tmpdir(), 'merchants-publish-root-'));
  const home = await mkdtemp(join(tmpdir(), 'merchants-publish-home-'));
  const logs: string[] = [];
  const git = { head: SHA, origin: SHA, status: '', fetchFails: false };
  const env: Env = {
    root,
    now: () => NOW,
    env: {},
    log: (line) => {
      logs.push(line);
      allOutput.push(line);
    },
    sleep: async () => undefined,
    exec: async () => 0,
  };
  const deps: MerchantPublishDeps = {
    fetch: server.fetch,
    git: async (_root, args) => {
      if (args[0] === 'fetch') return git.fetchFails ? null : '';
      if (args[0] === 'rev-parse') return `${args[1] === 'HEAD' ? git.head : git.origin}\n`;
      if (args[0] === 'status') return git.status;
      return null;
    },
    release: async () => options.release ?? RELEASE,
    sessionPath: join(home, 'ai-checkout', 'review-session.json'),
  };
  if (options.session !== false)
    await writeSession(
      { ...deps, root, now: env.now, log: env.log },
      {
        api: API,
        supabaseUrl: SUPABASE,
        publishableKey: PUBLISHABLE_KEY,
        refreshToken: server.refreshToken,
        userId: REVIEWER_ID,
        email: EMAIL,
        savedAt: NOW.toISOString(),
      },
    );
  return {
    server,
    deps,
    logs,
    git,
    run: (overrides = {}) =>
      publishMerchants(env, { version: VERSION, api: API, offline: false, ...overrides }, deps),
    output: () => logs.join('\n'),
    review: () =>
      server.calls
        .filter((call) => call.url.startsWith(`${API}/v1/review/`))
        .map((call) => `${call.method} ${new URL(call.url).pathname}`),
  };
}

describe('merchants publish dry run', () => {
  it('passes with a clean main checkout and sends nothing to the review API but the queue read', async () => {
    const s = await setup();
    expect(await s.run()).toBe(0);
    expect(s.output()).toContain(`MERCHANTS_V1 here: ${VERSION}, ${RELEASE.merchants.length} records`);
    expect(s.output()).toContain('reviewer access confirmed');
    expect(s.output()).toContain('Served now: no merchant release');
    expect(s.output()).toContain('Dry run passed');
    expect(s.review()).toEqual(['GET /v1/review/']);
    expect(s.server.merchantPublishes).toEqual([]);
  });
  it('reports git problems as what --confirm would refuse, and still passes', async () => {
    const s = await setup();
    s.git.status = ' M evals/merchants/db/records/kroger-us.json\n';
    s.git.head = 'b'.repeat(40);
    expect(await s.run()).toBe(0);
    expect(s.output()).toContain('would refuse with --confirm: HEAD bbbbbbb is not origin/main a1b2c3d');
    expect(s.output()).toContain(`uncommitted changes under ${MERCHANT_CLEAN_PATHS.join(', ')}`);
  });
  it('refuses a version that is not MERCHANTS_V1 and a release verified in the future', async () => {
    const s = await setup();
    expect(await s.run({ version: '2026-10-10.other.1' })).toBe(1);
    expect(s.output()).toContain("--version 2026-10-10.other.1 is not MERCHANTS_V1's version");
    const future = await setup({ release: { ...RELEASE, verifiedAt: '2026-10-12T00:00:00Z' } });
    expect(await future.run()).toBe(1);
    expect(future.output()).toContain('verified in the future');
  });
  it('works offline without a session and names the login command', async () => {
    const s = await setup({ session: false });
    expect(await s.run({ offline: true })).toBe(0);
    expect(s.output()).toContain('Remote: skipped (--offline).');
    expect(s.server.calls).toEqual([]);
    const online = await setup({ session: false });
    expect(await online.run()).toBe(0);
    expect(online.output()).toContain('Session: none');
    expect(online.output()).toContain('npm run pipeline -- login');
  });
  it('describes the served release and warns when it is already published or verified later', async () => {
    const s = await setup();
    s.server.setMerchantRelease(RELEASE);
    expect(await s.run()).toBe(0);
    expect(s.output()).toContain(`${VERSION} is already published`);
    const later = await setup();
    later.server.setMerchantRelease(LATER);
    expect(await later.run()).toBe(0);
    expect(later.output()).toContain('warning: the served release is verified later');
  });
});

describe('merchants publish --confirm', () => {
  it('publishes on the head it read, with the agent-verified note, and checks what is served', async () => {
    const s = await setup();
    expect(await s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(0);
    expect(s.server.merchantPublishes).toHaveLength(1);
    const body = s.server.merchantPublishes[0] as {
      release: MerchantRelease;
      expectedHead: number | null;
      expectedHash: string | null;
      reviewNote: string;
    };
    expect(body.release).toEqual(RELEASE);
    expect(body.expectedHead).toBeNull();
    expect(body.expectedHash).toBeNull();
    expect(body.reviewNote).toBe(merchantReviewNote(RELEASE, jsonSha256(RELEASE), SHA, INSTRUCTION));
    expect(body.reviewNote).toContain('agent-verified, not human-verified');
    expect(body.reviewNote).toContain(`Evan's chat instruction of ${INSTRUCTION}`);
    expect(s.output()).toContain(`Published merchant release 1: ${VERSION}`);
    expect(s.output()).toContain(`/v1/merchants serves release 1 (${VERSION})`);
    expect(s.review()).toEqual(['POST /v1/review/merchants/publish']);
  });
  it('publishes a second release on the first with its sequence and hash as the expected head', async () => {
    const s = await setup();
    s.server.setMerchantRelease(EARLIER);
    expect(await s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(0);
    const body = s.server.merchantPublishes[0] as { expectedHead: number; expectedHash: string };
    expect(body.expectedHead).toBe(1);
    expect(body.expectedHash).toBe(jsonSha256(EARLIER));
    expect(s.server.merchantRelease?.sequence).toBe(2);
  });
  it('is a no-op when the same version and content are already served, and refuses different content', async () => {
    const s = await setup();
    s.server.setMerchantRelease(RELEASE);
    expect(await s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(0);
    expect(s.output()).toContain('nothing to publish');
    expect(s.server.merchantPublishes).toEqual([]);
    const changed = await setup();
    changed.server.setMerchantRelease(CHANGED);
    expect(await changed.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(1);
    expect(changed.output()).toContain('already published with different content');
    expect(changed.server.merchantPublishes).toEqual([]);
  });
  it.each([
    [
      'a mismatched --confirm',
      { confirm: '2026-10-10.test.2', instructionAt: INSTRUCTION },
      'must equal --version',
    ],
    ['no --instruction-at', { confirm: VERSION }, '--confirm needs --instruction-at'],
    ['a future instruction', { confirm: VERSION, instructionAt: '2026-10-11T12:30:00Z' }, 'is in the future'],
    [
      'a stale instruction',
      { confirm: VERSION, instructionAt: '2026-10-01T12:00:00Z' },
      'more than 7 days old',
    ],
    [
      'a local time',
      { confirm: VERSION, instructionAt: '2026-10-11T11:58:00+02:00' },
      'not an ISO-8601 UTC time',
    ],
  ])('refuses %s before sending anything', async (_name, options, message) => {
    const s = await setup();
    expect(await s.run(options)).toBe(1);
    expect(s.output()).toContain(message);
    expect(s.server.calls).toEqual([]);
  });
  it('refuses a HEAD that is not origin/main, a dirty tree and a failed fetch', async () => {
    for (const change of [
      (s: Setup) => {
        s.git.head = 'c'.repeat(40);
      },
      (s: Setup) => {
        s.git.status = ' M packages/rewards-core/src/merchants-v1.ts\n';
      },
      (s: Setup) => {
        s.git.fetchFails = true;
      },
    ]) {
      const s = await setup();
      change(s);
      expect(await s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(1);
      expect(s.output()).toContain('Refused; nothing was sent');
      expect(s.server.calls).toEqual([]);
    }
  });
  it('refuses --offline with --confirm, a missing session and a session for another API', async () => {
    const s = await setup();
    await expect(s.run({ confirm: VERSION, instructionAt: INSTRUCTION, offline: true })).rejects.toThrow(
      '--offline',
    );
    const none = await setup({ session: false });
    await expect(none.run({ confirm: VERSION, instructionAt: INSTRUCTION })).rejects.toThrow('No session');
    const other = await setup();
    expect(
      await other.run({ confirm: VERSION, instructionAt: INSTRUCTION, api: 'https://other.example.test' }),
    ).toBe(1);
    expect(other.output()).toContain('the session is for');
    expect(other.server.merchantPublishes).toEqual([]);
  });
  it('refuses when /v1/merchants answers 503, because the head is unknown', async () => {
    const s = await setup();
    s.server.merchantsDown = true;
    expect(await s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).toBe(1);
    expect(s.output()).toContain('the head is unknown, nothing was sent');
    expect(s.server.merchantPublishes).toEqual([]);
  });
  it('reports a 409 from the API as an error without a token', async () => {
    const s = await setup();
    s.server.setMerchantRelease(EARLIER);
    // The head moves between the read and the publish.
    const fetch = s.deps.fetch;
    let reads = 0;
    s.deps.fetch = (async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).endsWith('/v1/merchants') && reads++ === 0)
        s.server.setMerchantRelease({ ...RELEASE, version: '2026-10-10.seed.2' });
      return response;
    }) as typeof fetch;
    await expect(s.run({ confirm: VERSION, instructionAt: INSTRUCTION })).rejects.toThrow(
      /HTTP 409, review_changed/,
    );
    expect(s.server.merchantRelease?.version).toBe('2026-10-10.seed.2');
  });
});
