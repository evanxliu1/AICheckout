// `run build` and catalog versions (Phase 9 milestone 2): a proposed build changes nothing that ships, and a published
// version is never rebuilt without a new --version. Synthetic fixture batch; the builder is the harness stub.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStep } from '../src/derive.ts';
import type { StatusJson } from '../src/cli.ts';
import { BATCH, acceptCards, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

const CONFIG = 'evals/curation/catalog-batches.json';
/** The files that decide what ships; placeholders here, compared byte for byte. */
const SHIPPING = [
  CONFIG,
  'evals/curation/rule-id-ledger.json',
  'packages/rewards-core/src/catalog-v3.ts',
  'evals/curation/expansion/catalog-build-report.md',
];

const BASE = {
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

async function overlaid(): Promise<Harness> {
  const h = await harness();
  await initWithResearch(h);
  for (const stage of ['capture', 'extract', 'draft'])
    expect(await h.run('run', stage, '--batch', BATCH), h.logs.join('\n')).toBe(0);
  await acceptCards(h, 'verify', 'verification');
  await acceptCards(h, 'adjudicate', null);
  expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);
  await acceptCards(h, 'overlay', 'catalog-overlay.json');
  // The harness config has the batch as its only layer; start from a config with a base layer only.
  const config = JSON.parse(await readFile(join(h.root, CONFIG), 'utf8'));
  await writeFile(join(h.root, CONFIG), JSON.stringify({ ...config, layers: [BASE] }, null, 2) + '\n');
  for (const path of SHIPPING.slice(1)) {
    await mkdir(join(h.root, path, '..'), { recursive: true });
    await writeFile(join(h.root, path), `placeholder ${path}\n`);
  }
  return h;
}
const snapshot = (h: Harness) => Promise.all(SHIPPING.map((path) => readFile(join(h.root, path), 'utf8')));
async function publish(h: Harness, versions: string[]): Promise<void> {
  const config = JSON.parse(await readFile(join(h.root, CONFIG), 'utf8'));
  await writeFile(
    join(h.root, CONFIG),
    JSON.stringify({ ...config, publishedVersions: versions }, null, 2) + '\n',
  );
}

describe('run build --proposed', () => {
  it('builds into pipeline/proposed/ and leaves the config, ledger, CATALOG_V3 and build report byte for byte', async () => {
    const h = await overlaid();
    const before = await snapshot(h);
    expect(
      await h.run('run', 'build', '--batch', BATCH, '--proposed', '--version', '2026-10-05.test.1'),
      h.logs.join('\n'),
    ).toBe(0);
    expect(await snapshot(h)).toEqual(before);
    expect(h.calls.at(-1)).toEqual([
      'node',
      'scripts/build-catalog-v3.mjs',
      '--config',
      `evals/curation/batches/${BATCH}/pipeline/proposed/catalog-batches.json`,
      '--out-dir',
      `evals/curation/batches/${BATCH}/pipeline/proposed`,
    ]);
    expect(h.calls.some((call) => call.join(' ') === 'npm run catalog:v3')).toBe(false);
    const proposed = JSON.parse(
      await readFile(join(h.dir, 'pipeline/proposed/catalog-batches.json'), 'utf8'),
    );
    expect(proposed).toMatchObject({
      version: '2026-10-05.test.1',
      publishedVersions: [],
      layers: [BASE, { kind: 'batch', id: BATCH, dropped: {} }],
    });
    const record = (await h.state()).batchStages.build!;
    expect(record).toMatchObject({ status: 'done', proposed: true, catalogVersion: '2026-10-05.test.1' });
    expect(record.outputs).toEqual([
      {
        ref: `file:evals/curation/batches/${BATCH}/pipeline/proposed/catalog-v3.json`,
        sha256: expect.any(String),
      },
    ]);
    expect(h.logs.at(-1)).toMatch(/nothing that ships changed/);

    // Eval runs after a proposed build; with eval done, next hands off without a publish item.
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'eval' });
    const state = await h.state();
    state.batchStages.eval = { status: 'done', inputHash: (await h.view()).eval.inputHash };
    await writeFile(join(h.dir, 'pipeline/state.json'), JSON.stringify(state));
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'handoff',
      reason: expect.stringMatching(/proposed \(2026-10-05\.test\.1\) and ships nothing/),
    });
    const status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].queue.map((item) => item.code)).not.toContain('publish');
  });

  it('needs --version, and the version must not be published', async () => {
    const h = await overlaid();
    await publish(h, ['2026-10-04.test.1']);
    const before = await snapshot(h);
    expect(await h.run('run', 'build', '--batch', BATCH, '--proposed')).toBe(2);
    expect(h.logs.at(-1)).toMatch(/--proposed needs --version/);
    expect(
      await h.run('run', 'build', '--batch', BATCH, '--proposed', '--version', '2026-10-04.test.1'),
    ).toBe(2);
    expect(h.logs.at(-1)).toMatch(/2026-10-04\.test\.1 is published/);
    expect(await h.run('run', 'extract', '--batch', BATCH, '--version', '2026-10-05.test.1')).toBe(2);
    expect(await snapshot(h)).toEqual(before);
    expect((await h.state()).batchStages.build).toEqual({ status: 'pending' });
  });
});

describe('run build (shipping)', () => {
  it('refuses a published config version without --version, then registers the batch under the new one', async () => {
    const h = await overlaid();
    await publish(h, ['2026-10-04.test.1']);
    const before = await snapshot(h);
    expect(await h.run('run', 'build', '--batch', BATCH)).toBe(2);
    expect(h.logs.at(-1)).toMatch(/version 2026-10-04\.test\.1 is published; pass --version/);
    expect(await h.run('run', 'build', '--batch', BATCH, '--version', 'not-a-version')).toBe(2);
    expect(await snapshot(h)).toEqual(before);

    expect(await h.run('run', 'build', '--batch', BATCH, '--version', '2026-10-05.test.1')).toBe(0);
    expect(h.calls.at(-1)).toEqual(['npm', 'run', 'catalog:v3']);
    const config = JSON.parse(await readFile(join(h.root, CONFIG), 'utf8'));
    expect(config).toMatchObject({
      version: '2026-10-05.test.1',
      publishedVersions: ['2026-10-04.test.1'],
      layers: [BASE, { kind: 'batch', id: BATCH, dropped: {} }],
    });
    const record = (await h.state()).batchStages.build!;
    expect(record.catalogVersion).toBe('2026-10-05.test.1');
    expect(record.proposed).toBeUndefined();
  });
});
