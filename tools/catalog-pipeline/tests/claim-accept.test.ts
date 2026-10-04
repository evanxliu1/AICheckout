// claim / accept, the gates of the agent stages, the capture gate and the build registration, on the synthetic fixture
// batch (fake captures written by the harness; no issuer text).
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StatusJson } from '../src/cli.ts';
import { definitionConflicts } from '../src/gates.ts';
import { packetSchema } from '../src/packets.ts';
import type { Packet } from '../src/packets.ts';
import { sha256Json } from '../../../scripts/lib/catalog-batches.mjs';
import { ALPHA, BATCH, BETA, FIXTURE, REPO, harness, initWithResearch } from './helpers.ts';
import type { Harness } from './helpers.ts';

/** Fixture JSON edited in place by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;

const ISSUER = 'example-bank';
/** Sentences of the fixture captures: no gate output may contain them. */
const CAPTURE_SENTENCES = ['fake alpha words 2% back', 'fake beta words 3X points', 'Synthetic page'];

const fixture = async (name: string) => JSON.parse(await readFile(join(FIXTURE, name), 'utf8'));

async function packets(h: Harness): Promise<Packet[]> {
  const dir = join(h.dir, 'pipeline/packets');
  const files = (await readdir(dir).catch(() => [] as string[])).sort();
  return Promise.all(
    files.map(async (file) => packetSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')))),
  );
}
const openOne = async (h: Harness, stage: string) =>
  (await packets(h)).find((packet) => packet.status === 'open' && packet.stage === stage)!;

async function claimed(h: Harness, stage: string): Promise<Packet> {
  const code = await h.run('claim', stage, '--batch', BATCH, '--issuer', ISSUER);
  if (code !== 0) throw new Error(h.logs.join('\n'));
  return openOne(h, stage);
}
/** Every file under a directory with its content, for byte-for-byte comparisons. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out[path] = await readFile(path, 'utf8');
    }
  return out;
}
const write = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const accept = (h: Harness, stage: string, run: string, ...more: string[]) =>
  h.run('accept', stage, '--batch', BATCH, '--issuer', ISSUER, '--agent-run', run, ...more);

async function initOnly(h: Harness) {
  const code = await h.run(
    'init',
    BATCH,
    '--issuer',
    'Example Bank',
    '--cards',
    'Example Alpha Card, Example Beta Card',
    '--domains',
    'example.com',
  );
  if (code !== 0) throw new Error(h.logs.join('\n'));
}

async function researchOutput(packet: Packet, edit: (data: Data) => void = () => {}) {
  const data = await fixture('research-output.json');
  data.packetId = packet.packetId;
  edit(data);
  await mkdir(join(packet.output, '..'), { recursive: true });
  await write(packet.output, data);
}

/** Through draft with the stand-in research, so verify can be claimed. */
async function toDraft(h: Harness) {
  await initWithResearch(h);
  for (const stage of ['capture', 'extract', 'draft'])
    if ((await h.run('run', stage, '--batch', BATCH)) !== 0) throw new Error(h.logs.join('\n'));
}

async function findings(packet: Packet, edit: (data: Data) => void = () => {}) {
  const data = await fixture('verification/example-bank.json');
  Object.assign(data, { packetId: packet.packetId, batch: BATCH, provenance: 'agent-verified' });
  data.verifier.filesRead = [
    `evals/curation/batches/${BATCH}/verify/example-bank.md`,
    ...['example-bank-alpha-product', 'example-bank-beta-product', 'example-bank-beta-terms'].map(
      (id) => `evals/curation/batches/${BATCH}/captures/${id}.txt`,
    ),
  ];
  data.adjudicator = null;
  for (const card of data.cards) for (const fix of card.fixes) delete fix.adjudication;
  edit(data);
  await mkdir(join(packet.output, '..'), { recursive: true });
  await write(packet.output, data);
}

async function verified(h: Harness): Promise<Packet> {
  await toDraft(h);
  const packet = await claimed(h, 'verify');
  await findings(packet);
  if ((await accept(h, 'verify', 'run-verifier', '--model', 'claude-test')) !== 0)
    throw new Error(h.logs.join('\n'));
  return packet;
}

async function adjudication(packet: Packet) {
  const data = JSON.parse(await readFile(packet.output, 'utf8'));
  data.packetId = packet.packetId;
  data.adjudicator = { agent: 'fixture', model: 'claude-test', date: '2026-10-04', filesRead: ['fixture'] };
  for (const card of data.cards)
    for (const fix of card.fixes) fix.adjudication = { decision: 'accepted', reason: 'fixture' };
  await write(packet.output, data);
}

describe('claim', () => {
  it('refuses a second open claim, releases (keeping the packet) and claims again', async () => {
    const h = await harness();
    await initOnly(h);
    const first = await claimed(h, 'research');
    expect(first).toMatchObject({ stage: 'research', issuer: ISSUER, n: 1, cardIds: [], status: 'open' });
    expect(first.output).toBe(join(h.dir, 'research/example-bank.json'));
    expect(h.logs.join('\n')).toMatch(/Start the card-researcher subagent/);
    expect(await h.run('claim', 'research', '--batch', BATCH, '--issuer', ISSUER)).toBe(1);
    expect(h.logs.at(-1)).toMatch(/already claimed/);

    expect(await h.run('claim', 'research', '--batch', BATCH, '--issuer', ISSUER, '--release')).toBe(0);
    const second = await claimed(h, 'research');
    expect(second.n).toBe(2);
    expect(second.packetId).not.toBe(first.packetId);
    expect((await packets(h)).map((packet) => [packet.n, packet.status])).toEqual([
      [1, 'released'],
      [2, 'open'],
    ]);
  });

  it('a verify packet lists only the cards pending or stale, with the captures as inputs', async () => {
    const h = await harness();
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    expect(packet.cardIds).toEqual([ALPHA, BETA]);
    expect(packet.output).toBe(join(h.dir, 'verification/example-bank.json'));
    expect(packet.inputs).toContain(join(h.dir, 'captures/example-bank-beta-terms.txt'));
    expect(await h.run('claim', 'adjudicate', '--batch', BATCH, '--issuer', ISSUER)).toBe(1);
    expect(h.logs.at(-1)).toMatch(/nothing to claim/);
  });
});

describe('accept research', () => {
  it('accepts valid research, consolidates cards.json and records the run', async () => {
    const h = await harness();
    await initOnly(h);
    const packet = await claimed(h, 'research');
    let status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].packets).toMatchObject([{ stage: 'research', output: 'absent' }]);
    await researchOutput(packet);
    status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].packets).toMatchObject([{ stage: 'research', output: 'present' }]);

    expect(
      await accept(
        h,
        'research',
        'run-1',
        '--model',
        'claude-test',
        '--duration-ms',
        '61000',
        '--tokens',
        '5200',
      ),
    ).toBe(0);
    const cards = JSON.parse(await readFile(join(h.dir, 'cards.json'), 'utf8')).cards;
    expect(cards.map((card: { id: string }) => card.id)).toEqual([ALPHA, BETA]);
    expect(cards[1].sourceIds).toEqual(['example-bank-beta-product', 'example-bank-beta-rewards-terms']);
    const exclusions = JSON.parse(await readFile(join(h.dir, 'exclusions.json'), 'utf8')).exclusions;
    expect(exclusions).toHaveLength(1);
    const record = (await h.state()).issuers[ISSUER].stages.research!;
    expect(record).toMatchObject({
      status: 'done',
      packetId: packet.packetId,
      agentRun: 'run-1',
      model: 'claude-test',
      durationMs: 61000,
      tokens: 5200,
      acceptedAt: '2026-10-04T10:00:00.000Z',
    });
    expect((await h.view()).research[ISSUER].status).toBe('done');
    expect((await packets(h))[0].status).toBe('accepted');
    status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].packets).toEqual([]);
  });

  it('rejects a wrong packetId, batch or issuer', async () => {
    for (const [field, value] of [
      ['packetId', '00000000-0000-4000-8000-000000000000'],
      ['batch', 'other-bank-2026-10'],
      ['issuer', 'Other Bank'],
    ]) {
      const h = await harness();
      await initOnly(h);
      const packet = await claimed(h, 'research');
      await researchOutput(packet, (data) => (data[field] = value));
      expect(await accept(h, 'research', 'run-1')).toBe(1);
      expect(h.logs.join('\n')).toContain(`- ${field}: does not match the open packet`);
      expect((await h.state()).issuers[ISSUER].stages.research?.status).toBe('failed-gate');
      expect((await h.view()).queue).toMatchObject([{ code: 'gate-failed', stage: 'research' }]);
    }
  });

  it('the research schema: issuer domain, no numeric rate fields, notes of at most 300 characters', async () => {
    const h = await harness();
    await initOnly(h);
    const packet = await claimed(h, 'research');
    await researchOutput(packet, (data) => {
      data.cards[0].officialUrls[0].url = 'https://www.example.org/alpha';
      data.cards[1].rateBps = 300;
      data.cards[1].notes = 'x'.repeat(301);
    });
    expect(await accept(h, 'research', 'run-1', '--dry-run')).toBe(1);
    const out = h.logs.join('\n');
    expect(out).toContain('- cards.1.rateBps: no reward values in research');
    expect(out).toContain('- cards.1.notes:');
    expect(out).toMatch(/dry run, nothing recorded/);
    expect((await h.state()).issuers[ISSUER].stages.research?.status).toBe('pending');

    await researchOutput(
      packet,
      (data) => (data.cards[0].officialUrls[0].url = 'https://www.example.org/alpha'),
    );
    expect(await accept(h, 'research', 'run-1')).toBe(1);
    expect(h.logs.join('\n')).toContain('- cards.0.officialUrls.0.url: not on the issuer domain allow-list');
    expect((await packets(h))[0]).toMatchObject({ status: 'open', attempts: [{ result: 'failed-gate' }] });
    const status = await h.json<{ batches: StatusJson[] }>('status');
    expect(status.batches[0].packets).toMatchObject([{ output: 'present-not-accepted' }]);
  });

  it('a passing --dry-run writes nothing: state, packets and outputs unchanged', async () => {
    const h = await harness();
    await initOnly(h);
    const packet = await claimed(h, 'research');
    await researchOutput(packet);
    const before = await snapshot(h.dir);
    expect(await accept(h, 'research', 'run-1', '--dry-run'), h.logs.join('\n')).toBe(0);
    expect(h.logs.at(-1)).toMatch(/gates pass \(dry run, nothing recorded\)/);
    expect(await snapshot(h.dir)).toEqual(before);
    expect(h.calls.some((call) => call[1] === 'scripts/build-expansion-cards.mjs')).toBe(false);
  });

  it('refuses a card of a released corpus unless the batch is a refresh', async () => {
    const h = await harness();
    await initOnly(h);
    await mkdir(join(h.root, 'evals/curation/released'), { recursive: true });
    await write(join(h.root, 'evals/curation/released/corpus.json'), {
      version: 'released.v1',
      cases: [{ cardId: BETA }],
    });
    const configPath = join(h.root, 'evals/curation/catalog-batches.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.layers.unshift({
      kind: 'base',
      id: 'released.v1',
      dir: 'evals/curation/released',
      corpus: 'corpus.json',
      manifest: 'manifest.json',
      overlay: null,
      notes: null,
      cards: null,
      dropped: {},
    });
    await write(configPath, config);
    const packet = await claimed(h, 'research');
    await researchOutput(packet);
    expect(await accept(h, 'research', 'run-1')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      '- cards.1.id: already in the released corpus released.v1, and the batch is not a refresh',
    );
  });
});

