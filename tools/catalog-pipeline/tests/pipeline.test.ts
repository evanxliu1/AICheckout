import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStep } from '../src/derive.ts';
import type { StatusJson } from '../src/cli.ts';
import { batchFileSchema, loadBatch, statePath } from '../src/files.ts';
import { anchorsHash, labelsHash } from '../src/hash.ts';
import { writeState } from '../src/state.ts';
import { ALPHA, BATCH, BETA, acceptCards, harness, initWithResearch, statuses } from './helpers.ts';
import type { Harness } from './helpers.ts';

/** Runs the batch through every stage up to and including `last` (agent stages via the stand-in accept). */
async function advance(h: Harness, last: string): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['capture', () => h.run('run', 'capture', '--batch', BATCH)],
    ['extract', () => h.run('run', 'extract', '--batch', BATCH)],
    ['draft', () => h.run('run', 'draft', '--batch', BATCH)],
    ['verify', () => acceptCards(h, 'verify', 'verification')],
    ['adjudicate', () => acceptCards(h, 'adjudicate', null)],
    ['apply', () => h.run('run', 'apply', '--batch', BATCH)],
    ['overlay', () => acceptCards(h, 'overlay', 'catalog-overlay.json')],
    ['build', () => h.run('run', 'build', '--batch', BATCH)],
  ];
  for (const [stage, step] of steps) {
    const code = await step();
    if (typeof code === 'number' && code !== 0)
      throw new Error(`${stage} exited ${code}: ${h.logs.join('\n')}`);
    if (stage === last) return;
  }
}

describe('init', () => {
  it('creates batch.json and state.json and refuses an existing batch', async () => {
    const h = await harness();
    await initWithResearch(h);
    const meta = batchFileSchema.parse(
      JSON.parse(await readFile(join(h.dir, 'pipeline/batch.json'), 'utf8')),
    );
    expect(meta).toMatchObject({
      batch: BATCH,
      issuers: [{ name: 'Example Bank', slug: 'example-bank', domains: ['example.com'] }],
      requestedCards: ['Example Alpha Card', 'Example Beta Card'],
      refresh: false,
      summary: 'Two fixture cards',
    });
    const state = await h.state();
    expect(state.batch).toBe(BATCH);
    expect(state.batchStages).toEqual({ build: { status: 'pending' }, eval: { status: 'pending' } });
    expect(await h.run('init', BATCH, '--issuer', 'Example Bank', '--cards', 'x')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/already exists/);
  });

  it('rejects a malformed batch id', async () => {
    const h = await harness();
    expect(await h.run('init', 'Example_Bank', '--issuer', 'Example Bank', '--cards', 'x')).toBe(2);
    expect(await h.run('init', 'example-bank-2026', '--issuer', 'Example Bank', '--cards', 'x')).toBe(2);
  });

  it('starts with research for the issuer', async () => {
    const h = await harness();
    await h.run('init', BATCH, '--issuer', 'Example Bank', '--cards', 'Example Alpha Card');
    const step = await h.json<NextStep>('next');
    expect(step).toMatchObject({
      kind: 'agent',
      stage: 'research',
      issuer: 'example-bank',
      agent: 'card-researcher',
    });
    expect(step.command).toBe(`npm run pipeline -- claim research --batch ${BATCH} --issuer example-bank`);
  });
});

