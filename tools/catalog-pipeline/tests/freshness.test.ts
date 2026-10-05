// `pipeline freshness` and `init --refresh-from-freshness` over a synthetic two-layer build config: the fixture batch
// example-bank-2026-10 (alpha and beta) and a later batch example-bank-2026-11 that refreshed alpha. The renderer is a
// stub that writes a few fake words per source; nothing is fetched and no issuer text is involved.
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshnessRecordSchema } from '../../../scripts/lib/freshness.mjs';
import { sha256Json } from '../../../scripts/lib/catalog-batches.mjs';
import { main } from '../src/cli.ts';
import { deriveBatch } from '../src/derive.ts';
import { loadBatch } from '../src/files.ts';
import { flagCodes, freshnessPlan, runFreshness } from '../src/freshness.ts';
import type { RenderJob, Renderer } from '../src/freshness.ts';
import { sha256Hex } from '../src/hash.ts';
import type { Env } from '../src/run.ts';
import { readState } from '../src/state.ts';
import { FIXTURE, REPO } from './helpers.ts';

const OLD = 'example-bank-2026-10';
const NEW = 'example-bank-2026-11';
const ALPHA = 'example-bank-alpha';
const BETA = 'example-bank-beta';
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const text = (id: string, version = 1) => `Synthetic page ${id}, version ${version}. fake words only.\n`;
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

interface World {
  root: string;
  env: Env;
  logs: string[];
  run: (...argv: string[]) => Promise<number>;
  /** The text the stub renderer produces per source (null: fetch fails), and its flags. */
  page: Map<string, { text: string | null; flags?: string[] }>;
  jobs: RenderJob[];
  render: Renderer;
}

