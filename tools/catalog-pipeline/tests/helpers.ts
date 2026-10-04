// A throwaway repository root with the synthetic fixture batch, and stub commands standing in for the wrapped
// scripts. Captures and traces are a few fake words written here; no issuer text is ever involved.
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
  const clock = { now: new Date('2026-10-04T10:00:00Z') };

  const exec = async (command: string, args: string[]): Promise<number> => {
    calls.push([command, ...args]);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    const script = command === 'npm' ? args.join(' ') : args[0];
    switch (script) {
      case 'scripts/capture-issuer-pages.mjs': {
        const ids = flag('--only').split(',');
        const manifestPath = join(dir, 'manifest.json');
        const previous = await readFile(manifestPath, 'utf8')
          .then((text) => JSON.parse(text).sources as { id: string }[])
          .catch(() => []);
        const byId = new Map(previous.map((entry) => [entry.id, entry]));
        await mkdir(join(dir, 'captures'), { recursive: true });
        for (const id of ids) {
          const text = `fake capture words for ${id}\n`;
          await writeFile(join(dir, 'captures', `${id}.txt`), text);
          byId.set(id, {
            id,
            capturedOn: '2026-10-04',
            sha256: sha256Hex(text),
            length: text.length,
          } as never);
        }
        await writeFile(manifestPath, json({ schemaVersion: 1, sources: [...byId.values()] }));
        await writeFile(join(dir, flag('--report')), json(ids.map((id) => ({ id, ok: true, flags: [] }))));
        return 0;
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
        return 0;
      case 'run catalog:v3':
        return 0;
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