describe('status and next through the stages', () => {
  it('walks capture → extract → draft → verify → adjudicate → apply → overlay → build → handoff', async () => {
    const h = await harness();
    await initWithResearch(h);
    const expectNext = async (expected: Partial<NextStep>) =>
      expect(await h.json<NextStep>('next')).toMatchObject(expected);

    await expectNext({ kind: 'cli', stage: 'capture', cardIds: [ALPHA, BETA] });
    await advance(h, 'capture');
    expect(h.calls.at(-2)).toEqual([
      'node',
      'scripts/capture-issuer-pages.mjs',
      '--dir',
      `evals/curation/batches/${BATCH}`,
      '--only',
      'example-bank-alpha-product,example-bank-beta-product,example-bank-beta-terms',
      '--delay-ms',
      '2500',
      '--report',
      expect.stringMatching(/^parts\/report\.pipeline-.*\.json$/),
    ]);
    await expectNext({
      kind: 'cli',
      stage: 'extract',
      command: `npm run pipeline -- run extract --batch ${BATCH} --only ${ALPHA},${BETA}`,
    });
    await advance(h, 'extract');
    expect(h.calls.at(-1)).toContain('--wait-minutes');
    await expectNext({ kind: 'cli', stage: 'draft' });
    await advance(h, 'draft');
    await expectNext({
      kind: 'agent',
      stage: 'verify',
      agent: 'card-verifier',
      issuer: 'example-bank',
      cardIds: [ALPHA, BETA],
    });
    await acceptCards(h, 'verify', 'verification');
    await expectNext({ kind: 'agent', stage: 'adjudicate', agent: 'card-adjudicator' });
    await acceptCards(h, 'adjudicate', null);
    await expectNext({ kind: 'cli', stage: 'apply' });
    await h.run('run', 'apply', '--batch', BATCH);
    expect(h.calls.at(-1)).toEqual([
      'node',
      'scripts/apply-expansion-verification.mjs',
      '--dir',
      `evals/curation/batches/${BATCH}`,
      '--version',
      `${BATCH}.v1`,
    ]);
    await expectNext({ kind: 'agent', stage: 'overlay', agent: 'card-overlay-author' });
    await acceptCards(h, 'overlay', 'catalog-overlay.json');
    await expectNext({
      kind: 'cli',
      stage: 'build',
      command: `npm run pipeline -- run build --batch ${BATCH}`,
    });
    expect(await h.run('run', 'build', '--batch', BATCH)).toBe(0);
    await expectNext({ kind: 'cli', stage: 'eval' });
    expect(await h.run('run', 'eval', '--batch', BATCH)).toBe(2);
    expect(h.logs.at(-1)).toMatch(/milestone 5/);

    // Eval arrives in milestone 5; with it recorded done, the queue holds the publish item and next hands off.
    const state = await h.state();
    const view = await h.view();
    state.batchStages.eval = { status: 'done', inputHash: view.eval.inputHash };
    await writeFile(join(h.dir, 'pipeline/state.json'), JSON.stringify(state));
    await expectNext({ kind: 'handoff', stage: 'publish' });
    const status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].queue).toEqual([
      {
        batch: BATCH,
        stage: 'publish',
        code: 'publish',
        ref: `evals/curation/batches/${BATCH}/pipeline/state.json`,
        owner: 'evan',
      },
    ]);
    expect(status.batches[0].counts.freshness).toEqual({ pending: 2 });
    expect(status.batches[0].counts.apply).toEqual({ done: 2 });
  });

  it('lists open packets and never writes a queue file', async () => {
    const h = await harness();
    await initWithResearch(h);
    await mkdir(join(h.dir, 'pipeline/packets'), { recursive: true });
    await writeFile(join(h.dir, 'pipeline/packets/verify.example-bank.1.json'), '{}');
    const status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].packets).toEqual(['verify.example-bank.1.json']);
    expect((await readdir(join(h.dir, 'pipeline'))).sort()).toEqual(['batch.json', 'packets', 'state.json']);
  });

  it('skips cards that are done with a matching input hash', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    const calls = h.calls.length;
    expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
    expect(h.calls.length).toBe(calls);
    expect(h.logs.at(-1)).toMatch(/nothing to run/);
  });
});

describe('hashing and invalidation', () => {
  it('a changed source makes capture stale and the staleness propagates downstream', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    let view = await h.view();
    expect(statuses(view, 'overlay')).toEqual(['done', 'done']);

    const sources = JSON.parse(await readFile(join(h.dir, 'sources.json'), 'utf8'));
    sources.sources[0].url = 'https://www.example.com/alpha-new';
    await writeFile(join(h.dir, 'sources.json'), JSON.stringify(sources));
    view = await h.view();
    const alpha = view.cards.find((card) => card.cardId === ALPHA)!;
    const beta = view.cards.find((card) => card.cardId === BETA)!;
    expect(alpha.stages.capture.status).toBe('stale');
    for (const stage of ['extract', 'draft', 'verify', 'adjudicate', 'apply', 'overlay'] as const)
      expect(alpha.stages[stage].status).toBe('stale');
    expect(beta.stages.overlay.status).toBe('done');
    expect(view.build.status).not.toBe('done');
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'capture', cardIds: [ALPHA] });
  });

  it('a new researcher agent file makes research stale, and capture with it', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    await mkdir(join(h.root, '.claude/agents'), { recursive: true });
    await writeFile(join(h.root, '.claude/agents/card-researcher.md'), 'v2');
    const view = await h.view();
    expect(view.research['example-bank'].status).toBe('stale');
    expect(statuses(view, 'capture')).toEqual(['stale', 'stale']);
  });

  it('a missing capture is inputs-missing, not stale; a changed manifest hash is stale', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    await rm(join(h.dir, 'captures/example-bank-alpha-product.txt'));
    let view = await h.view();
    expect(statuses(view, 'extract')).toEqual(['inputs-missing', 'pending']);
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(0);
    expect(h.logs.join('\n')).toMatch(/inputs missing on this machine for example-bank-alpha/);
    view = await h.view();
    expect(statuses(view, 'extract')).toEqual(['inputs-missing', 'done']);

    // Beta's extraction stands while its trace exists; without the trace, draft cannot be hashed.
    await advance(h, 'draft');
    await rm(join(h.dir, 'extractions', `${BETA}.json`));
    view = await h.view();
    expect(view.cards[1].stages.draft.status).toBe('inputs-missing');
    expect(view.cards[1].stages.verify.status).toBe('pending');

    const manifest = JSON.parse(await readFile(join(h.dir, 'manifest.json'), 'utf8'));
    manifest.sources.find((entry: { id: string }) => entry.id === 'example-bank-beta-terms').sha256 =
      'a'.repeat(64);
    await writeFile(join(h.dir, 'manifest.json'), JSON.stringify(manifest));
    view = await h.view();
    expect(view.cards[1].stages.extract.status).toBe('stale');
  });
});

