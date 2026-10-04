// Claimed work packets for the agent stages (wiki/system/card-expansion-pipeline.md, "Work packets"):
// `pipeline claim <stage> --issuer <slug>` writes pipeline/packets/<stage>.<issuer>.<n>.json with the cards, the
// absolute input paths, ONE absolute output path and a random packetId; `accept` closes it. A packet is never deleted:
// `--release` marks it released and `accept` marks it accepted, so the folder is the claim history of this checkout.
// Packets hold absolute paths of this machine, so they are gitignored; state.json keeps what was accepted.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { deriveBatch, AGENTS } from './derive.ts';
import type { BatchView } from './derive.ts';
import { loadBatch } from './files.ts';
import type { Batch } from './files.ts';
import { acksByCard } from './gates.ts';
import { fileSha256, jsonSha256 } from './hash.ts';
import { RESEARCHER_AGENT, VERIFIER_BRIEF, verifierFindings } from './inputs.ts';
import { ISSUER_STAGES, SLUG, writeJsonAtomic } from './state.ts';
import type { IssuerStage } from './state.ts';
import type { Env } from './run.ts';
import { sha256Json } from '../../../scripts/lib/catalog-batches.mjs';
import { verificationFileSchema } from '../../../scripts/lib/expansion-verification.mjs';

const slug = z.string().regex(SLUG).max(120);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime();

export const packetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: z.uuid(),
  batch: z.string(),
  issuer: slug,
  /** The issuer name as in batch.json and cards.json; the output's `issuer` field must equal it. */
  issuerName: z.string().min(1).max(80),
  stage: z.enum(ISSUER_STAGES),
  n: z.int().positive(),
  agent: z.string(),
  /** Research: none. Verify, adjudicate, overlay: the issuer's cards this packet covers. */
  cardIds: z.array(slug),
  inputs: z.array(z.string().min(1)),
  output: z.string().min(1),
  claimedAt: timestamp,
  status: z.enum(['open', 'accepted', 'released']),
  closedAt: timestamp.optional(),
  /** SHA-256 of the output file when the packet was claimed (null when absent): unchanged means not written yet. */
  outputSha256AtClaim: hex.nullable(),
  /** SHA-256 at the claim of every input file (not the output): `accept` refuses when one changed. */
  inputSha256: z.record(z.string(), hex).optional(),
  attempts: z.array(z.strictObject({ at: timestamp, result: z.enum(['failed-gate', 'accepted']) })),
  /** Overlay: the corpusCaseSha256 each entry must carry (the pairing hash of milestone 1). */
  corpusCaseSha256: z.record(slug, hex).optional(),
  /** Verify and adjudicate: hashes of what the agent must leave alone (other cards' entries; for adjudicate, the
   * verifier's findings of the packet cards and the verifier block; the label-lint acks of the other cards). */
  frozen: z
    .strictObject({
      entries: z.record(slug, hex),
      findings: z.record(slug, hex),
      verifier: hex.nullable(),
      acks: z.record(slug, hex).optional(),
    })
    .optional(),
});
export type Packet = z.infer<typeof packetSchema>;

export const packetsDir = (batch: Batch): string => join(batch.dir, 'pipeline', 'packets');
export const packetFile = (packet: Pick<Packet, 'stage' | 'issuer' | 'n'>): string =>
  `${packet.stage}.${packet.issuer}.${packet.n}.json`;

export interface PacketEntry {
  file: string;
  packet: Packet | null;
}

export async function readPackets(batch: Batch): Promise<PacketEntry[]> {
  const dir = packetsDir(batch);
  const out: PacketEntry[] = [];
  for (const file of batch.packets) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => null);
    let packet: Packet | null = null;
    try {
      packet = text === null ? null : packetSchema.parse(JSON.parse(text));
    } catch {
      packet = null;
    }
    out.push({ file, packet });
  }
  return out;
}

export async function openPacket(batch: Batch, stage: IssuerStage, issuer: string): Promise<Packet | null> {
  return (
    (await readPackets(batch)).find(
      (entry) =>
        entry.packet?.status === 'open' && entry.packet.stage === stage && entry.packet.issuer === issuer,
    )?.packet ?? null
  );
}

