// `pipeline accept <stage> --issuer <slug> --agent-run <id> [--model <id>] [--dry-run]` (wiki/system/card-expansion-
// pipeline.md, "Work packets"): reads the open packet's output, runs the stage's gates and, on success, records the
// packet, agent run, model and acceptance time in state.json and closes the packet. On failure the stage becomes
// failed-gate (not with --dry-run) and the errors name paths and fields only, never issuer text.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveBatch } from './derive.ts';
import type { BatchView } from './derive.ts';
import { loadBatch, statePath } from './files.ts';
import type { Batch } from './files.ts';
import { adjudicateGate, envelopeGate, overlayGate, quoteGate, verifyGate } from './gates.ts';
import { fileSha256 } from './hash.ts';
import { STAGE_VERSIONS, draftSplit } from './inputs.ts';
import { openPacket, writePacket } from './packets.ts';
import type { Packet } from './packets.ts';
import { researchGate } from './research.ts';
import { TOKEN, emptyCardState, writeJsonAtomic, writeState } from './state.ts';
import type { IssuerStage, StageRecord } from './state.ts';
import type { Env } from './run.ts';

export interface AcceptOptions {
  agentRun?: string;
  model?: string;
  dryRun?: boolean;
  /** From the subagent's completion notice; recorded on the issuer's stage record. */
  durationMs?: number;
  tokens?: number;
}

/** Dropped cards (card ID → reason code) from state, for the build and the overlay gate. */
export const droppedOf = (batch: Batch): Record<string, string> =>
  Object.fromEntries(
    Object.entries(batch.state.cards).flatMap(([cardId, card]) =>
      card.dropped ? [[cardId, card.dropped]] : [],
    ),
  );

/** Input files of the packet inside the batch (not the output) that changed since the claim. */
async function changedInputs(packet: Packet): Promise<string[]> {
  const out: string[] = [];
  for (const [path, sha] of Object.entries(packet.inputSha256 ?? {}))
    if (path !== packet.output && (await fileSha256(path)) !== sha) out.push(path);
  return out;
}