describe('labels and anchors split', () => {
  async function redraft(
    h: Harness,
    edit: (draft: { cases: { reference: { rules: Record<string, unknown>[] } }[] }) => void,
  ) {
    const fixture = JSON.parse(await readFile(join(h.dir, 'corpus.draft.json'), 'utf8'));
    edit(fixture);
    // A new trace makes the draft stale; the stub re-draft copies the fixture, so the edited draft is written
    // after it and recorded as the draft output (what a real re-draft would have produced).
    const trace = join(h.dir, 'extractions', `${BETA}.json`);
    await writeFile(trace, (await readFile(trace, 'utf8')) + ' ');
    expect(await h.run('run', 'draft', '--batch', BATCH)).toBe(0);
    await writeFile(join(h.dir, 'corpus.draft.json'), JSON.stringify(fixture));
    const batch = await loadBatch(h.root, BATCH);
    const draft = batch.draft.get(BETA)!;
    Object.assign(batch.state.cards[BETA].stages.draft!, {
      labelsHash: labelsHash(draft),
      anchorsHash: anchorsHash(draft),
    });
    await writeState(statePath(h.dir), batch.state, h.clock.now);
  }

  it('an anchor-only re-draft keeps verify, adjudicate and overlay done and asks for a rebase', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    await redraft(h, (draft) => {
      const rule = draft.cases[1].reference.rules[0];
      rule.anchors = ['fake beta words three'];
    });
    let view = await h.view();
    const beta = view.cards[1];
    expect(beta.stages.draft.status).toBe('done');
    expect(beta.stages.verify.status).toBe('done');
    expect(beta.stages.adjudicate.status).toBe('done');
    expect(beta.stages.apply.status).toBe('stale');
    expect(beta.stages.overlay.status).toBe('done');
    expect(beta.rebaseAnchors).toBe(true);
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'cli',
      stage: 'verify',
      cardIds: [BETA],
      command: `npm run pipeline -- rebase-anchors --batch ${BATCH}`,
    });

    expect(await h.run('rebase-anchors', '--batch', BATCH)).toBe(0);
    const findings = JSON.parse(await readFile(join(h.dir, 'verification/example-bank.json'), 'utf8'));
    expect(findings.cards[1].fixes[0].current).toBe('fake beta words three');
    view = await h.view();
    expect(view.cards[1].rebaseAnchors).toBe(false);
    expect(view.cards[1].stages.adjudicate.status).toBe('done');
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'apply', cardIds: [BETA] });
  });

  it('a label change makes verify and everything after it stale', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    await redraft(h, (draft) => {
      draft.cases[1].reference.rules[0].rateBps = 400;
    });
    const view = await h.view();
    const beta = view.cards[1];
    expect(beta.stages.verify.status).toBe('stale');
    expect(beta.stages.adjudicate.status).toBe('stale');
    expect(beta.stages.overlay.status).toBe('stale');
    expect(beta.rebaseAnchors).toBe(false);
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'agent', stage: 'verify', cardIds: [BETA] });
  });
});