describe('accept verify and adjudicate', () => {
  it('accepts findings and records the packet, run, model and the draft labels and anchors hashes', async () => {
    const h = await harness();
    const packet = await verified(h);
    const state = await h.state();
    expect(state.issuers[ISSUER].stages.verify).toMatchObject({
      status: 'done',
      packetId: packet.packetId,
      agentRun: 'run-verifier',
      model: 'claude-test',
    });
    const beta = state.cards[BETA].stages.verify!;
    expect(beta).toMatchObject({ status: 'done', packetId: packet.packetId, agentRun: 'run-verifier' });
    expect(beta.labelsHash).toBe(state.cards[BETA].stages.draft!.labelsHash);
    expect(beta.anchorsHash).toBe(state.cards[BETA].stages.draft!.anchorsHash);
    const view = await h.view();
    expect(view.cards.map((card) => card.stages.verify.status)).toEqual(['done', 'done']);
    expect(view.cards.map((card) => card.stages.adjudicate.status)).toEqual(['pending', 'pending']);
  });

  it('rejects a card outside the packet and a stale current value', async () => {
    const h = await harness();
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    await findings(packet, (data) => {
      data.cards.push({ ...data.cards[0], cardId: 'example-bank-gamma' });
      data.cards[1].fixes[0].current = 'fake beta words';
    });
    expect(await accept(h, 'verify', 'run-verifier')).toBe(1);
    const out = h.logs.join('\n');
    expect(out).toContain('- cards.example-bank-gamma: outside the packet (added or changed)');
    expect(out).toContain(`- cards.${BETA}.fixes.0.current: does not match the draft`);
  });

  it('refuses a changed packet input and a filesRead without a card capture', async () => {
    const h = await harness();
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    await findings(packet, (data) => {
      data.verifier.filesRead = data.verifier.filesRead.filter(
        (path: string) => !path.endsWith('example-bank-beta-terms.txt'),
      );
    });
    expect(await accept(h, 'verify', 'run-verifier', '--dry-run')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- verifier.filesRead: does not name captures/example-bank-beta-terms.txt (${BETA})`,
    );
    await findings(packet);
    const draftPath = join(h.dir, 'corpus.draft.json');
    await writeFile(draftPath, (await readFile(draftPath, 'utf8')) + '\n');
    h.logs.length = 0;
    expect(await accept(h, 'verify', 'run-verifier')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- ${draftPath}: changed since the claim (an agent writes only its output file)`,
    );
  });

  it('a failed gate sets failed-gate and prints no capture text', async () => {
    const h = await harness();
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    await findings(packet, (data) => {
      data.cards[1].fixes[0].anchor.quote = 'fake beta words 3X pointz';
      data.cards[1].fixes[0].corrected = 'fake beta words 3X pointz';
    });
    h.logs.length = 0;
    expect(await accept(h, 'verify', 'run-verifier')).toBe(1);
    const out = h.logs.join('\n');
    expect(out).toMatch(/gate failed/);
    expect(out).toContain(
      `example-bank.json: ${BETA}: fixes.0.anchor: quote not found in example-bank-beta-product: "…"`,
    );
    for (const sentence of [...CAPTURE_SENTENCES, 'pointz']) expect(out).not.toContain(sentence);
    const view = await h.view();
    expect(view.cards.map((card) => card.stages.verify.status)).toEqual(['failed-gate', 'failed-gate']);
    expect(await h.json('next')).toMatchObject({ kind: 'queue', stage: 'verify', code: 'gate-failed' });
  });

  it('refuses an adjudicator run equal to the verifier run, or a packet claimed before verify was accepted', async () => {
    const h = await harness();
    await verified(h);
    const packet = await claimed(h, 'adjudicate');
    expect(packet.cardIds).toEqual([ALPHA, BETA]);
    await adjudication(packet);
    expect(await accept(h, 'adjudicate', 'run-verifier')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/the adjudicator is always another run/);

    const state = await h.state();
    state.issuers[ISSUER].stages.verify!.acceptedAt = '2026-10-04T11:00:00.000Z';
    await write(join(h.dir, 'pipeline/state.json'), state);
    expect(await accept(h, 'adjudicate', 'run-adjudicator')).toBe(1);
    expect(h.logs.at(-1)).toMatch(/claimed before verify was accepted/);
    expect((await h.state()).cards[ALPHA].stages.adjudicate).toBeUndefined();
  });

  it('accepts a complete adjudication; a changed finding or an undecided one fails', async () => {
    const h = await harness();
    await verified(h);
    const packet = await claimed(h, 'adjudicate');
    await adjudication(packet);
    const data = JSON.parse(await readFile(packet.output, 'utf8'));
    data.cards[1].fixes[0].note = 'changed by the adjudicator';
    await write(packet.output, data);
    expect(await accept(h, 'adjudicate', 'run-adjudicator')).toBe(1);
    expect(h.logs.join('\n')).toContain(`- cards.${BETA}: the verifier's findings changed`);

    data.cards[1].fixes[0].note = 'fixture';
    await write(packet.output, data);
    await adjudication(packet);
    const undecided = JSON.parse(await readFile(packet.output, 'utf8'));
    delete undecided.cards[1].fixes[0].adjudication;
    await write(packet.output, undecided);
    expect(await accept(h, 'adjudicate', 'run-adjudicator')).toBe(1);
    expect(h.logs.join('\n')).toContain(`- cards.${BETA}.fixes.0.adjudication: undecided`);

    await adjudication(packet);
    expect(
      await accept(h, 'adjudicate', 'run-adjudicator', '--model', 'claude-test'),
      h.logs.join('\n'),
    ).toBe(0);
    const view = await h.view();
    expect(view.cards.map((card) => card.stages.adjudicate.status)).toEqual(['done', 'done']);
    expect((await h.state()).issuers[ISSUER].stages.adjudicate).toMatchObject({
      agentRun: 'run-adjudicator',
      packetId: packet.packetId,
    });
    expect(await h.json('next')).toMatchObject({ kind: 'cli', stage: 'apply' });
  });

  it('hashes the findings as parsed: omitted defaulted fields (reason, addedIssues) still accept', async () => {
    const h = await harness();
    await verified(h);
    // The verifier left out fields the schema defaults, on both cards.
    const file = join(h.dir, 'verification/example-bank.json');
    const data = JSON.parse(await readFile(file, 'utf8'));
    for (const card of data.cards) {
      delete card.reason;
      delete card.addedIssues;
    }
    delete data.cards[1].fixes[0].op;
    await write(file, data);
    // Alpha's adjudication is done, so the packet covers beta only and alpha's entry is frozen.
    const view = await h.view();
    const state = await h.state();
    state.cards[ALPHA].stages.adjudicate = {
      status: 'done',
      stageVersion: 'adjudicate.1',
      inputHash: view.cards[0].stages.adjudicate.inputHash,
    };
    await write(join(h.dir, 'pipeline/state.json'), state);
    const packet = await claimed(h, 'adjudicate');
    expect(packet.cardIds).toEqual([BETA]);
    await adjudication(packet);
    expect(await accept(h, 'adjudicate', 'run-adjudicator'), h.logs.join('\n')).toBe(0);
  });
});

