// Undrafted cards (Phase 9 milestone 3b): a successful draft run that writes no case for a card leaves it draft `done`
// and `undrafted`; verify packets carry it, the verifier writes every label from the captures, and a batch whose first
// verify packet was already accepted gets a second verify and adjudicate packet for it. Synthetic fixture only.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelsHash } from '../src/hash.ts';
import { packetSchema } from '../src/packets.ts';
import type { Packet } from '../src/packets.ts';
import { undraftedCase } from '../../../scripts/lib/expansion-verification.mjs';
import { ALPHA, BATCH, BETA, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const ISSUER = 'example-bank';
const write = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const accept = (h: Harness, stage: string, run: string, ...more: string[]) =>
  h.run('accept', stage, '--batch', BATCH, '--issuer', ISSUER, '--agent-run', run, ...more);
const captures = (ids: string[]) => ids.map((id) => `evals/curation/batches/${BATCH}/captures/${id}.txt`);

/** The draft stub leaves Beta out of corpus.draft.json, as the real script does when nothing resolves to an anchor. */
function undraftBeta(h: Harness, exit = 0) {
  const exec = h.env.exec;
  h.env.exec = async (command, args) => {
    if (args[0] !== 'scripts/draft-expansion-labels.mjs') return exec(command, args);
    await exec(command, args);
    const path = join(h.dir, 'corpus.draft.json');
    const draft = JSON.parse(await readFile(path, 'utf8'));
    draft.cases = draft.cases.filter((item: { cardId: string }) => item.cardId !== BETA);
    await write(path, draft);
    return exit;
  };
}

async function toDraft(h: Harness) {
  await initWithResearch(h);
  undraftBeta(h);
  for (const stage of ['capture', 'extract', 'draft'])
    if ((await h.run('run', stage, '--batch', BATCH)) !== 0) throw new Error(h.logs.join('\n'));
}

async function claimed(h: Harness, stage: string): Promise<Packet> {
  if ((await h.run('claim', stage, '--batch', BATCH, '--issuer', ISSUER)) !== 0)
    throw new Error(h.logs.join('\n'));
  const dir = join(h.dir, 'pipeline/packets');
  for (const file of await readdir(dir)) {
    const packet = packetSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')));
    if (packet.status === 'open' && packet.stage === stage) return packet;
  }
  throw new Error('no open packet');
}

const alphaEntry = () => ({ cardId: ALPHA, verdict: 'confirmed', reason: null, fixes: [] });
/** Beta written from the captures: currency by a fix on the empty reference, the rules as additions. */
const betaEntry = (): Data => {
  const anchor = { sourceId: 'example-bank-beta-product', quote: 'fake beta words 3X points' };
  const rule = (category: string, issuerWording: string, rateBps: number) => ({
    category,
    issuerWording,
    rateBps,
    paidOnPaymentBps: 0,
    cap: null,
    activation: null,
    usMerchantsOnly: null,
    limitedTime: null,
  });
  return {
    cardId: BETA,
    verdict: 'fixed',
    reason: null,
    fixes: [
      {
        path: 'reference.rewardCurrency.value',
        current: null,
        corrected: 'points',
        anchor,
        note: 'from capture',
      },
    ],
    addedRules: [
      { rule: rule('dining', 'fake beta words 3X points', 300), anchors: [anchor], note: 'from capture' },
      {
        rule: rule('all-purchases', 'fake beta words 1X points', 100),
        anchors: [{ sourceId: 'example-bank-beta-terms', quote: 'fake beta words 1X points' }],
        note: 'from capture',
      },
    ],
  };
};

async function findings(packet: Packet, cards: Data[], base: Data | null = null) {
  const data: Data = base ?? { schemaVersion: 1, issuer: 'Example Bank', adjudicator: null, cards: [] };
  Object.assign(data, { packetId: packet.packetId, batch: BATCH, provenance: 'agent-verified' });
  data.verifier = {
    agent: 'card-verifier',
    model: 'claude-test',
    date: '2026-10-04',
    filesRead: captures([
      'example-bank-alpha-product',
      'example-bank-beta-product',
      'example-bank-beta-terms',
    ]),
  };
  data.adjudicator = null;
  data.cards = [...data.cards, ...cards];
  await mkdir(join(packet.output, '..'), { recursive: true });
  await write(packet.output, data);
}

/** The adjudicator accepts every finding of the packet's cards. */
async function adjudication(packet: Packet) {
  const data = JSON.parse(await readFile(packet.output, 'utf8'));
  data.packetId = packet.packetId;
  data.adjudicator = {
    agent: 'card-adjudicator',
    model: 'claude-test',
    date: '2026-10-04',
    filesRead: ['x'],
  };
  for (const card of data.cards)
    if (packet.cardIds.includes(card.cardId))
      for (const key of ['fixes', 'addedRules'])
        for (const item of card[key] ?? []) item.adjudication ??= { decision: 'accepted', reason: 'checked' };
  await write(packet.output, data);
}

describe('undrafted cards', () => {
  it('a successful draft run without a case is done and undrafted, with stable hashes; a script failure is not', async () => {
    const h = await harness();
    await toDraft(h);
    const state = await h.state();
    const beta = state.cards[BETA].stages.draft!;
    expect(beta).toMatchObject({ status: 'done', undrafted: true });
    expect(beta.outputs).toBeUndefined();
    const cards = JSON.parse(await readFile(join(h.dir, 'cards.json'), 'utf8')).cards;
    expect(beta.labelsHash).toBe(labelsHash(undraftedCase(cards[1])));
    expect(state.cards[ALPHA].stages.draft!.undrafted).toBeUndefined();
    expect(h.logs.join('\n')).toMatch(/1 card\(s\) undrafted \(no draft case\): example-bank-beta/);
    const view = await h.view();
    expect(view.cards.map((card) => card.stages.draft.status)).toEqual(['done', 'done']);
    expect(view.cards.map((card) => card.stages.verify.status)).toEqual(['pending', 'pending']);
    expect(await h.json('next')).toMatchObject({ kind: 'agent', stage: 'verify', cardIds: [ALPHA, BETA] });

    const failing = await harness();
    await initWithResearch(failing);
    undraftBeta(failing, 1);
    for (const stage of ['capture', 'extract']) await failing.run('run', stage, '--batch', BATCH);
    expect(await failing.run('run', 'draft', '--batch', BATCH)).toBe(1);
    expect((await failing.state()).cards[BETA].stages.draft).toMatchObject({
      status: 'failed-gate',
      reason: 'draft-error',
    });
  });

  it('a verify packet marks the undrafted card; findings that write every label pass verify and adjudicate', async () => {
    const h = await harness();
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    expect(packet.cardIds).toEqual([ALPHA, BETA]);
    expect(packet.undraftedCardIds).toEqual([BETA]);
    expect(h.logs.join('\n')).toMatch(/Undrafted \(no draft case/);

    // Nothing to confirm on an empty reference.
    await findings(packet, [alphaEntry(), { cardId: BETA, verdict: 'confirmed' }]);
    expect(await accept(h, 'verify', 'run-verifier', '--dry-run')).toBe(1);
    expect(h.logs.join('\n')).toContain(`- cards.${BETA}.verdict: an undrafted card is fixed`);

    await findings(packet, [alphaEntry(), betaEntry()]);
    expect(await accept(h, 'verify', 'run-verifier'), h.logs.join('\n')).toBe(0);
    const verify = (await h.state()).cards[BETA].stages.verify!;
    expect(verify.labelsHash).toBe((await h.state()).cards[BETA].stages.draft!.labelsHash);

    const adjudicate = await claimed(h, 'adjudicate');
    expect(adjudicate.undraftedCardIds).toEqual([BETA]);
    await adjudication(adjudicate);
    // The gate applies the findings to the empty reference and runs the label lint on the case apply will write.
    expect(await accept(h, 'adjudicate', 'run-adjudicator'), h.logs.join('\n')).toBe(0);
    expect(await h.json('next')).toMatchObject({ kind: 'cli', stage: 'apply' });
    expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);
    expect((await h.view()).cards.map((card) => card.stages.apply.status)).toEqual(['done', 'done']);
  });

  it('a batch whose first verify packet was accepted gets a second verify and adjudicate packet', async () => {
    const h = await harness();
    await toDraft(h);
    // Beta as the Phase 9 run left it: failed-gate no-draft-case, twice (a record from before this fix).
    const view = await h.view();
    const state = await h.state();
    state.cards[BETA].stages.draft = {
      status: 'failed-gate',
      stageVersion: 'draft.1',
      inputHash: view.cards[1].stages.draft.inputHash,
      attempts: 2,
      reason: 'no-draft-case',
    };
    await write(join(h.dir, 'pipeline/state.json'), state);

    const first = await claimed(h, 'verify');
    expect(first.cardIds).toEqual([ALPHA]);
    await findings(first, [alphaEntry()]);
    expect(await accept(h, 'verify', 'run-v1'), h.logs.join('\n')).toBe(0);
    const firstAdjudicate = await claimed(h, 'adjudicate');
    await adjudication(firstAdjudicate);
    expect(await accept(h, 'adjudicate', 'run-a1'), h.logs.join('\n')).toBe(0);

    // `next` runs draft again for the legacy record instead of handing it to the session.
    expect(await h.json('next')).toMatchObject({ kind: 'cli', stage: 'draft', cardIds: [BETA] });
    expect(await h.run('run', 'draft', '--batch', BATCH, '--only', BETA)).toBe(0);
    expect((await h.state()).cards[BETA].stages.draft).toMatchObject({ status: 'done', undrafted: true });
    expect(await h.json('next')).toMatchObject({ kind: 'agent', stage: 'verify', cardIds: [BETA] });

    const second = await claimed(h, 'verify');
    expect(second).toMatchObject({ n: 2, cardIds: [BETA], undraftedCardIds: [BETA] });
    const accepted = JSON.parse(await readFile(second.output, 'utf8'));
    const alphaAccepted = accepted.cards[0];
    expect(second.frozen?.entries[ALPHA]).toBeDefined();

    // The accepted entry stays as it is, and appears once.
    await findings(second, [structuredClone(alphaAccepted), betaEntry()], structuredClone(accepted));
    expect(await accept(h, 'verify', 'run-v2', '--dry-run')).toBe(1);
    expect(h.logs.join('\n')).toContain(`- cards.${ALPHA}: more than one entry for the card`);
    const changed = { ...structuredClone(accepted), cards: [{ ...alphaAccepted, reason: 'rewritten' }] };
    await findings(second, [betaEntry()], changed);
    expect(await accept(h, 'verify', 'run-v2', '--dry-run')).toBe(1);
    expect(h.logs.join('\n')).toContain(`- cards.${ALPHA}: outside the packet (added or changed)`);

    await findings(second, [betaEntry()], structuredClone(accepted));
    expect(await accept(h, 'verify', 'run-v2'), h.logs.join('\n')).toBe(0);
    const merged = JSON.parse(await readFile(second.output, 'utf8'));
    expect(merged.cards.map((card: { cardId: string }) => card.cardId)).toEqual([ALPHA, BETA]);
    expect(merged.cards[0]).toEqual(alphaAccepted);
    let now = await h.view();
    expect(now.cards.map((card) => card.stages.adjudicate.status)).toEqual(['done', 'pending']);

    const secondAdjudicate = await claimed(h, 'adjudicate');
    expect(secondAdjudicate).toMatchObject({ n: 2, cardIds: [BETA], undraftedCardIds: [BETA] });
    await adjudication(secondAdjudicate);
    expect(await accept(h, 'adjudicate', 'run-v2')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/the adjudicator is always another run/);
    expect(await accept(h, 'adjudicate', 'run-a2'), h.logs.join('\n')).toBe(0);
    now = await h.view();
    expect(now.cards.map((card) => card.stages.verify.status)).toEqual(['done', 'done']);
    expect(now.cards.map((card) => card.stages.adjudicate.status)).toEqual(['done', 'done']);
    expect((await h.state()).cards[ALPHA].stages.verify!.agentRun).toBe('run-v1');
    expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);
  });
});