export const writePacket = (batch: Batch, packet: Packet): Promise<void> =>
  writeJsonAtomic(join(packetsDir(batch), packetFile(packet)), packetSchema.parse(packet));

/** Where the agent of each stage writes, relative to the batch directory. */
export const outputOf = (stage: IssuerStage, issuer: string): string =>
  ({
    research: `research/${issuer}.json`,
    verify: `verification/${issuer}.json`,
    adjudicate: `verification/${issuer}.json`,
    overlay: `overlay/${issuer}.json`,
  })[stage];

/** The cards a packet of this stage covers: the issuer's cards whose stage can run and is pending, stale or failed
 * (verify also takes the cards a rejected drop-card sends back). */
export function packetCards(view: BatchView, stage: IssuerStage, issuer: string): string[] {
  if (stage === 'research') return [];
  const reverify = new Set(
    view.queue
      .filter((item) => item.code === 'needs-reverify' && item.cardId)
      .map((item) => item.cardId as string),
  );
  return view.cards
    .filter((card) => card.issuer === issuer)
    .filter((card) => {
      const derived = card.stages[stage];
      if (stage === 'verify' && reverify.has(card.cardId)) return true;
      return derived.ready && ['pending', 'stale', 'failed-gate'].includes(derived.status);
    })
    .map((card) => card.cardId);
}

function inputsOf(batch: Batch, stage: IssuerStage, issuer: string, cardIds: string[]): string[] {
  const at = (path: string) => join(batch.dir, path);
  const captures = [
    ...new Set(cardIds.flatMap((id) => batch.cards.find((card) => card.id === id)?.sourceIds ?? [])),
  ]
    .filter((sourceId) => batch.manifest.has(sourceId))
    .map((sourceId) => at(`captures/${sourceId}.txt`));
  const conventions = at('verification/conventions');
  switch (stage) {
    case 'research':
      return [at('pipeline/batch.json'), join(batch.root, RESEARCHER_AGENT)];
    case 'verify':
      return [
        join(batch.root, VERIFIER_BRIEF),
        at('corpus.draft.json'),
        at('product-notes.json'),
        at(`verify/${issuer}.md`),
        conventions,
        ...captures,
      ];
    case 'adjudicate':
      return [
        join(batch.root, VERIFIER_BRIEF),
        at(`verification/${issuer}.json`),
        at('corpus.draft.json'),
        at('product-notes.json'),
        conventions,
        ...captures,
      ];
    case 'overlay':
      return [
        at('corpus.json'),
        at('product-notes.verified.json'),
        join(batch.root, 'evals/curation/expansion/catalog-overlay.json'),
        join(batch.root, 'evals/curation/expansion/reward-programs.json'),
        join(batch.root, 'evals/curation/expansion/merchants.json'),
        conventions,
        ...captures,
      ];
  }
}