describe('model stages and usage limits', () => {
  it('refuses extract when CI or RENDER is set', async () => {
    for (const name of ['CI', 'RENDER']) {
      const h = await harness();
      await initWithResearch(h);
      await advance(h, 'capture');
      h.env.env = { [name]: 'true' };
      const calls = h.calls.length;
      expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(1);
      expect(h.logs.at(-1)).toMatch(new RegExp(`Refusing to run the model stage extract: ${name} set`));
      expect(h.calls.length).toBe(calls);
    }
  });

  it('exit 3 pauses the cards with pausedUntil and the CLI exits 3; a later run resumes', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    h.extractExit.push(3);
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(3);
    const state = await h.state();
    expect(state.cards[ALPHA].stages.extract).toMatchObject({
      status: 'paused',
      reason: 'usage-limit',
      pausedUntil: '2026-10-04T10:15:00.000Z',
    });
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'wait', until: '2026-10-04T10:15:00.000Z' });
    h.clock.now = new Date('2026-10-04T10:16:00Z');
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'extract' });
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(0);
    expect(statuses(await h.view(), 'extract')).toEqual(['done', 'done']);
  });

  it('--wait-minutes waits and resumes the paused cards', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    h.extractExit.push(3, 0);
    expect(
      await h.run('run', 'extract', '--batch', BATCH, '--wait-minutes', '20', '--concurrency', '2'),
    ).toBe(0);
    expect(h.clock.now.toISOString()).toBe('2026-10-04T10:20:00.000Z');
    const extractCalls = h.calls.filter((call) => call[1] === 'scripts/extract-cards.mjs');
    expect(extractCalls).toHaveLength(2);
    expect(extractCalls[0]).toEqual([
      'node',
      'scripts/extract-cards.mjs',
      '--dir',
      `evals/curation/batches/${BATCH}`,
      '--only',
      `${ALPHA},${BETA}`,
      '--concurrency',
      '2',
      '--wait-minutes',
      '0',
    ]);
    expect(statuses(await h.view(), 'extract')).toEqual(['done', 'done']);
  });
});

describe('review fixes', () => {
  it('a re-draft with another issuer wording makes verify stale', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    const draft = JSON.parse(await readFile(join(h.dir, 'corpus.draft.json'), 'utf8'));
    draft.cases[1].reference.rules[0].issuerWording = 'fake beta words';
    await writeFile(join(h.dir, 'corpus.draft.json'), JSON.stringify(draft));
    const beta = (await h.view()).cards[1];
    expect(beta.stages.verify.status).toBe('stale');
    expect(beta.stages.overlay.status).toBe('stale');
    expect(beta.rebaseAnchors).toBe(false);
  });

  it('a changed manifest hash is stale even where the captures are missing, and downstream follows', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    await rm(join(h.dir, 'captures'), { recursive: true });
    let view = await h.view();
    expect(statuses(view, 'extract')).toEqual(['done', 'done']);
    const manifest = JSON.parse(await readFile(join(h.dir, 'manifest.json'), 'utf8'));
    manifest.sources[0].sha256 = 'a'.repeat(64);
    await writeFile(join(h.dir, 'manifest.json'), JSON.stringify(manifest));
    view = await h.view();
    const alpha = view.cards[0];
    for (const stage of ['extract', 'draft', 'verify', 'adjudicate', 'apply', 'overlay'] as const)
      expect(alpha.stages[stage].status).toBe('stale');
    expect(view.cards[1].stages.overlay.status).toBe('done');
    // It cannot run here: run skips it and next names the missing inputs.
    const calls = h.calls.length;
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(0);
    expect(h.calls.length).toBe(calls);
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'queue',
      stage: 'extract',
      cardIds: [ALPHA],
    });
  });

  it('a CLI gate that failed twice goes to the session as gate-failed', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    h.extract.status = 'timeout';
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(0);
    expect(statuses(await h.view(), 'extract')).toEqual(['failed-gate', 'failed-gate']);
    expect(await h.json<NextStep>('next')).toMatchObject({ kind: 'cli', stage: 'extract' });
    expect(await h.run('run', 'extract', '--batch', BATCH)).toBe(0);
    expect((await h.state()).cards[ALPHA].stages.extract?.attempts).toBe(2);
    expect(await h.json<NextStep>('next')).toMatchObject({
      kind: 'queue',
      stage: 'extract',
      code: 'gate-failed',
      cardIds: [ALPHA, BETA],
    });
    const status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].queue.filter((item) => item.code === 'gate-failed')).toHaveLength(2);
  });

  it('--wait-minutes does not sleep when nothing is paused', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'capture');
    h.extract.limitAfterTraces = true;
    expect(await h.run('run', 'extract', '--batch', BATCH, '--wait-minutes', '20')).toBe(0);
    expect(h.clock.now.toISOString()).toBe('2026-10-04T10:00:00.000Z');
    expect(statuses(await h.view(), 'extract')).toEqual(['done', 'done']);
  });

  it('rebase-anchors with nothing to rebase leaves state.json untouched', async () => {
    const h = await harness();
    await initWithResearch(h);
    await advance(h, 'overlay');
    const before = await readFile(join(h.dir, 'pipeline/state.json'), 'utf8');
    h.clock.now = new Date('2026-10-04T11:00:00Z');
    expect(await h.run('rebase-anchors', '--batch', BATCH)).toBe(0);
    expect(await readFile(join(h.dir, 'pipeline/state.json'), 'utf8')).toBe(before);
  });
});
