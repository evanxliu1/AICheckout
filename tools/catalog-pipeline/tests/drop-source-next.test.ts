// `pipeline drop-source` and `next` grouping the cards of a stage that share a queue code (Phase 9 milestone 2), on
// the synthetic fixture batch with a stub capture run that flags chosen sources.
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStep } from '../src/derive.ts';
import { ALPHA, BATCH, BETA, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

const ALPHA_PRODUCT = 'example-bank-alpha-product';
const BETA_PRODUCT = 'example-bank-beta-product';
const BETA_TERMS = 'example-bank-beta-terms';
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const readJson = async (h: Harness, name: string) => JSON.parse(await readFile(join(h.dir, name), 'utf8'));

/** The batch after a capture run whose report flags `flagged` (a bot wall, say). */
async function flaggedCapture(flagged: string[]): Promise<Harness> {
  const h = await harness();
  await initWithResearch(h);
  const exec = h.env.exec;
  h.env.exec = async (command, args) => {
    const code = await exec(command, args);
    if (args[0] === 'scripts/capture-issuer-pages.mjs') {
      const path = join(h.dir, args[args.indexOf('--report') + 1]);
      const rows = JSON.parse(await readFile(path, 'utf8')) as { id: string }[];
      await writeFile(
        path,
        JSON.stringify(
          rows.map((row) => (flagged.includes(row.id) ? { ...row, flags: ['short page'] } : row)),
        ),
      );
    }
    return code;
  };
  expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
  return h;
}

describe('next groups the cards of a stage that share a queue code', () => {
  it('returns every capture-flagged card in one step', async () => {
    const h = await flaggedCapture([ALPHA_PRODUCT, BETA_TERMS]);
    expect((await h.view()).queue.map((item) => [item.code, item.cardId])).toEqual([
      ['capture-flagged', ALPHA],
      ['capture-flagged', BETA],
    ]);
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'queue',
      stage: 'capture',
      code: 'capture-flagged',
      cardIds: [ALPHA, BETA],
    });
  });

  it('returns every failed-gate extract card once one has failed twice', async () => {
    const h = await harness();
    await initWithResearch(h);
    expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
    h.extract.status = 'evidence_invalid';
    for (const only of [ALPHA, ALPHA, BETA])
      expect(await h.run('run', 'extract', '--batch', BATCH, '--only', only)).toBe(0);
    const state = await h.state();
    expect([ALPHA, BETA].map((id) => state.cards[id].stages.extract?.attempts)).toEqual([2, 1]);
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'queue',
      stage: 'extract',
      code: 'gate-failed',
      cardIds: [ALPHA, BETA],
    });
  });
});

describe('pipeline drop-source', () => {
  it('removes the source from the batch files, moves its capture and records the drop by code', async () => {
    const h = await flaggedCapture([BETA_TERMS]);
    const drop = (source: string, reason: string) =>
      h.run('drop-source', '--batch', BATCH, '--source', source, '--reason', reason);
    const files = async () =>
      Promise.all(
        ['sources.json', 'manifest.json', 'cards.json', 'pipeline/state.json'].map((n) => readJson(h, n)),
      );
    const before = await files();

    expect(await drop(BETA_TERMS, 'because')).toBe(2);
    expect(await drop('example-bank-gamma-product', 'bot-wall')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/is not a source of/);
    // Alpha cites only this source: the card has to be dropped instead.
    expect(await drop(ALPHA_PRODUCT, 'bot-wall')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/example-bank-alpha would be left with no source/);
    expect(await files()).toEqual(before);

    h.clock.now = new Date('2026-10-04T11:00:00Z');
    expect(await drop(BETA_TERMS, 'bot-wall')).toBe(0);
    const [sources, manifest, cards, state] = await files();
    expect(sources.sources.map((s: { id: string }) => s.id)).toEqual([ALPHA_PRODUCT, BETA_PRODUCT]);
    expect(manifest.sources.map((s: { id: string }) => s.id)).not.toContain(BETA_TERMS);
    expect(cards.cards.map((c: { sourceIds: string[] }) => c.sourceIds)).toEqual([
      [ALPHA_PRODUCT],
      [BETA_PRODUCT],
    ]);
    expect(state.droppedSources).toEqual({
      [BETA_TERMS]: { reason: 'bot-wall', droppedAt: '2026-10-04T11:00:00.000Z' },
    });
    expect(await exists(join(h.dir, 'captures', `${BETA_TERMS}.txt`))).toBe(false);
    expect(await exists(join(h.dir, 'captures-dropped', `${BETA_TERMS}.txt`))).toBe(true);

    // No capture-flagged item any more; beta's capture is stale and re-runs without fetching anything.
    const view = await h.view();
    expect(view.queue).toEqual([]);
    expect(view.cards.map((card) => card.stages.capture.status)).toEqual(['done', 'stale']);
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'capture', cardIds: [BETA] });
    const captureRuns = h.calls.filter((call) => call[1] === 'scripts/capture-issuer-pages.mjs').length;
    expect(await h.run('run', 'capture', '--batch', BATCH, '--only', BETA)).toBe(0);
    expect(h.calls.filter((call) => call[1] === 'scripts/capture-issuer-pages.mjs').length).toBe(captureRuns);
    expect((await h.view()).cards.map((card) => card.stages.capture.status)).toEqual(['done', 'done']);
  });

  it('refuses frozen layers: a base layer, and a batch in the build config of a published version', async () => {
    const h = await flaggedCapture([BETA_TERMS]);
    const configPath = join(h.root, 'evals/curation/catalog-batches.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const base = {
      kind: 'base',
      id: 'fixture.v1',
      dir: 'evals/curation/expansion',
      corpus: 'corpus.json',
      manifest: 'manifest.json',
      overlay: null,
      notes: null,
      cards: null,
      dropped: {},
    };
    await writeFile(
      configPath,
      JSON.stringify({ ...config, publishedVersions: [config.version], layers: [base, ...config.layers] }),
    );
    expect(
      await h.run('drop-source', '--batch', 'fixture.v1', '--source', BETA_TERMS, '--reason', 'bot-wall'),
    ).toBe(1);
    expect(h.logs.at(-1)).toMatch(/fixture\.v1 is a frozen base layer/);
    expect(await h.run('drop-source', '--batch', BATCH, '--source', BETA_TERMS, '--reason', 'bot-wall')).toBe(
      1,
    );
    expect(h.logs.at(-1)).toMatch(/is a layer of the published catalog 2026-10-04\.test\.1/);
    expect(await exists(join(h.dir, 'captures', `${BETA_TERMS}.txt`))).toBe(true);
    expect((await h.state()).droppedSources).toBeUndefined();
  });
});