/** `pipeline claim <stage> --issuer <slug> [--release]`. */
export async function claim(
  env: Env,
  batchId: string,
  stage: IssuerStage,
  issuer: string,
  { release = false }: { release?: boolean } = {},
): Promise<number> {
  const batch = await loadBatch(env.root, batchId);
  const meta = batch.meta.issuers.find((entry) => entry.slug === issuer);
  if (!meta) {
    env.log(`claim: issuer ${issuer} is not in batch ${batchId}.`);
    return 1;
  }
  const open = await openPacket(batch, stage, issuer);
  const now = env.now().toISOString();
  if (release) {
    if (!open) {
      env.log(`claim --release: no open ${stage} packet for ${issuer}.`);
      return 1;
    }
    await writePacket(batch, { ...open, status: 'released', closedAt: now });
    env.log(`Released ${relative(env.root, join(packetsDir(batch), packetFile(open)))}.`);
    return 0;
  }
  if (open) {
    env.log(
      `claim: ${stage} for ${issuer} is already claimed (${packetFile(open)}); accept it or release it first.`,
    );
    return 1;
  }
  const view = await deriveBatch(batch, env.now());
  const cardIds = packetCards(view, stage, issuer);
  if (stage === 'research') {
    const derived = view.research[issuer];
    if (!['pending', 'stale', 'failed-gate'].includes(derived.status)) {
      env.log(`claim: research for ${issuer} is ${derived.status}; nothing to claim.`);
      return 1;
    }
  } else if (!cardIds.length) {
    env.log(`claim: no ${issuer} card is ready for ${stage}; nothing to claim.`);
    return 1;
  }
  const n =
    Math.max(
      0,
      ...(await readPackets(batch))
        .filter((entry) => entry.packet?.stage === stage && entry.packet.issuer === issuer)
        .map((entry) => entry.packet!.n),
    ) + 1;
  const output = join(batch.dir, outputOf(stage, issuer));
  const inputs = inputsOf(batch, stage, issuer, cardIds);
  const inputSha256: Record<string, string> = {};
  for (const path of inputs) {
    const sha = path === output ? null : await fileSha256(path);
    if (sha) inputSha256[path] = sha;
  }
  const packet: Packet = {
    schemaVersion: 1,
    packetId: randomUUID(),
    batch: batch.id,
    issuer,
    issuerName: meta.name,
    stage,
    n,
    agent: AGENTS[stage],
    cardIds,
    inputs,
    output,
    claimedAt: now,
    status: 'open',
    outputSha256AtClaim: await fileSha256(output),
    inputSha256,
    attempts: [],
  };
  if (stage === 'overlay')
    packet.corpusCaseSha256 = Object.fromEntries(
      cardIds.map((id) => [id, sha256Json(batch.corpus.get(id)) as string]),
    );
  if (stage === 'verify' || stage === 'adjudicate') {
    const file = join(batch.dir, outputOf('verify', issuer));
    const entries: Record<string, string> = {};
    const findings: Record<string, string> = {};
    const acks: Record<string, string> = {};
    let verifier: string | null = null;
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text !== null) {
      // Hashed as the gates see it: parsed, with the schema's defaults filled in (`reason: null`, `fixes: []`,
      // `op: 'set'` …), so an omitted optional field hashes the same at claim and at accept.
      const raw: unknown = JSON.parse(text);
      const parsed = verificationFileSchema.safeParse(raw);
      const data = (parsed.success ? parsed.data : raw) as {
        verifier?: unknown;
        cards?: { cardId: string }[];
        labelLintAcks?: { cardId: string }[];
      };
      verifier = data.verifier === undefined ? null : jsonSha256(data.verifier);
      for (const entry of data.cards ?? []) {
        if (!cardIds.includes(entry.cardId)) entries[entry.cardId] = jsonSha256(entry);
        else if (stage === 'adjudicate')
          findings[entry.cardId] = jsonSha256(verifierFindings(entry as never));
      }
      for (const [cardId, list] of acksByCard(data.labelLintAcks))
        if (!cardIds.includes(cardId)) acks[cardId] = jsonSha256(list);
    }
    packet.frozen = { entries, findings, verifier: stage === 'adjudicate' ? verifier : null, acks };
  }
  await writePacket(batch, packet);
  const path = join(packetsDir(batch), packetFile(packet));
  env.log(`Claimed ${relative(env.root, path)} (packet ${packet.packetId}).`);
  env.log(`Start the ${packet.agent} subagent with the packet path: ${path}`);
  env.log(
    `It writes only ${output}; then run: npm run pipeline -- accept ${stage} --batch ${batch.id} --issuer ${issuer} --agent-run <run id> --model <model id>`,
  );
  return 0;
}

/** Packet status for `pipeline status`: open packets with their output absent, present, or present but rejected. */
export interface PacketStatus {
  file: string;
  stage?: string;
  issuer?: string;
  packetId?: string;
  output: 'absent' | 'present' | 'present-not-accepted' | 'invalid-packet';
}

export async function openPacketStatus(batch: Batch): Promise<PacketStatus[]> {
  const out: PacketStatus[] = [];
  for (const { file, packet } of await readPackets(batch)) {
    if (!packet) {
      out.push({ file, output: 'invalid-packet' });
      continue;
    }
    if (packet.status !== 'open') continue;
    const sha = await fileSha256(packet.output);
    const written = sha !== null && sha !== packet.outputSha256AtClaim;
    const rejected = packet.attempts.some((attempt) => attempt.result === 'failed-gate');
    out.push({
      file,
      stage: packet.stage,
      issuer: packet.issuer,
      packetId: packet.packetId,
      output: !written ? 'absent' : rejected ? 'present-not-accepted' : 'present',
    });
  }
  return out;
}