async function world(): Promise<World> {
  const root = await mkdtemp(join(tmpdir(), 'catalog-freshness-'));
  const logs: string[] = [];
  for (const name of ['reward-programs.json', 'merchants.json'])
    await cp(join(REPO, 'evals/curation/expansion', name), join(root, 'evals/curation/expansion', name));
  await cp(
    join(REPO, 'evals/curation/real/merchant-manifest.json'),
    join(root, 'evals/curation/real/merchant-manifest.json'),
  );
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, 'scripts/capture-issuer-pages.mjs'), '// stand-in renderer\n');
  const read = async (name: string) => JSON.parse(await readFile(join(FIXTURE, name), 'utf8'));
  const corpus = await read('corpus.json');
  const overlay = await read('catalog-overlay.json');
  const notes = await read('product-notes.verified.json');
  const cards = await read('cards.json');
  const sources = await read('sources.json');
  type Case = { cardId: string; sourceIds: string[] };
  const caseOf = (id: string) => corpus.cases.find((item: Case) => item.cardId === id);
  const paired = (ids: string[]) => ({
    ...overlay,
    cards: overlay.cards
      .filter((entry: { cardId: string }) => ids.includes(entry.cardId))
      .map((entry: { cardId: string }) => ({ ...entry, corpusCaseSha256: sha256Json(caseOf(entry.cardId)) })),
  });
  const manifest = (ids: string[], capturedOn: string, version: number) => ({
    schemaVersion: 1,
    sources: sources.sources
      .filter((source: { id: string }) => ids.includes(source.id))
      .map((source: { id: string }) => ({
        ...source,
        capturedOn,
        sha256: sha256Hex(text(source.id, version)),
        length: 40,
      })),
  });
  const layer = async (batch: string, ids: string[], capturedOn: string, version: number) => {
    const dir = join(root, 'evals/curation/batches', batch);
    await mkdir(dir, { recursive: true });
    const sourceIds = cards.cards
      .filter((card: Case & { id: string }) => ids.includes(card.id))
      .flatMap((card: Case) => card.sourceIds);
    await writeFile(
      join(dir, 'cards.json'),
      json({ ...cards, cards: cards.cards.filter((card: { id: string }) => ids.includes(card.id)) }),
    );
    await writeFile(
      join(dir, 'sources.json'),
      json({ ...sources, sources: sources.sources.filter((s: { id: string }) => sourceIds.includes(s.id)) }),
    );
    await writeFile(
      join(dir, 'corpus.json'),
      json({ ...corpus, cases: corpus.cases.filter((item: Case) => ids.includes(item.cardId)) }),
    );
    await writeFile(join(dir, 'catalog-overlay.json'), json(paired(ids)));
    await writeFile(
      join(dir, 'product-notes.verified.json'),
      json({ ...notes, cards: notes.cards.filter((card: { cardId: string }) => ids.includes(card.cardId)) }),
    );
    await writeFile(join(dir, 'manifest.json'), json(manifest(sourceIds, capturedOn, version)));
    const hinted = sourceIds.filter((id: string) => id.endsWith('-product'));
    await writeFile(
      join(dir, 'capture-hints.json'),
      json(Object.fromEntries(hinted.map((id: string) => [id, { waitFor: 'fake' }]))),
    );
  };
  await layer(OLD, [ALPHA, BETA], '2026-10-02', 1);
  await layer(NEW, [ALPHA], '2026-10-04', 2);
  await writeFile(
    join(root, 'evals/curation/catalog-batches.json'),
    json({
      schemaVersion: 1,
      description: 'Test build config, two layers.',
      version: '2026-10-04.test.1',
      publishedVersions: [],
      programTable: 'evals/curation/expansion/reward-programs.json',
      merchants: 'evals/curation/expansion/merchants.json',
      layers: [
        { kind: 'batch', id: OLD, dropped: {} },
        { kind: 'batch', id: NEW, dropped: {} },
      ],
    }),
  );
  const page = new Map<string, { text: string | null; flags?: string[] }>();
  const jobs: RenderJob[] = [];
  const render: Renderer = async (job) => {
    jobs.push(job);
    await mkdir(join(job.dir, 'captures'), { recursive: true });
    const report = [];
    for (const source of job.sources) {
      const shown = page.get(source.id) ?? { text: null };
      if (shown.text === null) {
        report.push({ id: source.id, ok: false, flags: shown.flags ?? [] });
        continue;
      }
      await writeFile(join(job.dir, 'captures', `${source.id}.txt`), shown.text);
      report.push({ id: source.id, ok: true, flags: shown.flags ?? [] });
    }
    return { report, renderer: { playwright: '1.0.0', chromium: '140.0.0.0' } };
  };
  const env: Env = {
    root,
    now: () => new Date('2026-10-20T09:00:00Z'),
    exec: async () => {
      throw new Error('no command runs in these tests');
    },
    env: {},
    log: (line) => logs.push(line),
    sleep: async () => {},
  };
  return { root, env, logs, run: (...argv) => main(argv, env), page, jobs, render };
}

const recordPath = (root: string, date: string) => join(root, 'evals/curation/freshness', `${date}.json`);
const readRecord = async (root: string, date: string) =>
  freshnessRecordSchema.parse(JSON.parse(await readFile(recordPath(root, date), 'utf8')));