describe('apply and overlay', () => {
  async function applied(h: Harness) {
    await verified(h);
    const packet = await claimed(h, 'adjudicate');
    await adjudication(packet);
    if ((await accept(h, 'adjudicate', 'run-adjudicator')) !== 0) throw new Error(h.logs.join('\n'));
    if ((await h.run('run', 'apply', '--batch', BATCH)) !== 0) throw new Error(h.logs.join('\n'));
  }
  async function fragment(h: Harness, packet: Packet, edit: (data: Data) => void = () => {}) {
    const data = await fixture('overlay-fragment.json');
    data.packetId = packet.packetId;
    const corpus = JSON.parse(await readFile(join(h.dir, 'corpus.json'), 'utf8'));
    for (const entry of data.cards)
      entry.corpusCaseSha256 = sha256Json(
        corpus.cases.find((item: { cardId: string }) => item.cardId === entry.cardId),
      );
    edit(data);
    await mkdir(join(packet.output, '..'), { recursive: true });
    await write(packet.output, data);
  }

  it('apply runs the label lint: a rate not stated in its anchors fails the gate', async () => {
    const h = await harness();
    await verified(h);
    const packet = await claimed(h, 'adjudicate');
    await adjudication(packet);
    await accept(h, 'adjudicate', 'run-adjudicator');
    const corpus = await fixture('corpus.json');
    corpus.cases[0].reference.rules[0].rateBps = 150;
    const original = h.env.exec;
    h.env.exec = async (command, args) => {
      const code = await original(command, args);
      if (args[0] === 'scripts/apply-expansion-verification.mjs')
        await write(join(h.dir, 'corpus.json'), corpus);
      return code;
    };
    expect(await h.run('run', 'apply', '--batch', BATCH)).toBe(1);
    expect(h.logs.join('\n')).toContain(`label lint: rate ${ALPHA} rules.0.rateBps`);
    expect((await h.state()).cards[ALPHA].stages.apply).toMatchObject({
      status: 'failed-gate',
      reason: 'label-lint',
    });
    expect((await h.state()).cards[BETA].stages.apply?.status).toBe('done');
  });

  it('accepts an overlay fragment: merges it, maps programs and records the cards', async () => {
    const h = await harness();
    await applied(h);
    const packet = await claimed(h, 'overlay');
    expect(packet.corpusCaseSha256?.[ALPHA]).toMatch(/^[0-9a-f]{64}$/);
    await fragment(h, packet);
    expect(await accept(h, 'overlay', 'run-overlay', '--model', 'claude-test'), h.logs.join('\n')).toBe(0);
    const overlay = JSON.parse(await readFile(join(h.dir, 'catalog-overlay.json'), 'utf8'));
    expect(overlay.cards.map((entry: { cardId: string }) => entry.cardId)).toEqual([ALPHA, BETA]);
    const programs = JSON.parse(await readFile(join(h.dir, 'reward-programs.json'), 'utf8'));
    expect(programs.cards).toHaveLength(2);
    const view = await h.view();
    expect(view.cards.map((card) => card.stages.overlay.status)).toEqual(['done', 'done']);
    expect(await h.json('next')).toMatchObject({ kind: 'cli', stage: 'build' });

    // Build registers the batch in the build config with its dropped cards from state.
    const state = await h.state();
    state.cards[BETA].dropped = 'drop-card';
    await write(join(h.dir, 'pipeline/state.json'), state);
    await h.run('run', 'build', '--batch', BATCH);
    const config = JSON.parse(await readFile(join(h.root, 'evals/curation/catalog-batches.json'), 'utf8'));
    expect(config.layers).toEqual([{ kind: 'batch', id: BATCH, dropped: { [BETA]: 'drop-card' } }]);
  });

  it('refuses a fragment ack that names no overlay finding', async () => {
    const h = await harness();
    await applied(h);
    const packet = await claimed(h, 'overlay');
    await fragment(h, packet, (data) => {
      data.labelLintAcks = [{ cardId: ALPHA, ruleIndex: 0, check: 'rate', reason: 'split-anchors' }];
    });
    expect(await accept(h, 'overlay', 'run-overlay')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- labelLintAcks.0: names no open label-lint finding (rate ${ALPHA} rules.0.rateBps); stale or duplicate`,
    );
  });

  it('refuses an overlay entry for a card outside the packet', async () => {
    const h = await harness();
    await applied(h);
    const packet = await claimed(h, 'overlay');
    await fragment(h, packet, (data) => data.cards.push({ ...data.cards[0], cardId: 'example-bank-gamma' }));
    expect(await accept(h, 'overlay', 'run-overlay')).toBe(1);
    expect(h.logs.join('\n')).toContain('- cards.example-bank-gamma: outside the packet');
    await expect(readFile(join(h.dir, 'catalog-overlay.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses an overlay entry whose pairing hash is not its corpus case', async () => {
    const h = await harness();
    await applied(h);
    const packet = await claimed(h, 'overlay');
    await fragment(h, packet, (data) => (data.cards[1].corpusCaseSha256 = 'a'.repeat(64)));
    expect(await accept(h, 'overlay', 'run-overlay')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- cards.${BETA}.corpusCaseSha256: not the SHA-256 of the card's corpus case`,
    );
    expect((await h.state()).cards[BETA].stages.overlay?.status).toBe('failed-gate');
    await expect(readFile(join(h.dir, 'catalog-overlay.json'), 'utf8')).rejects.toThrow();
  });

  it('an anchor-only change re-stamps the pairing hash after apply', async () => {
    const h = await harness();
    await applied(h);
    const packet = await claimed(h, 'overlay');
    await fragment(h, packet);
    await accept(h, 'overlay', 'run-overlay');
    // The apply stub writes a corpus whose beta anchor moved (labels unchanged).
    const corpus = await fixture('corpus.json');
    corpus.cases[1].reference.exclusions = [];
    corpus.cases[1].reference.rules[0].anchors = ['fake beta words 3X points', 'fake beta words three'];
    const original = h.env.exec;
    h.env.exec = async (command, args) => {
      const code = await original(command, args);
      if (args[0] === 'scripts/apply-expansion-verification.mjs')
        await write(join(h.dir, 'corpus.json'), corpus);
      return code;
    };
    // Make apply runnable again (its input, the adjudicated findings, changed by a note).
    const findingsFile = JSON.parse(await readFile(join(h.dir, 'verification/example-bank.json'), 'utf8'));
    findingsFile.cards[1].fixes[0].adjudication.reason = 'fixture, again';
    await write(join(h.dir, 'verification/example-bank.json'), findingsFile);
    expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);
    expect(h.logs.join('\n')).toMatch(
      /re-stamped corpusCaseSha256 in catalog-overlay.json for example-bank-beta/,
    );
    const overlay = JSON.parse(await readFile(join(h.dir, 'catalog-overlay.json'), 'utf8'));
    expect(overlay.cards[1].corpusCaseSha256).toBe(sha256Json(corpus.cases[1]));
    expect((await h.view()).cards[1].stages.overlay.status).toBe('done');
  });
});

