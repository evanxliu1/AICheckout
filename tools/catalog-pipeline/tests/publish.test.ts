// `pipeline publish` against the in-memory hosted stand-in (tests/hosted.ts), with a small fixture catalog
// (CATALOG_V2: 7 cards, 17 sources), synthetic capture texts and an injected manifest, git, clock and sleep.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CATALOG_V2 } from '@ai-checkout/rewards-core';
import type { Catalog } from '@ai-checkout/rewards-core';
import { jsonSha256, sha256Hex } from '../src/hash.ts';
import { matchCaptures, publish } from '../src/publish.ts';
import type { PublishDeps, PublishOptions } from '../src/publish.ts';
import type { Env } from '../src/run.ts';
import { writeSession } from '../src/session.ts';
import { API, EMAIL, PUBLISHABLE_KEY, REVIEWER_ID, SECRET, SUPABASE, hosted } from './hosted.ts';
import type { Hosted } from './hosted.ts';

const CATALOG = CATALOG_V2 as Catalog;
const VERSION = CATALOG.version;
const NOW = new Date('2026-10-04T12:00:00Z');
const INSTRUCTION = '2026-10-04T11:58:00Z';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const text = (id: string) => `Synthetic capture of ${id}: fake words only.\n`;
const hashOf = (value: string) => sha256Hex(new TextEncoder().encode(value));

const allOutput: string[] = [];
afterAll(() => {
  expect(allOutput.join('\n')).not.toContain(SECRET);
});

interface Setup {
  server: Hosted;
  env: Env;
  deps: PublishDeps;
  logs: string[];
  captures: string;
  sleeps: number[];
  git: { head: string; origin: string; status: string; fetchFails: boolean };
  run: (options?: Partial<PublishOptions>) => Promise<number>;
  output: () => string;
  /** API requests that write (POST/PUT to the review API, not the Supabase token refresh). */
  writes: () => string[];
  /** Review API requests as "METHOD /path". */
  review: () => string[];
}

async function setup(options: { session?: boolean; now?: Date; catalog?: Catalog } = {}): Promise<Setup> {
  const server = hosted();
  const root = await mkdtemp(join(tmpdir(), 'publish-root-'));
  const home = await mkdtemp(join(tmpdir(), 'publish-home-'));
  const captures = join(root, 'captures');
  await mkdir(captures);
  const catalog = options.catalog ?? CATALOG;
  for (const source of catalog.sources) await writeFile(join(captures, `${source.id}.txt`), text(source.id));
  const logs: string[] = [];
  const sleeps: number[] = [];
  const git = { head: SHA, origin: SHA, status: '', fetchFails: false };
  const env: Env = {
    root,
    now: () => options.now ?? NOW,
    env: {},
    log: (line) => {
      logs.push(line);
      allOutput.push(line);
    },
    sleep: async () => undefined,
    exec: async () => 0,
  };
  const deps: PublishDeps = {
    fetch: server.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    git: async (_root, args) => {
      if (args[0] === 'fetch') return git.fetchFails ? null : '';
      if (args[0] === 'rev-parse') return `${args[1] === 'HEAD' ? git.head : git.origin}\n`;
      if (args[0] === 'status') return git.status;
      return null;
    },
    reviewManifests: async () => [
      {
        path: 'evals/curation/real/manifest.json',
        sources: catalog.sources.map((source) => ({
          id: source.id,
          sha256: hashOf(text(source.id)),
          capturedOn: source.checkedOn,
        })),
      },
    ],
    catalog: async () => catalog,
    sessionPath: join(home, 'ai-checkout', 'review-session.json'),
  };
  if (options.session !== false) {
    // A session as `login` leaves it: the hosted stand-in accepts this refresh token.
    await writeSession(
      { fetch: server.fetch, sessionPath: deps.sessionPath, root, now: env.now, log: env.log },
      {
        api: API,
        supabaseUrl: SUPABASE,
        publishableKey: PUBLISHABLE_KEY,
        refreshToken: server.refreshToken,
        userId: REVIEWER_ID,
        email: EMAIL,
        savedAt: '2026-10-04T10:00:00.000Z',
      },
    );
  }
  return {
    server,
    env,
    deps,
    logs,
    captures,
    sleeps,
    git,
    run: (more = {}) =>
      publish(env, { version: VERSION, captures: [captures], api: API, offline: false, ...more }, deps),
    output: () => logs.join('\n'),
    writes: () =>
      server.calls
        .filter((call) => call.url.startsWith(API) && ['POST', 'PUT'].includes(call.method))
        .map((call) => `${call.method} ${call.url.slice(API.length)}`),
    review: () =>
      server.calls
        .filter((call) => call.url.startsWith(API))
        .map((call) => `${call.method} ${call.url.slice(API.length)}`),
  };
}