describe('pipeline freshness', { timeout: 60_000 }, () => {
  it('plans every cited source with the layer whose manifest supplies its hash, and its capture hint', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    const of = (id: string) => plan.sources.find((source) => source.sourceId === id)!;
    expect(of('example-bank-alpha-product')).toMatchObject({
      layer: NEW,
      manifestSha256: sha256Hex(text('example-bank-alpha-product', 2)),
      hint: { waitFor: 'fake' },
    });
    expect(of('example-bank-beta-terms')).toMatchObject({ layer: OLD, hint: undefined });
    expect(of('check-mcc-best-buy').layer).toBe('merchants');
    expect(plan.cards.map((card) => [card.cardId, card.layer.id])).toEqual([
      [ALPHA, NEW],
      [BETA, OLD],
    ]);
  });

  it('records unchanged, changed, unreachable and flagged sources, text-free, and deletes the temporary text', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    w.page.set('example-bank-alpha-product', { text: text('example-bank-alpha-product', 2) }); // unchanged (layer 2)
    w.page.set('example-bank-beta-product', { text: text('example-bank-beta-product', 9) }); // changed
    w.page.set('example-bank-beta-terms', { text: null }); // unreachable
    w.page.set('check-mcc-best-buy', { text: 'Access Denied', flags: ['short', 'bot-wall?'] }); // flagged
    // The merchant pages are unchanged when they render their manifest's text: give them that hash's text.
    const merchant = JSON.parse(
      await readFile(join(w.root, 'evals/curation/real/merchant-manifest.json'), 'utf8'),
    );
    expect(merchant.sources.length).toBeGreaterThan(1);

    expect(await runFreshness(w.env, { render: w.render })).toBe(0);
    const record = await readRecord(w.root, '2026-10-20');
    const result = (id: string) => record.sources.find((entry) => entry.sourceId === id)!;
    expect(result('example-bank-alpha-product')).toMatchObject({
      result: 'unchanged',
      layer: NEW,
      flags: [],
    });
    expect(result('example-bank-beta-product')).toMatchObject({
      result: 'changed',
      sha256: sha256Hex(text('example-bank-beta-product', 9)),
    });
    expect(result('example-bank-beta-terms')).toMatchObject({
      result: 'unreachable',
      sha256: null,
      flags: ['fetch-failed'],
    });
    expect(result('check-mcc-best-buy')).toMatchObject({ result: 'flagged', flags: ['bot-wall', 'short'] });
    expect(record.counts).toEqual({ unchanged: 1, changed: 2, unreachable: 1, flagged: 1 });
    expect(record.renderer).toEqual({
      captureScriptSha256: sha256Hex('// stand-in renderer\n'),
      playwright: '1.0.0',
      chromium: '140.0.0.0',
    });
    // Hosts in parallel, one job per host; every temporary directory is gone.
    expect(w.jobs.map((job) => job.sources.map((source) => source.id)).sort()).toEqual([
      ['check-mcc-best-buy', 'check-mcc-newegg'],
      ['example-bank-alpha-product', 'example-bank-beta-product', 'example-bank-beta-terms'],
    ]);
    expect(w.jobs.find((job) => job.sources[0].id === 'example-bank-alpha-product')!.hints).toEqual({
      'example-bank-alpha-product': { waitFor: 'fake' },
      'example-bank-beta-product': { waitFor: 'fake' },
    });
    for (const job of w.jobs) expect(await exists(job.dir)).toBe(false);
    // No page text in the record.
    const raw = await readFile(recordPath(w.root, '2026-10-20'), 'utf8');
    expect(raw).not.toContain('Synthetic');
    expect(raw).not.toContain('Access Denied');
    const summary = w.logs.join('\n');
    expect(summary).toContain('cards with a changed source: 1');
    expect(summary).toContain(`Example Bank (1): ${BETA}`);
    expect(summary).toContain('unreachable');
    expect(summary).not.toContain('Synthetic');
  });

  it('a failing renderer still deletes its temporary directory', async () => {
    const w = await world();
    const dirs: string[] = [];
    const failing: Renderer = async (job) => {
      dirs.push(job.dir);
      await writeFile(join(job.dir, 'page.txt'), 'fake words');
      throw new Error('boom');
    };
    expect(await runFreshness(w.env, { render: failing, date: '2026-10-19' })).toBe(0);
    expect((await readRecord(w.root, '2026-10-19')).counts.unreachable).toBe(5);
    for (const dir of dirs) expect(await exists(dir)).toBe(false);
  });

  it('resumes the same day: only missing, unreachable or re-hashed sources are checked again', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    w.page.set('example-bank-beta-terms', { text: null });
    await runFreshness(w.env, { render: w.render });
    w.jobs.length = 0;
    w.page.set('example-bank-beta-terms', { text: text('example-bank-beta-terms', 1) });
    await runFreshness(w.env, { render: w.render });
    expect(w.jobs.flatMap((job) => job.sources.map((source) => source.id))).toEqual([
      'example-bank-beta-terms',
    ]);
    const record = await readRecord(w.root, '2026-10-20');
    expect(record.sources.find((entry) => entry.sourceId === 'example-bank-beta-terms')!.result).toBe(
      'unchanged',
    );
    expect(record.sources).toHaveLength(plan.sources.length);
    // --only re-checks exactly the named sources and keeps the rest of the day's record.
    w.jobs.length = 0;
    expect(await w.run('freshness', '--only', 'example-bank-alpha-product,nope')).toBe(2);
    expect(await runFreshness(w.env, { render: w.render, only: ['example-bank-beta-product'] })).toBe(0);
    expect(w.jobs.flatMap((job) => job.sources.map((source) => source.id))).toEqual([
      'example-bank-beta-product',
    ]);
    expect((await readRecord(w.root, '2026-10-20')).sources).toHaveLength(plan.sources.length);
  });

  it('refuses a date after today', async () => {
    const w = await world();
    expect(await runFreshness(w.env, { render: w.render, date: '2026-10-21' })).toBe(2);
    expect(w.logs.join('\n')).toContain('is after today (2026-10-20)');
    expect(await exists(recordPath(w.root, '2026-10-21'))).toBe(false);
  });

  it('never mixes renderers in one record: another capture script re-checks every source', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    await runFreshness(w.env, { render: w.render });
    await writeFile(join(w.root, 'scripts/capture-issuer-pages.mjs'), '// another renderer\n');
    w.jobs.length = 0;
    expect(await runFreshness(w.env, { render: w.render, only: ['example-bank-beta-product'] })).toBe(1);
    expect(w.jobs).toEqual([]);
    expect(w.logs.join('\n')).toContain('re-run without --only');
    expect(await runFreshness(w.env, { render: w.render })).toBe(0);
    expect(w.jobs.flatMap((job) => job.sources).length).toBe(plan.sources.length);
    const record = await readRecord(w.root, '2026-10-20');
    expect(record.renderer.captureScriptSha256).toBe(sha256Hex('// another renderer\n'));
    expect(record.sources).toHaveLength(plan.sources.length);
  });

  it('is refused under CI or RENDER and maps capture flags to codes', async () => {
    const w = await world();
    w.env.env = { CI: 'true' };
    expect(await w.run('freshness')).toBe(1);
    expect(w.logs.join('\n')).toContain('refused where CI is set');
    expect(await exists(join(w.root, 'evals/curation/freshness'))).toBe(false);
    expect(
      flagCodes(['HTTP 403', 'short', 'bot-wall?', 'pdf download', 'CHANGED since last capture'], false),
    ).toEqual(['bot-wall', 'fetch-failed', 'http-error', 'other', 'pdf-download', 'short']);
  });

  it('status without a batch lists the newest record counts', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    await runFreshness(w.env, { render: w.render, date: '2026-10-19' });
    await runFreshness(w.env, { render: w.render, date: '2026-10-20' });
    for (const batch of [OLD, NEW])
      expect(await w.run('init', batch, '--issuer', 'Example Bank', '--cards', ALPHA)).toBe(0);
    w.logs.length = 0;
    expect(await w.run('status', '--json')).toBe(0);
    const status = JSON.parse(w.logs[0]);
    expect(status.freshness).toEqual({
      checkedOn: '2026-10-20',
      catalogVersion: '2026-10-04.test.1',
      counts: { unchanged: 2, changed: 3, unreachable: 0, flagged: 0 },
    });
  });
});

