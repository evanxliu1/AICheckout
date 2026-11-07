// `pipeline capture-import`: a page read in the desktop browser pane goes through the capture stage's normalization
// and flags and replaces a capture that failed the gate, never one that passed. Synthetic text only.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash.ts';
import { ALPHA, BATCH, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

const ALPHA_PRODUCT = 'example-bank-alpha-product';
/** Synthetic page text over the 2,000-character `short` limit, with Windows line ends and trailing spaces. */
const PAGE = Array.from(
  { length: 60 },
  (_, i) => `Synthetic pane line ${i}: fake alpha words 2% back.   `,
).join('\r\n');

/** The batch after a capture run on which alpha's product page answered with a bot wall. */
async function botWalled(): Promise<Harness> {
  const h = await harness();
  await initWithResearch(h);
  const exec = h.env.exec;
  h.env.exec = async (command, args) => {
    const code = await exec(command, args);
    if (args[0] === 'scripts/capture-issuer-pages.mjs') {
      const path = join(h.dir, args[args.indexOf('--report') + 1]);
      const rows = JSON.parse(await readFile(path, 'utf8')) as { id: string; flags: string[] }[];
      for (const row of rows) if (row.id === ALPHA_PRODUCT) row.flags = ['HTTP 403', 'short', 'bot-wall?'];
      await writeFile(path, JSON.stringify(rows));
    }
    return code;
  };
  expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
  h.env.exec = exec;
  expect((await h.view()).cards.find((card) => card.cardId === ALPHA)!.stages.capture.status).toBe(
    'failed-gate',
  );
  return h;
}

const importArgs = (file: string, ...extra: string[]) => [
  'capture-import',
  '--batch',
  BATCH,
  '--source',
  ALPHA_PRODUCT,
  '--file',
  file,
  '--method',
  'browser-pane',
  '--by',
  'claude-code/claude-opus-5-5',
  ...extra,
];

describe('capture-import', () => {
  it('normalizes the text like the capture script, records the method and passes the gate', async () => {
    const h = await botWalled();
    h.clock.now = new Date('2026-10-05T12:00:00Z');
    const file = join(h.root, 'pane.txt');
    await writeFile(file, PAGE);
    expect(await h.run(...importArgs(file, '--status', '200'))).toBe(0);

    const text = await readFile(join(h.dir, 'captures', `${ALPHA_PRODUCT}.txt`), 'utf8');
    expect(text).not.toMatch(/\r| \n/);
    expect(text.endsWith('back.\n')).toBe(true);
    const manifest = JSON.parse(await readFile(join(h.dir, 'manifest.json'), 'utf8')).sources;
    expect(manifest.map((entry: { id: string }) => entry.id)).toEqual([
      'example-bank-alpha-product',
      'example-bank-beta-product',
      'example-bank-beta-terms',
    ]);
    expect(manifest[0]).toMatchObject({
      id: ALPHA_PRODUCT,
      url: 'https://www.example.com/alpha',
      capturedOn: '2026-10-05',
      sha256: sha256Hex(text),
      length: text.length,
      method: 'browser-pane',
      capturedBy: 'claude-code/claude-opus-5-5',
      capturedAt: '2026-10-05T12:00:00.000Z',
    });
    expect(manifest[1].method).toBeUndefined();
    const reports = (await readdir(join(h.dir, 'parts'))).filter((name) => name.includes('-import-'));
    expect(reports).toHaveLength(1);
    expect(JSON.parse(await readFile(join(h.dir, 'parts', reports[0]), 'utf8'))).toEqual([
      { id: ALPHA_PRODUCT, ok: true, status: 200, length: text.length, flags: [], method: 'browser-pane' },
    ]);
    expect(h.calls.at(-1)).toEqual([
      'node',
      'scripts/expansion-capture-report.mjs',
      '--dir',
      `evals/curation/batches/${BATCH}`,
      '--batch',
    ]);
    expect((await h.view()).cards.find((card) => card.cardId === ALPHA)!.stages.capture.status).toBe('done');
  });

  it('applies the capture flags: a short challenge page stays capture-flagged', async () => {
    const h = await botWalled();
    h.clock.now = new Date('2026-10-05T12:00:00Z');
    const file = join(h.root, 'pane.txt');
    await writeFile(file, 'Please verify you are human.\n');
    expect(await h.run(...importArgs(file))).toBe(1);
    expect(h.logs.at(-1)).toMatch(/flagged: short, bot-wall\?/);
    const view = await h.view();
    expect(view.cards.find((card) => card.cardId === ALPHA)!.stages.capture.status).toBe('failed-gate');
    expect(view.queue).toMatchObject([{ code: 'capture-flagged', cardId: ALPHA }]);
  });

  it('never replaces a capture that passed the gate, and refuses unknown methods', async () => {
    const h = await harness();
    await initWithResearch(h);
    expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
    const path = join(h.dir, 'captures', `${ALPHA_PRODUCT}.txt`);
    const before = await readFile(path, 'utf8');
    const file = join(h.root, 'pane.txt');
    await writeFile(file, PAGE);
    expect(await h.run(...importArgs(file))).toBe(1);
    expect(h.logs.at(-1)).toMatch(/changed-capture-kept/);
    expect(await readFile(path, 'utf8')).toBe(before);
    const args = importArgs(file);
    args[args.indexOf('browser-pane')] = 'hand-copied';
    expect(await h.run(...args)).toBe(2);
  });
});