describe('label-lint acknowledgements', () => {
  const ACK = { cardId: ALPHA, ruleIndex: 0, check: 'rate', reason: 'anchor-truncated' };
  /** The draft and corpus stubs write alpha's rule 0 at 1.5%, which its anchor ("2%") does not state. */
  function unreadableRate(h: Harness) {
    const original = h.env.exec;
    h.env.exec = async (command, args) => {
      const code = await original(command, args);
      for (const [script, name] of [
        ['scripts/draft-expansion-labels.mjs', 'corpus.draft.json'],
        ['scripts/apply-expansion-verification.mjs', 'corpus.json'],
      ])
        if (args[0] === script) {
          const data = JSON.parse(await readFile(join(h.dir, name), 'utf8'));
          data.cases[0].reference.rules[0].rateBps = 150;
          await write(join(h.dir, name), data);
        }
      return code;
    };
  }
  async function adjudicated(h: Harness, acks: unknown[]) {
    unreadableRate(h);
    await verified(h);
    const packet = await claimed(h, 'adjudicate');
    await adjudication(packet);
    const data = JSON.parse(await readFile(packet.output, 'utf8'));
    data.labelLintAcks = acks;
    await write(packet.output, data);
    return accept(h, 'adjudicate', 'run-adjudicator');
  }

  it('an adjudicator ack of a raised finding is accepted, passes apply and is counted', async () => {
    const h = await harness();
    expect(await adjudicated(h, [ACK]), h.logs.join('\n')).toBe(0);
    expect(await h.run('run', 'apply', '--batch', BATCH), h.logs.join('\n')).toBe(0);
    const state = await h.state();
    expect(state.cards[ALPHA].stages.apply).toMatchObject({
      status: 'done',
      metrics: { lintRateRaised: 1, lintRateAcked: 1 },
    });
    expect(state.cards[BETA].stages.apply?.metrics).toBeUndefined();
    h.logs.length = 0;
    expect(await h.run('lint-labels', '--batch', BATCH)).toBe(0);
    expect(h.logs.join('\n')).toContain('1 raised, 1 acked, 0 open');
  });

  it('refuses an ack naming no finding, a reason outside the enum, and acks the verifier writes', async () => {
    const h = await harness();
    unreadableRate(h);
    await toDraft(h);
    const packet = await claimed(h, 'verify');
    await findings(packet, (data) => (data.labelLintAcks = [ACK]));
    expect(await accept(h, 'verify', 'run-verifier', '--dry-run')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- labelLintAcks.${ALPHA}: only the adjudicator acknowledges label-lint findings`,
    );
    await findings(packet);
    expect(await accept(h, 'verify', 'run-verifier'), h.logs.join('\n')).toBe(0);

    const adjudicate = await claimed(h, 'adjudicate');
    await adjudication(adjudicate);
    const data = JSON.parse(await readFile(adjudicate.output, 'utf8'));
    data.labelLintAcks = [
      { ...ACK, ruleIndex: 1 },
      { ...ACK, reason: 'looks-fine' },
    ];
    await write(adjudicate.output, data);
    h.logs.length = 0;
    expect(await accept(h, 'adjudicate', 'run-adjudicator')).toBe(1);
    const out = h.logs.join('\n');
    expect(out).toContain('- labelLintAcks.1.reason:');
    data.labelLintAcks = [{ ...ACK, ruleIndex: 1 }];
    await write(adjudicate.output, data);
    h.logs.length = 0;
    expect(await accept(h, 'adjudicate', 'run-adjudicator')).toBe(1);
    expect(h.logs.join('\n')).toContain(
      `- labelLintAcks.0: names no open label-lint finding (rate ${ALPHA} rules.1.rateBps); stale or duplicate`,
    );
  });

  it('an unacked finding fails apply, and so does an ack added after adjudicate was accepted', async () => {
    const h = await harness();
    expect(await adjudicated(h, []), h.logs.join('\n')).toBe(0);
    expect(await h.run('run', 'apply', '--batch', BATCH)).toBe(1);
    expect(h.logs.join('\n')).toContain(`label lint: rate ${ALPHA} rules.0.rateBps`);
    expect((await h.state()).cards[ALPHA].stages.apply).toMatchObject({
      status: 'failed-gate',
      metrics: { lintRateRaised: 1 },
    });
    // The session adds the ack itself: apply refuses it.
    const file = join(h.dir, 'verification/example-bank.json');
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.labelLintAcks = [ACK];
    await write(file, data);
    h.logs.length = 0;
    expect(await h.run('run', 'apply', '--batch', BATCH)).toBe(1);
    expect(h.logs.join('\n')).toContain('labelLintAcks: not the acknowledgements accepted with adjudicate');
    expect((await h.state()).cards[ALPHA].stages.apply?.status).toBe('failed-gate');
  });
});

describe('research consolidation of a batch', () => {
  it('does not apply the Phase 7 skip, merge and pick lists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'consolidation-'));
    await mkdir(join(dir, 'research'));
    const page = (url: string) => ({ officialUrls: [{ url, kind: 'product-page' }] });
    await write(join(dir, 'research/capital-one.json'), {
      schemaVersion: 1,
      issuer: 'Capital One',
      cards: [
        { id: 'citi-double-cash', name: 'Fake A', ...page('https://www.example.com/a') },
        { id: 'capital-one-quicksilver-good-credit', name: 'Fake B', ...page('https://www.example.com/b') },
        { id: 'chase-freedom-flex', name: 'Fake C', ...page('https://www.example.com/c') },
        { id: 'capital-one-fake', name: 'Fake D', ...page('https://www.capitalone.com/apply/fake') },
      ],
    });
    const code = await new Promise((done) =>
      execFile('node', [join(REPO, 'scripts/build-expansion-cards.mjs'), '--dir', dir], (error) =>
        done(error ? 1 : 0),
      ),
    );
    expect(code).toBe(0);
    const cards = JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8')).cards;
    expect(cards.map((card: { id: string }) => card.id)).toEqual([
      'citi-double-cash',
      'capital-one-quicksilver-good-credit',
      'chase-freedom-flex',
      'capital-one-fake',
    ]);
    expect(cards.every((card: { sourceIds: string[] }) => card.sourceIds.length === 1)).toBe(true);
    const exclusions = JSON.parse(await readFile(join(dir, 'exclusions.json'), 'utf8')).exclusions;
    expect(exclusions).toEqual([]);
  });
});

describe('overlay definitions', () => {
  const gate = (id: string, requires: string) => ({ id, requires });
  const defs = (gates: unknown[]) => ({ gates, programs: [], programDetails: [] }) as never;
  it("refuses another issuer's gate ID with other content; same content or an own ID passes", () => {
    const overlay = {
      cards: [],
      gates: [gate('g-shared', 'one'), gate('g-own', 'one')],
      programs: [],
      programDetails: [],
    } as never;
    const other = defs([gate('g-shared', 'one')]);
    expect(definitionConflicts(overlay, defs([gate('g-shared', 'two')]), [other])).toEqual([
      "gates.0: g-shared is defined by another issuer's fragment with other content",
    ]);
    expect(definitionConflicts(overlay, defs([gate('g-shared', 'one')]), [other])).toEqual([]);
    expect(definitionConflicts(overlay, defs([gate('g-own', 'two')]), [other])).toEqual([]);
    expect(definitionConflicts(null, defs([gate('g-shared', 'two')]), [other])).toEqual([]);
  });
});

describe('capture gate', () => {
  it('never overwrites a capture that passed; resolve records an accepted flag', async () => {
    const h = await harness();
    await initWithResearch(h);
    expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(0);
    const path = join(h.dir, 'captures/example-bank-alpha-product.txt');
    const before = await readFile(path, 'utf8');
    // A new hint makes alpha's capture stale; the page has changed since.
    await write(join(h.dir, 'capture-hints.json'), { 'example-bank-alpha-product': { waitFor: 'Alpha' } });
    h.capture.text = (id) => `Changed page ${id}.\n`;
    expect(await h.run('run', 'capture', '--batch', BATCH)).toBe(1);
    const call = h.calls.findLast((c) => c[1] === 'scripts/capture-issuer-pages.mjs')!;
    expect(call.slice(call.indexOf('--only'), call.indexOf('--only') + 2)).toEqual([
      '--only',
      'example-bank-alpha-product',
    ]);
    expect(call.slice(call.indexOf('--protect'), call.indexOf('--protect') + 2)).toEqual([
      '--protect',
      'example-bank-alpha-product',
    ]);
    expect(await readFile(path, 'utf8')).toBe(before);
    let view = await h.view();
    expect(view.cards[0].stages.capture.status).toBe('failed-gate');
    expect(view.queue).toMatchObject([{ code: 'capture-flagged', cardId: ALPHA }]);

    expect(
      await h.run(
        'resolve',
        'capture-flagged',
        '--batch',
        BATCH,
        '--source',
        'example-bank-alpha-product',
        '--reason',
        'because',
      ),
    ).toBe(2);
    expect(
      await h.run(
        'resolve',
        'capture-flagged',
        '--batch',
        BATCH,
        '--source',
        'example-bank-alpha-product',
        '--reason',
        'keep-existing-capture',
      ),
    ).toBe(0);
    view = await h.view();
    expect(view.cards[0].stages.capture.status).toBe('done');
    expect((await h.state()).resolvedFlags?.['example-bank-alpha-product']?.reason).toBe(
      'keep-existing-capture',
    );
  });
});