describe('init --refresh-from-freshness', { timeout: 60_000 }, () => {
  async function checked(w: World) {
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    w.page.set('example-bank-alpha-product', { text: text('example-bank-alpha-product', 2) });
    w.page.set('example-bank-beta-terms', { text: text('example-bank-beta-terms', 7) });
    await runFreshness(w.env, { render: w.render });
  }

  it('seeds the changed cards from their current layer and records research done (seeded)', async () => {
    const w = await world();
    await checked(w);
    const batch = 'example-bank-refresh-2026-10';
    expect(
      await w.run('init', batch, '--issuer', 'Example Bank', '--refresh-from-freshness', '2026-10-20'),
    ).toBe(0);
    const dir = join(w.root, 'evals/curation/batches', batch);
    const read = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'));
    expect((await read('cards.json')).cards.map((card: { id: string }) => card.id)).toEqual([BETA]);
    expect((await read('sources.json')).sources.map((source: { id: string }) => source.id)).toEqual([
      'example-bank-beta-product',
      'example-bank-beta-terms',
    ]);
    expect(await read('capture-hints.json')).toEqual({ 'example-bank-beta-product': { waitFor: 'fake' } });
    expect((await read('exclusions.json')).exclusions).toEqual([]);
    const meta = await read('pipeline/batch.json');
    expect(meta).toMatchObject({
      refresh: true,
      requestedCards: [BETA],
      issuers: [{ name: 'Example Bank', slug: 'example-bank', domains: ['example.com'] }],
      seed: { freshness: '2026-10-20', layers: [OLD] },
    });
    const state = await readState(join(dir, 'pipeline/state.json'));
    expect(state.issuers['example-bank'].stages.research).toMatchObject({
      status: 'done',
      provenance: 'seeded',
    });
    const view = await deriveBatch(await loadBatch(w.root, batch), w.env.now());
    expect(view.research['example-bank'].status).toBe('done');
    expect(view.cards.map((card) => [card.cardId, card.stages.capture.status])).toEqual([[BETA, 'pending']]);
    w.logs.length = 0;
    await w.run('next', '--batch', batch, '--json');
    expect(JSON.parse(w.logs[0])).toMatchObject({ kind: 'cli', stage: 'capture' });
    w.logs.length = 0;
    await w.run('status', '--batch', batch);
    expect(w.logs[0]).toContain('research seeded from freshness 2026-10-20');
    // Editing a seed file makes research stale, and next hands it to the session (no researcher agent).
    await writeFile(join(dir, 'capture-hints.json'), json({}));
    w.logs.length = 0;
    await w.run('next', '--batch', batch, '--json');
    expect(JSON.parse(w.logs[0])).toMatchObject({ kind: 'queue', stage: 'research', code: 'gate-failed' });
    await writeFile(join(dir, 'capture-hints.json'), json({}));
    expect(
      (await deriveBatch(await loadBatch(w.root, batch), w.env.now())).research['example-bank'].status,
    ).toBe('stale');
  });

  it('takes an unchanged card only when --cards names it, and refuses other issuers and missing records', async () => {
    const w = await world();
    await checked(w);
    // Alpha's page is unchanged: by default only beta is seeded; naming alpha takes it from its newest layer.
    expect(
      await w.run(
        'init',
        'example-bank-alpha-2026-10',
        '--issuer',
        'Example Bank',
        '--refresh-from-freshness',
        '2026-10-20',
        '--cards',
        ALPHA,
      ),
    ).toBe(0);
    const meta = JSON.parse(
      await readFile(
        join(w.root, 'evals/curation/batches/example-bank-alpha-2026-10/pipeline/batch.json'),
        'utf8',
      ),
    );
    expect(meta.requestedCards).toEqual([ALPHA]);
    expect(meta.seed.layers).toEqual([NEW]);
    expect(w.logs.join('\n')).toContain(`Named explicitly, no changed source in the record: ${ALPHA}`);
    expect(
      await w.run(
        'init',
        'other-2026-10',
        '--issuer',
        'Example Bank',
        '--refresh-from-freshness',
        '2026-10-20',
        '--cards',
        'nope',
      ),
    ).toBe(1);
    expect(
      await w.run(
        'init',
        'other-2026-10',
        '--issuer',
        'Other Bank',
        '--refresh-from-freshness',
        '2026-10-20',
      ),
    ).toBe(1);
    expect(
      await w.run(
        'init',
        'other-2026-10',
        '--issuer',
        'Example Bank',
        '--refresh-from-freshness',
        '2026-10-01',
      ),
    ).toBe(1);
    expect(await exists(join(w.root, 'evals/curation/batches/other-2026-10'))).toBe(false);
  });

  it('refuses when no card of the issuer changed and none is named', async () => {
    const w = await world();
    const plan = await freshnessPlan(w.root);
    for (const source of plan.sources) w.page.set(source.sourceId, { text: text(source.sourceId, 1) });
    w.page.set('example-bank-alpha-product', { text: text('example-bank-alpha-product', 2) });
    await runFreshness(w.env, { render: w.render });
    expect(
      await w.run(
        'init',
        'example-bank-refresh-2026-10',
        '--issuer',
        'Example Bank',
        '--refresh-from-freshness',
        '2026-10-20',
      ),
    ).toBe(1);
    expect(w.logs.join('\n')).toContain('found no changed source');
  });
});

