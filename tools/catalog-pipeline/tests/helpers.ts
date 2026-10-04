// A throwaway repository root with the synthetic fixture batch, and stub commands standing in for the wrapped
// scripts. Captures and traces are a few fake words written here; no issuer text is ever involved.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.ts';
import { deriveBatch } from '../src/derive.ts';
import type { BatchView } from '../src/derive.ts';
import { loadBatch, statePath } from '../src/files.ts';
import { sha256Hex } from '../src/hash.ts';
import { EXTRACT_CONFIG } from '../src/inputs.ts';
import type { Env } from '../src/run.ts';
import { emptyCardState, readState, writeState } from '../src/state.ts';
import type { CardStage, State } from '../src/state.ts';

export const BATCH = 'example-bank-2026-10';
export const FIXTURE = fileURLToPath(new URL(`./fixtures/${BATCH}/`, import.meta.url));
export const ALPHA = 'example-bank-alpha';
export const BETA = 'example-bank-beta';
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The synthetic text of every fixture capture: a few fake sentences, never issuer text. */
export const captureText = (id: string): string =>
  `Synthetic page ${id}. fake alpha words 2% back. fake beta words 3X points. fake beta words 1X points. fake beta words three. fake hint words.\n`;

export interface Harness {
  env: Env;
  root: string;
  dir: string;
  logs: string[];
  calls: string[][];
  /** Exit code the stub extract returns next (3 = usage limit, before any trace is written). */
  extractExit: number[];
  /** The stub extract's trace status, and whether it hits the usage limit only after writing every trace. */
  extract: { status: string; limitAfterTraces: boolean };
  /** The text the stub capture writes for a source (change it to simulate a changed page). */
  capture: { text: (id: string) => string };
  clock: { now: Date };
  run: (...argv: string[]) => Promise<number>;
  view: () => Promise<BatchView>;
  state: () => Promise<State>;
  json: <T>(...argv: string[]) => Promise<T>;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'catalog-pipeline-'));
  const dir = join(root, 'evals/curation/batches', BATCH);
  const logs: string[] = [];
  const calls: string[][] = [];
  const extractExit: number[] = [];
  const extract = { status: 'evidence_valid', limitAfterTraces: false };
  const capture = { text: captureText };
  // The build config with this batch as its only layer, and the frozen program table and merchants it names.
  for (const name of ['reward-programs.json', 'merchants.json'])
    await cp(join(REPO, 'evals/curation/expansion', name), join(root, 'evals/curation/expansion', name));
  await writeFile(
    join(root, 'evals/curation/catalog-batches.json'),
    json({
      schemaVersion: 1,
      description: 'Test build config.',
      version: '2026-10-04.test.1',
      publishedVersions: [],
      programTable: 'evals/curation/expansion/reward-programs.json',
      merchants: 'evals/curation/expansion/merchants.json',
      layers: [{ kind: 'batch', id: BATCH, dropped: {} }],
    }),
  );
  const clock = { now: new Date('2026-10-04T10:00:00Z') };

  const exec = async (command: string, args: string[]): Promise<number> => {
    calls.push([command, ...args]);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    const script = command === 'npm' ? args.join(' ') : args[0];
    switch (script) {
      case 'scripts/capture-issuer-pages.mjs': {
        // Mirrors the script: the manifest entry is the source plus date, hash and length; --protect keeps an
        // existing capture whose text changed and reports the source as failed.
        const ids = flag('--only').split(',');
        const protect = new Set(args.includes('--protect') ? flag('--protect').split(',') : []);
        const manifestPath = join(dir, 'manifest.json');
        const previous = await readFile(manifestPath, 'utf8')
          .then((text) => JSON.parse(text).sources as { id: string }[])
          .catch(() => []);
        const byId = new Map(previous.map((entry) => [entry.id, entry]));
        const sources = JSON.parse(await readFile(join(dir, 'sources.json'), 'utf8')).sources as {
          id: string;
        }[];
        await mkdir(join(dir, 'captures'), { recursive: true });
        const report = [];
        for (const id of ids) {
          const text = capture.text(id);
          const path = join(dir, 'captures', `${id}.txt`);
          const existing = await readFile(path, 'utf8').catch(() => null);
          if (protect.has(id) && existing !== null && sha256Hex(existing) !== sha256Hex(text)) {
            report.push({
              id,
              ok: false,
              error: 'changed-capture-kept',
              flags: ['CHANGED since last capture'],
            });
            continue;
          }
          await writeFile(path, text);
          byId.set(id, {
            ...sources.find((source) => source.id === id),
            capturedOn: '2026-10-04',
            sha256: sha256Hex(text),
            length: text.length,
          } as never);
          report.push({ id, ok: true, flags: [] });
        }
        await writeFile(manifestPath, json({ schemaVersion: 1, sources: [...byId.values()] }));
        await writeFile(join(dir, flag('--report')), json(report));
        return report.every((row) => row.ok) ? 0 : 1;
      }
      case 'scripts/expansion-capture-report.mjs':
        return 0;
      case 'scripts/extract-cards.mjs': {
        const code = extractExit.shift() ?? 0;
        if (code === 3) return 3;
        const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).sources as {
          id: string;
          sha256: string;
        }[];
        const cards = JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8')).cards as {
          id: string;
          sourceIds: string[];
        }[];
        await mkdir(join(dir, 'extractions'), { recursive: true });
        for (const id of flag('--only').split(',')) {
          const card = cards.find((entry) => entry.id === id)!;
          const documents = card.sourceIds.map((sourceId) => {
            const sha = manifest.find((entry) => entry.id === sourceId)!.sha256;
            return { id: sourceId, contentHash: sha, sourceSha256: sha };
          });
          await writeFile(
            join(dir, 'extractions', `${id}.json`),
            json({
              cardId: id,
              configuration: EXTRACT_CONFIG,
              documents,
              trace: { status: extract.status },
            }),
          );
        }
        return extract.limitAfterTraces ? 3 : code;
      }
      case 'scripts/draft-expansion-labels.mjs':
        await cp(join(FIXTURE, 'corpus.draft.json'), join(dir, 'corpus.draft.json'));
        await cp(join(FIXTURE, 'product-notes.json'), join(dir, 'product-notes.json'));
        return 0;
      case 'scripts/apply-expansion-verification.mjs':
        await cp(join(FIXTURE, 'corpus.json'), join(dir, 'corpus.json'));
        await cp(join(FIXTURE, 'product-notes.verified.json'), join(dir, 'product-notes.verified.json'));
        return 0;
      case 'scripts/build-expansion-cards.mjs':
        // The real consolidation, on the temporary batch directory.
        return new Promise((done) =>
          execFile('node', [join(REPO, script), '--dir', join(root, flag('--dir'))], (error) =>
            done(error ? 1 : 0),
          ),
        );
      case 'run catalog:v3':
        return 0;
      case 'scripts/build-catalog-v3.mjs': {
        // A proposed build: three small files in --out-dir named after the config's version, nothing else.
        const out = join(root, flag('--out-dir'));
        const { version } = JSON.parse(await readFile(join(root, flag('--config')), 'utf8'));
        await mkdir(out, { recursive: true });
        await writeFile(join(out, 'catalog-v3.json'), json({ schemaVersion: 3, version }));
        await writeFile(join(out, 'catalog-build-report.md'), `# Catalog v3 build report\n\nVersion ${version}\n`);
        await writeFile(join(out, 'ledger-diff.json'), json({ schemaVersion: 1, version }));
        return 0;
      }
      default:
        throw new Error(`unexpected command ${command} ${args.join(' ')}`);
    }
  };

  const env: Env = {
    root,
    now: () => clock.now,
    exec,
    env: {},
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
  const run = (...argv: string[]) => main(argv, env);
  return {
    env,
    root,
    dir,
    logs,
    calls,
    extractExit,
    extract,
    capture,
    clock,
    run,
    view: async () => deriveBatch(await loadBatch(root, BATCH), clock.now),
    state: () => readState(statePath(dir)),
    json: async <T>(...argv: string[]) => {
      logs.length = 0;
      const code = await run(...argv, '--json');
      if (code !== 0) throw new Error(`exit ${code}: ${logs.join('\n')}`);
      return JSON.parse(logs.at(-1)!) as T;
    },
  };
}