export async function accept(
  env: Env,
  batchId: string,
  stage: IssuerStage,
  issuer: string,
  options: AcceptOptions,
): Promise<number> {
  if (!options.agentRun || !TOKEN.test(options.agentRun)) {
    env.log(
      'accept: --agent-run <id> is required (the subagent run ID the session got when it started the agent).',
    );
    return 2;
  }
  if (options.model !== undefined && !TOKEN.test(options.model)) {
    env.log('accept: --model must be one token, e.g. claude-opus-5-5.');
    return 2;
  }
  for (const [flag, value] of [
    ['--duration-ms', options.durationMs],
    ['--tokens', options.tokens],
  ] as const)
    if (value !== undefined && !(Number.isSafeInteger(value) && value >= 0)) {
      env.log(`accept: ${flag} must be a whole number of 0 or more.`);
      return 2;
    }
  let batch = await loadBatch(env.root, batchId);
  const packet = await openPacket(batch, stage, issuer);
  if (!packet) {
    env.log(`accept: no open ${stage} packet for ${issuer}; claim one first.`);
    return 1;
  }
  if (stage === 'adjudicate') {
    const verify = batch.state.issuers[issuer]?.stages.verify;
    if (!verify?.acceptedAt || verify.status !== 'done') {
      env.log('accept adjudicate: verify is not accepted for this issuer.');
      return 1;
    }
    if (verify.agentRun === options.agentRun) {
      env.log(
        'accept adjudicate: refused, the agent run is the one that verified; the adjudicator is always another run.',
      );
      return 1;
    }
    if (packet.claimedAt < verify.acceptedAt) {
      env.log(
        'accept adjudicate: refused, the packet was claimed before verify was accepted; release it and claim again.',
      );
      return 1;
    }
  }
  const text = await readFile(packet.output, 'utf8').catch(() => null);
  if (text === null) {
    env.log(`accept: the packet's output is absent (${packet.output}).`);
    return 1;
  }
  let data: unknown;
  const errors: string[] = [];
  try {
    data = JSON.parse(text);
  } catch {
    errors.push('output: not valid JSON');
  }
  for (const path of await changedInputs(packet))
    errors.push(`${path}: changed since the claim (an agent writes only its output file)`);

  let merged: Awaited<ReturnType<typeof overlayGate>>['merged'];
  if (!errors.length)
    switch (stage) {
      case 'research':
        errors.push(...envelopeGate(packet, data), ...(await researchGate(batch, issuer, data)));
        errors.push(...(await quoteGate(batch, { requireCaptures: false })));
        break;
      case 'verify':
        errors.push(...(await verifyGate(batch, packet, data)));
        break;
      case 'adjudicate':
        errors.push(...(await adjudicateGate(batch, packet, data)));
        break;
      case 'overlay': {
        const result = await overlayGate(batch, packet, data, droppedOf(batch));
        errors.push(...result.errors);
        merged = result.merged;
        break;
      }
    }

  const now = env.now().toISOString();
  /** Records the stage failed-gate (issuer and packet cards) and the attempt on the packet; the packet stays open. */
  const failGate = async (reason: string): Promise<number> => {
    const view = await deriveBatch(batch, env.now());
    record(batch, view, stage, issuer, packet, { status: 'failed-gate', reason }, now);
    await writePacket(batch, {
      ...packet,
      attempts: [...packet.attempts, { at: now, result: 'failed-gate' }],
    });
    await writeState(statePath(batch.dir), batch.state, env.now());
    return 1;
  };
  if (errors.length) {
    env.log(
      `accept ${stage} ${issuer}: gate failed, ${errors.length} error(s)${options.dryRun ? ' (dry run, nothing recorded)' : ''}:`,
    );
    for (const error of errors) env.log(`- ${error}`);
    return options.dryRun ? 1 : failGate('gate-failed');
  }
  if (options.dryRun) {
    env.log(`accept ${stage} ${issuer}: gates pass (dry run, nothing recorded).`);
    return 0;
  }

  if (stage === 'research') {
    const code = await env.exec('node', ['scripts/build-expansion-cards.mjs', '--dir', batch.rel]);
    if (code !== 0) {
      env.log(`accept research ${issuer}: consolidating the research failed (exit ${code}).`);
      return failGate('consolidation-failed');
    }
  }
  if (merged) {
    await writeJsonAtomic(join(batch.dir, 'catalog-overlay.json'), merged.overlay);
    if (merged.rewardPrograms.cards.length)
      await writeJsonAtomic(join(batch.dir, 'reward-programs.json'), merged.rewardPrograms);
  }
  // Hashes are taken on the files as accepted.
  const state = batch.state;
  batch = await loadBatch(env.root, batchId);
  batch.state = state;
  const view = await deriveBatch(batch, env.now());
  const outputs = [];
  const sha = await fileSha256(packet.output);
  if (sha) outputs.push({ ref: `${stage === 'overlay' ? 'fragment' : stage}:${issuer}`, sha256: sha });
  record(
    batch,
    view,
    stage,
    issuer,
    packet,
    {
      status: 'done',
      agentRun: options.agentRun,
      ...(options.model ? { model: options.model } : {}),
      acceptedAt: now,
      outputs,
    },
    now,
    {
      ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
      ...(options.tokens !== undefined ? { tokens: options.tokens } : {}),
    },
  );
  await writePacket(batch, {
    ...packet,
    status: 'accepted',
    closedAt: now,
    attempts: [...packet.attempts, { at: now, result: 'accepted' }],
  });
  await writeState(statePath(batch.dir), batch.state, env.now());
  env.log(
    `Accepted ${stage} for ${issuer}${packet.cardIds.length ? ` (${packet.cardIds.length} card(s))` : ''}: packet ${packet.packetId}, run ${options.agentRun}.`,
  );
  return 0;
}

/** Writes the issuer-level record and, for card stages, each packet card's record (input hash as derived now). */
function record(
  batch: Batch,
  view: BatchView,
  stage: IssuerStage,
  issuer: string,
  packet: Packet,
  fields: Partial<StageRecord>,
  now: string,
  usage: Pick<StageRecord, 'durationMs' | 'tokens'> = {},
): void {
  const issuerState = (batch.state.issuers[issuer] ??= { stages: {} });
  const previous = issuerState.stages[stage];
  const base = {
    stageVersion: STAGE_VERSIONS[stage],
    packetId: packet.packetId,
    finishedAt: now,
    ...fields,
  };
  issuerState.stages[stage] = {
    ...base,
    ...(stage === 'research' && view.research[issuer]?.inputHash
      ? { inputHash: view.research[issuer].inputHash }
      : {}),
    ...usage,
    attempts: (previous?.attempts ?? 0) + 1,
  } as StageRecord;
  if (stage === 'research') return;
  for (const cardId of packet.cardIds) {
    const card = view.cards.find((entry) => entry.cardId === cardId);
    const cardState = (batch.state.cards[cardId] ??= emptyCardState());
    const prior = cardState.stages[stage];
    const split = stage === 'verify' && fields.status === 'done' ? draftSplit(batch, cardId) : null;
    cardState.stages[stage] = {
      ...base,
      ...(card?.stages[stage].inputHash ? { inputHash: card.stages[stage].inputHash } : {}),
      ...(split ?? {}),
      attempts: (prior?.attempts ?? 0) + 1,
    } as StageRecord;
    if (fields.status === 'done') delete cardState.stages[stage]!.outputs;
  }
}