describe('freshness on the committed build config', { timeout: 120_000 }, () => {
  it('plans the 328 cited sources, one entry per card, and seeds a real card from its research entry', async () => {
    // A copy of the committed config, layers and research (no captures); the record below is synthetic.
    const root = await mkdtemp(join(tmpdir(), 'catalog-freshness-repo-'));
    for (const path of [
      'evals/curation/catalog-batches.json',
      'evals/curation/expansion',
      'evals/curation/real',
      'docs/research/cards-2026',
      'scripts/capture-issuer-pages.mjs',
    ])
      await cp(join(REPO, path), join(root, path), { recursive: true });
    const plan = await freshnessPlan(root);
    expect(plan.sources).toHaveLength(328);
    expect(new Set(plan.cards.map((card) => card.cardId)).size).toBe(plan.cards.length);
    const citi = plan.cards.find((card) => card.cardId === 'citi-double-cash')!;
    expect(citi.layer.id).toBe('real.v2.2');
    const entries = plan.sources.map((source) => ({
      sourceId: source.sourceId,
      layer: source.layer,
      manifestSha256: source.manifestSha256,
      sha256: source.sourceId === 'citi-double-cash-product' ? 'f'.repeat(64) : source.manifestSha256,
      result: source.sourceId === 'citi-double-cash-product' ? 'changed' : 'unchanged',
      flags: [],
      checkedOn: '2026-10-20',
    }));
    await mkdir(join(root, 'evals/curation/freshness'), { recursive: true });
    await writeFile(
      recordPath(root, '2026-10-20'),
      json({
        schemaVersion: 1,
        checkedOn: '2026-10-20',
        catalogVersion: plan.version,
        renderer: { captureScriptSha256: 'a'.repeat(64), playwright: null, chromium: null },
        counts: { unchanged: entries.length - 1, changed: 1, unreachable: 0, flagged: 0 },
        sources: entries,
      }),
    );
    const logs: string[] = [];
    const env: Env = {
      root,
      now: () => new Date('2026-10-20T09:00:00Z'),
      exec: async () => 1,
      env: {},
      log: (line) => logs.push(line),
      sleep: async () => {},
    };
    expect(
      await main(
        ['init', 'citi-refresh-2026-10', '--issuer', 'Citi', '--refresh-from-freshness', '2026-10-20'],
        env,
      ),
    ).toBe(0);
    const dir = join(root, 'evals/curation/batches/citi-refresh-2026-10');
    const cards = JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8')).cards;
    expect(cards).toEqual([
      expect.objectContaining({
        id: 'citi-double-cash',
        issuer: 'Citi',
        research: 'docs/research/cards-2026/citi.json',
        sourceIds: citi.sourceIds,
      }),
    ]);
    const sources = JSON.parse(await readFile(join(dir, 'sources.json'), 'utf8')).sources;
    expect(sources.map((source: { id: string }) => source.id)).toEqual(citi.sourceIds);
    expect(JSON.parse(await readFile(join(dir, 'pipeline/batch.json'), 'utf8')).seed).toEqual({
      freshness: '2026-10-20',
      layers: ['real.v2.2'],
    });
  });
});