/** `init` plus the research outputs an accepted research packet leaves (cards, sources, research file). */
export async function initWithResearch(h: Harness): Promise<void> {
  const code = await h.run(
    'init',
    BATCH,
    '--issuer',
    'Example Bank',
    '--cards',
    'Example Alpha Card, Example Beta Card',
    '--domains',
    'example.com',
    '--summary',
    'Two fixture cards',
  );
  if (code !== 0) throw new Error(h.logs.join('\n'));
  for (const name of ['cards.json', 'sources.json', 'research'])
    await cp(join(FIXTURE, name), join(h.dir, name), { recursive: true });
  await acceptIssuer(h, 'research', 'example-bank');
}

/** Stands in for milestone 3's `accept`: records the stage done with the input hash computed now. */
export async function acceptIssuer(h: Harness, stage: 'research', issuer: string): Promise<void> {
  const view = await h.view();
  const state = await h.state();
  state.issuers[issuer].stages[stage] = {
    status: 'done',
    stageVersion: `${stage}.1`,
    inputHash: view.research[issuer].inputHash,
    acceptedAt: h.clock.now.toISOString(),
  };
  await writeState(statePath(h.dir), state, h.clock.now);
}

/** Stands in for `accept verify|adjudicate|overlay`: copies the agent's file and records the cards done. */
export async function acceptCards(h: Harness, stage: CardStage, file: string | null): Promise<void> {
  if (file) await cp(join(FIXTURE, file), join(h.dir, file), { recursive: true });
  const view = await h.view();
  const state = await h.state();
  for (const card of view.cards) {
    const derived = card.stages[stage];
    if (!derived.ready || derived.status === 'done') continue;
    const cardState = (state.cards[card.cardId] ??= emptyCardState());
    cardState.stages[stage] = {
      status: 'done',
      stageVersion: `${stage}.1`,
      inputHash: derived.inputHash,
      ...(stage === 'verify' ? { anchorsHash: cardState.stages.draft?.anchorsHash } : {}),
      acceptedAt: h.clock.now.toISOString(),
    };
  }
  await writeState(statePath(h.dir), state, h.clock.now);
}

export const statuses = (view: BatchView, stage: CardStage): string[] =>
  view.cards.map((card) => card.stages[stage].status);