const confirm = { confirm: VERSION, instructionAt: INSTRUCTION };

describe('pipeline publish: local refusals (nothing is sent)', () => {
  const refuses = async (s: Setup, options: Partial<PublishOptions>, pattern: RegExp) => {
    expect(await s.run(options), s.output()).toBe(1);
    expect(s.output()).toMatch(pattern);
    expect(s.server.calls).toEqual([]);
  };

  it('--confirm must equal --version', async () => {
    await refuses(
      await setup(),
      { confirm: `${VERSION}x`, instructionAt: INSTRUCTION },
      /--confirm 2026-09-29\.real\.1x must equal --version 2026-09-29\.real\.1 exactly/,
    );
  });

  it('--confirm needs --instruction-at', async () => {
    await refuses(await setup(), { confirm: VERSION }, /--confirm needs --instruction-at/);
  });

  it('--instruction-at must be a UTC time, not in the future and not older than 7 days', async () => {
    await refuses(
      await setup(),
      { confirm: VERSION, instructionAt: '2026-10-04T12:30:00Z' },
      /is in the future/,
    );
    await refuses(
      await setup(),
      { confirm: VERSION, instructionAt: '2026-09-26T12:00:00Z' },
      /more than 7 days old/,
    );
    await refuses(
      await setup(),
      { confirm: VERSION, instructionAt: '2026-10-04 11:58' },
      /not an ISO-8601 UTC time/,
    );
    // Within the 5-minute skew is fine.
    const s = await setup();
    expect(await s.run({ confirm: VERSION, instructionAt: '2026-10-04T12:04:00Z' }), s.output()).toBe(0);
  });

  it('--version must be CATALOG_V3 of this checkout', async () => {
    await refuses(
      await setup(),
      { version: '2026-10-05.renewal.1', confirm: '2026-10-05.renewal.1', instructionAt: INSTRUCTION },
      /--version 2026-10-05\.renewal\.1 is not CATALOG_V3's version 2026-09-29\.real\.1/,
    );
  });

  it('refuses an expired catalog', async () => {
    const s = await setup({ now: new Date('2026-10-29T00:00:00Z') });
    await refuses(s, { confirm: VERSION, instructionAt: '2026-10-28T23:59:00Z' }, /the catalog expired/);
  });

  it('refuses a missing capture', async () => {
    const s = await setup();
    await rm(join(s.captures, `${CATALOG.sources[0].id}.txt`));
    await refuses(s, confirm, new RegExp(`missing \\(no folder has <id>\\.txt\\): ${CATALOG.sources[0].id}`));
  });

  it('refuses a capture whose hash differs, naming the folder', async () => {
    const s = await setup();
    await writeFile(join(s.captures, `${CATALOG.sources[1].id}.txt`), 'Another page.\n');
    await refuses(s, confirm, new RegExp(`differs: ${CATALOG.sources[1].id} .*${s.captures}`));
  });

  it('refuses a dirty checkout or HEAD other than origin/main, and a failed fetch', async () => {
    let s = await setup();
    s.git.status = ' M packages/rewards-core/src/catalog-v3.ts\n';
    await refuses(s, confirm, /git: uncommitted changes under .*catalog-v3\.ts/);
    s = await setup();
    s.git.head = 'ffffffffffffffffffffffffffffffffffffffff';
    await refuses(s, confirm, /git: HEAD fffffff is not origin\/main a1b2c3d/);
    s = await setup();
    s.git.fetchFails = true;
    await refuses(s, confirm, /git: git fetch origin main failed/);
  });

  it('refuses --offline with --confirm', async () => {
    const s = await setup();
    await expect(s.run({ ...confirm, offline: true })).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('pipeline publish: dry run', () => {
  it('sends no POST or PUT to the API; reports git problems instead of refusing', async () => {
    const s = await setup();
    s.git.status = ' M evals/curation/x.json\n';
    const pending = s.server.addDraft(CATALOG, null);
    expect(await s.run(), s.output()).toBe(0);
    expect(s.writes()).toEqual([]);
    expect(s.review()).toEqual(['GET /v1/review/', 'GET /v1/catalog']);
    const out = s.output();
    expect(out).toMatch(/# Publish dry run 2026-09-29\.real\.1 \(no POST or PUT is sent to the review API\)/);
    expect(out).toMatch(/- would refuse with --confirm: uncommitted changes/);
    expect(out).toMatch(/Captures: 17 of 17 sources match a bundled manifest hash for their date\./);
    expect(out).toContain(`pending drafts of ${VERSION}: ${pending.id} (revision 1`);
    expect(out).toMatch(/Served now: no release/);
    expect(out).toMatch(/agent-verified, not human-verified/);
    expect(out).toMatch(/Dry run passed\./);
  });

  it('without a session it still does the local checks and says Evan must log in', async () => {
    const s = await setup({ session: false });
    expect(await s.run(), s.output()).toBe(0);
    expect(s.output()).toMatch(/Session: none at .*Evan runs `npm run pipeline -- login`/);
    expect(s.writes()).toEqual([]);
  });

  it('--offline sends nothing at all', async () => {
    const s = await setup();
    expect(await s.run({ offline: true }), s.output()).toBe(0);
    expect(s.server.calls).toEqual([]);
    expect(s.output()).toMatch(/Remote: skipped \(--offline\)\./);
  });
});

describe('pipeline publish --confirm', () => {
  it('creates the draft, uploads every capture, saves, verifies, publishes and checks /v1/catalog', async () => {
    const s = await setup();
    expect(await s.run(confirm), s.output()).toBe(0);
    const sources = CATALOG.sources.length;
    const draft = [...s.server.drafts.values()][0];
    expect(s.review()).toEqual([
      'GET /v1/review/',
      'POST /v1/review/drafts',
      `GET /v1/review/drafts/${draft.id}`,
      ...Array(sources).fill('POST /v1/review/sources'),
      `PUT /v1/review/drafts/${draft.id}`,
      `GET /v1/review/drafts/${draft.id}`,
      `POST /v1/review/drafts/${draft.id}/publish`,
      'GET /v1/catalog',
    ]);
    const create = s.server.calls.find((call) => call.url === `${API}/v1/review/drafts`)!;
    expect(create.body).toEqual({ catalog: CATALOG, sourceDocumentIds: [], baseSequence: null });
    const publishCall = s.server.calls.find((call) => call.url.endsWith('/publish'))!;
    const note = (publishCall.body as { reviewNote: string }).reviewNote;
    expect(note).toContain('is agent-verified, not human-verified');
    expect(note).toContain(`canonical JSON SHA-256 ${jsonSha256(CATALOG)} equals CATALOG_V3 on main a1b2c3d`);
    expect(note).toContain(`all ${sources} captures match the committed manifest hashes for their dates`);
    expect(note).toContain(`Published by the coding agent on Evan's chat instruction of ${INSTRUCTION}.`);
    expect(publishCall.body).toMatchObject({ expectedRevision: 2, expectedHead: null });
    expect(draft.status).toBe('published');
    expect(draft.source_document_ids).toHaveLength(sources);
    expect(s.server.head).toBe(1);
    expect(s.output()).toContain(
      `Published release 1: ${VERSION}, 7 cards, ${sources} sources, expires ${CATALOG.expiresAt}; draft ${draft.id}.`,
    );
    expect(s.output()).toContain(`/v1/catalog serves release 1 (${VERSION}).`);
  });

  it('resumes a pending draft and skips sources already attached with the local capture', async () => {
    const s = await setup();
    const attached = CATALOG.sources.slice(0, 5).map((source) => s.server.addDoc(source, text(source.id)).id);
    // A stale capture of another source is attached too: it is dropped, and that source uploaded.
    const stale = s.server.addDoc(CATALOG.sources[5], 'An older capture.\n').id;
    const draft = s.server.addDraft(CATALOG, null, [...attached, stale]);
    expect(await s.run(confirm), s.output()).toBe(0);
    expect(s.review().filter((call) => call === 'POST /v1/review/drafts')).toEqual([]);
    expect(s.review().filter((call) => call === 'POST /v1/review/sources')).toHaveLength(
      CATALOG.sources.length - 5,
    );
    expect(s.output()).toContain(`Resuming draft ${draft.id} (revision 1).`);
    expect(s.output()).toContain(
      `Captures: 5 already attached and matching; uploading ${CATALOG.sources.length - 5}.`,
    );
    expect(draft.source_document_ids).not.toContain(stale);
    expect(draft.source_document_ids.slice(0, 5)).toEqual(attached);
    expect(draft.status).toBe('published');
  });

  it('waits out 429s with the Retry-After the API sends, then continues', async () => {
    const s = await setup();
    s.server.rateLimits.push(3, 3, 120);
    expect(await s.run(confirm), s.output()).toBe(0);
    expect(s.sleeps).toEqual([3000, 3000, 60000]);
    expect(s.output()).toMatch(/rate limit: waiting 3 s/);
    expect([...s.server.drafts.values()][0].status).toBe('published');
  });

  it('gives up after 8 consecutive 429s for one source', async () => {
    const s = await setup();
    s.server.rateLimits.push(...Array(9).fill(1));
    // The CLI prints the error's message and exits 1; a re-run resumes the draft.
    await expect(s.run(confirm)).rejects.toMatchObject({
      message: 'Too many requests. (HTTP 429, too_many_requests)',
      exitCode: 1,
    });
    expect(s.sleeps).toHaveLength(8);
    expect(s.writes().some((call) => call.endsWith('/publish'))).toBe(false);
  });

  it('refuses a draft whose catalog someone edited, before uploading or publishing', async () => {
    const s = await setup();
    const edited = structuredClone(CATALOG) as Catalog;
    edited.cards[0].name = `${edited.cards[0].name} (edited)`;
    s.server.addDraft(edited, null);
    expect(await s.run(confirm), s.output()).toBe(1);
    expect(s.output()).toMatch(/the draft's catalog .* is not CATALOG_V3 .*; someone edited it/);
    expect(s.writes()).toEqual([]);
  });

  it('refuses when the review head moved since the draft was based', async () => {
    const s = await setup();
    s.server.addDraft(CATALOG, null);
    s.server.setRelease(CATALOG_V2);
    expect(await s.run(confirm), s.output()).toBe(1);
    expect(s.output()).toMatch(/the review head moved: head 1, draft base none/);
    expect(s.writes()).toEqual([]);
  });

  it('a 401 mid-run refreshes the session once and retries the request', async () => {
    const s = await setup();
    s.server.expireAccessAfter = 6;
    expect(await s.run(confirm), s.output()).toBe(0);
    expect(s.server.refreshes).toBe(2);
    expect([...s.server.drafts.values()][0].status).toBe('published');
  });

  it('refuses a session made for another API', async () => {
    const s = await setup();
    expect(await s.run({ ...confirm, api: 'https://other.example.test' }), s.output()).toBe(1);
    expect(s.output()).toMatch(/the session is for https:\/\/api\.example\.test/);
    expect(s.writes()).toEqual([]);
    expect(s.server.calls).toEqual([]);
  });
});

describe('matchCaptures', () => {
  it('reads a file as the browser does (a leading BOM is dropped) and takes the matching folder in any order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'match-'));
    const [a, b] = [join(dir, 'a'), join(dir, 'b')];
    await mkdir(a);
    await mkdir(b);
    const source = { id: 'example-source', checkedOn: '2026-10-05' };
    await writeFile(join(a, 'example-source.txt'), 'Old page.\n');
    await writeFile(join(b, 'example-source.txt'), '﻿New page.\n');
    const manifests = [
      {
        path: 'm1/manifest.json',
        sources: [{ id: source.id, sha256: hashOf('Old page.\n'), capturedOn: '2026-10-01' }],
      },
      {
        path: 'm2/manifest.json',
        sources: [{ id: source.id, sha256: hashOf('New page.\n'), capturedOn: '2026-10-05' }],
      },
    ];
    for (const folders of [
      [a, b],
      [b, a],
    ]) {
      const match = await matchCaptures([source], folders, manifests);
      expect(match.matched.get(source.id)).toMatchObject({ folder: b, text: 'New page.\n' });
    }
    // The 2026-10-01 capture is not accepted for a source dated 2026-10-05.
    const only = await matchCaptures([source], [a], manifests);
    expect(only.differs).toEqual([{ id: source.id, folders: [a] }]);
    const unknown = await matchCaptures([source], [b], []);
    expect(unknown.unknown).toEqual([source.id]);
  });
});
