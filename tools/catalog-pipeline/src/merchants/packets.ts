// Work packets of the merchant pipeline's two agent stages (research, verify), modelled on the card pipeline's:
// `claim` writes packets/<stage>.<n>.json (gitignored: absolute paths) naming the stores, the inputs and the one output
// file; `accept` runs the stage's gate on that file and records packet, agent run, model, duration and tokens in
// state.json. Gate errors name paths and fields only, never page text.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { CATALOG_V3 } from '../../../../packages/rewards-core/src/catalog-v3.ts';
import { MERCHANT_CATEGORIES_V3 } from '../../../../packages/rewards-core/src/types.ts';
import { fileSha256 } from '../hash.ts';
import { TOKEN, writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { hostGate } from './candidates.ts';
import {
  MERCHANT_AGENTS,
  RESEARCHER_AGENT,
  VERIFIED_FIELDS,
  VERIFIER_AGENT,
  draftFileSchema,
  loadBatch,
  manifestFileSchema,
  packetSchema,
  readJsonOrNull,
  researchFileSchema,
  verificationFileSchema,
  wordCount,
  writeState,
} from './files.ts';
import type { Batch, MerchantAgentStage, Packet, ResearchFile, VerificationFile } from './files.ts';

export const packetsDir = (batch: Batch): string => join(batch.dir, 'packets');
export const outputOf = (stage: MerchantAgentStage): string =>
  ({ research: 'research.json', verify: 'verification.json' })[stage];

async function readPackets(batch: Batch): Promise<Packet[]> {
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(packetsDir(batch)).catch(() => [] as string[]);
  const out: Packet[] = [];
  for (const name of names.sort()) {
    const text = await readFile(join(packetsDir(batch), name), 'utf8').catch(() => null);
    if (!text) continue;
    const parsed = packetSchema.safeParse(JSON.parse(text));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function openPacket(batch: Batch, stage: MerchantAgentStage): Promise<Packet | null> {
  return (await readPackets(batch)).find((p) => p.status === 'open' && p.stage === stage) ?? null;
}

const writePacket = (batch: Batch, packet: Packet) =>
  writeJsonAtomic(join(packetsDir(batch), `${packet.stage}.${packet.n}.json`), packetSchema.parse(packet));

/** Written at `claim verify`: the catalog brand and category lists (`verify/catalog-lists.json`) and one sheet per
 * store (`verify/<domain>.md`) with every drafted quote and ±300 characters of its capture around it, so the verifier
 * reads about 2 KB per store instead of every capture. Verbatim and length checks are the draft gate's. */
async function writeVerifySheets(batch: Batch): Promise<string[]> {
  const dir = join(batch.dir, 'verify');
  await mkdir(dir, { recursive: true });
  const lists = join(dir, 'catalog-lists.json');
  await writeJsonAtomic(lists, {
    brands: CATALOG_V3.brands.map((b) => ({ id: b.id, name: b.name })),
    categories: [...MERCHANT_CATEGORIES_V3],
  });
  const out = [lists];
  for (const store of batch.meta.stores) {
    const file = await readJsonOrNull(join(batch.dir, `drafts/${store.domain}.json`), draftFileSchema);
    if (!file) continue;
    const d = file.draft;
    const lines = [
      `# ${store.domain}: drafted quotes in context`,
      '',
      `Draft: kind ${d.kind}, physicalGoods ${d.physicalGoods}, candidateCategory ${d.candidateCategory ?? 'null'}, brands ${d.brandIds.join(', ') || 'none'}.`,
      '',
    ];
    for (const [i, item] of file.draft.evidence.entries()) {
      const capture = await readFile(join(batch.dir, `captures/${item.sourceId}.txt`), 'utf8').catch(
        () => '',
      );
      const words = item.quote.trim().split(/\s+/).filter(Boolean);
      const match = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')).exec(
        capture,
      );
      const context = match
        ? capture.slice(Math.max(0, match.index - 300), match.index + match[0].length + 300)
        : '(quote not found in the capture; the draft gate reports this)';
      lines.push(
        `## evidence[${i}] ${item.sourceId} (${item.supports})`,
        '',
        `Quote: ${item.quote}`,
        '',
        '```',
        context,
        '```',
        '',
      );
    }
    const path = join(dir, `${store.domain}.md`);
    await writeFile(path, lines.join('\n'));
    out.push(path);
  }
  return out;
}

async function inputsOf(batch: Batch, stage: MerchantAgentStage): Promise<string[]> {
  const at = (path: string) => join(batch.dir, path);
  if (stage === 'research') return [at('batch.json'), join(batch.root, RESEARCHER_AGENT)];
  const manifest = await readJsonOrNull(at('manifest.json'), manifestFileSchema);
  // Store and lookup pages in full; issuer captures as the windows around the store's name (the full text stays
  // in captures/ for a verifier that wants it).
  const captures = (manifest?.sources ?? []).map((s) =>
    s.kind === 'issuer-terms' ? at(`captures/${s.id}.windows.${s.domain}.txt`) : at(`captures/${s.id}.txt`),
  );
  return [
    join(batch.root, VERIFIER_AGENT),
    at('research.json'),
    at('manifest.json'),
    ...(await writeVerifySheets(batch)),
    ...batch.meta.stores.map((s) => at(`drafts/${s.domain}.json`)),
    ...captures,
  ];
}

export async function claim(
  env: Env,
  batchId: string,
  stage: MerchantAgentStage,
  { release = false } = {},
): Promise<number> {
  const batch = await loadBatch(env.root, batchId);
  const open = await openPacket(batch, stage);
  const now = env.now().toISOString();
  if (release) {
    if (!open) {
      env.log(`claim --release: no open ${stage} packet.`);
      return 1;
    }
    await writePacket(batch, { ...open, status: 'released', closedAt: now });
    env.log(`Released ${stage}.${open.n}.json.`);
    return 0;
  }
  if (open) {
    env.log(`claim: ${stage} is already claimed (${stage}.${open.n}.json); accept it or release it first.`);
    return 1;
  }
  const status = batch.state.stages[stage].status;
  if (status === 'done') {
    env.log(`claim: ${stage} is done; nothing to claim.`);
    return 1;
  }
  if (stage === 'verify' && batch.state.stages.draft.status !== 'done') {
    env.log('claim: verify needs the draft stage done first.');
    return 1;
  }
  const n = Math.max(0, ...(await readPackets(batch)).filter((p) => p.stage === stage).map((p) => p.n)) + 1;
  const output = join(batch.dir, outputOf(stage));
  const inputs = await inputsOf(batch, stage);
  const inputSha256: Record<string, string> = {};
  for (const path of inputs) {
    const sha = await fileSha256(path);
    if (sha) inputSha256[path] = sha;
  }
  const packet: Packet = {
    schemaVersion: 1,
    packetId: randomUUID(),
    batch: batch.id,
    stage,
    n,
    agent: MERCHANT_AGENTS[stage],
    domains: batch.meta.stores.map((s) => s.domain),
    inputs,
    output,
    claimedAt: now,
    status: 'open',
    outputSha256AtClaim: await fileSha256(output),
    inputSha256,
    attempts: [],
  };
  await writePacket(batch, packet);
  const path = join(packetsDir(batch), `${stage}.${n}.json`);
  env.log(`Claimed ${relative(env.root, path)} (packet ${packet.packetId}).`);
  env.log(`Start the ${packet.agent} subagent with the packet path: ${path}`);
  env.log(
    `It writes only ${output}; then run: npm run pipeline -- merchants accept ${stage} --batch ${batch.id} --agent-run <run id> --model <model id>`,
  );
  return 0;
}

/** The research gate: the schema, every batch store present once, hosts the store's own (store pages on them), no
 * platform or public-suffix host, lookup pages on another host than the store's. */
export function researchGate(file: ResearchFile, batch: Batch, packet: Packet): string[] {
  const errors: string[] = [];
  if (file.packetId !== packet.packetId) errors.push('packetId: not this packet');
  if (file.batch !== batch.id) errors.push('batch: not this batch');
  const expected = new Set(batch.meta.stores.map((s) => s.domain));
  const seen = new Set<string>();
  for (const store of file.stores) {
    const at = `stores[${store.domain}]`;
    if (!expected.has(store.domain)) errors.push(`${at}: not in batch.json`);
    if (seen.has(store.domain)) errors.push(`${at}: listed twice`);
    seen.add(store.domain);
    if (!store.hosts.includes(store.domain)) errors.push(`${at}.hosts: must include the domain`);
    for (const host of store.hosts) {
      const refused = hostGate(host);
      if (refused) errors.push(`${at}.hosts ${host}: ${refused}`);
    }
    const onOwnHost = (url: string) => {
      const host = new URL(url).hostname.toLowerCase();
      return store.hosts.some((h) => host === h || host.endsWith(`.${h}`));
    };
    for (const [i, page] of store.storePages.entries())
      if (!onOwnHost(page.url)) errors.push(`${at}.storePages[${i}].url: not on the store's hosts`);
    for (const [i, page] of store.lookupPages.entries()) {
      if (onOwnHost(page.url)) errors.push(`${at}.lookupPages[${i}].url: on the store's own host`);
      if (/forum|community|reddit|thread|discussion/i.test(page.url))
        errors.push(`${at}.lookupPages[${i}].url: a forum or community thread is not a merchant-code lookup`);
    }
  }
  for (const domain of expected) if (!seen.has(domain)) errors.push(`stores: ${domain} missing`);
  return errors;
}

/** The verify gate: the schema, every batch store once, every field decided, a reason for every dispute, and the
 * filesRead naming every draft and capture of the packet. */
export function verifyGate(file: VerificationFile, batch: Batch, packet: Packet): string[] {
  const errors: string[] = [];
  if (file.packetId !== packet.packetId) errors.push('packetId: not this packet');
  if (file.batch !== batch.id) errors.push('batch: not this batch');
  const expected = new Set(batch.meta.stores.map((s) => s.domain));
  const seen = new Set<string>();
  for (const store of file.stores) {
    const at = `stores[${store.domain}]`;
    if (!expected.has(store.domain)) errors.push(`${at}: not in batch.json`);
    if (seen.has(store.domain)) errors.push(`${at}: listed twice`);
    seen.add(store.domain);
    for (const field of VERIFIED_FIELDS) {
      const verdict = store.fields[field];
      if (verdict.verdict === 'disputed' && !verdict.reason?.trim())
        errors.push(`${at}.fields.${field}: disputed without a reason`);
    }
  }
  for (const domain of expected) if (!seen.has(domain)) errors.push(`stores: ${domain} missing`);
  const read = new Set(file.verifier.filesRead.map((f) => f.split('/').pop()));
  for (const input of packet.inputs)
    if (/\/(drafts|captures|verify)\//.test(input) && !read.has(input.split('/').pop()))
      errors.push(`verifier.filesRead: ${relative(batch.dir, input)} not read`);
  return errors;
}

/** The draft gate (used by `run draft` and again at verify): Zod, quotes verbatim in the named capture and at most 25
 * words, brands from the catalog, every source id of the store. */
export async function draftGate(batch: Batch, domain: string): Promise<string[]> {
  const errors: string[] = [];
  const file = await readJsonOrNull(join(batch.dir, `drafts/${domain}.json`), draftFileSchema);
  if (!file) return [`drafts/${domain}.json: missing or invalid`];
  if (file.draft.domain !== domain) errors.push(`drafts/${domain}.json: draft.domain differs`);
  const manifest = await readJsonOrNull(join(batch.dir, 'manifest.json'), manifestFileSchema);
  const sources = new Map((manifest?.sources ?? []).filter((s) => s.domain === domain).map((s) => [s.id, s]));
  const brands = new Set(CATALOG_V3.brands.map((b) => b.id));
  for (const id of file.draft.brandIds)
    if (!brands.has(id)) errors.push(`drafts/${domain}.json: unknown brand ${id}`);
  for (const [i, item] of file.draft.evidence.entries()) {
    const at = `drafts/${domain}.json: evidence[${i}]`;
    if (!sources.has(item.sourceId)) {
      errors.push(`${at}: source ${item.sourceId} is not this store's`);
      continue;
    }
    if (wordCount(item.quote) > 25) errors.push(`${at}: quote longer than 25 words`);
    const capture = await readFile(join(batch.dir, `captures/${item.sourceId}.txt`), 'utf8').catch(
      () => null,
    );
    if (capture === null) errors.push(`${at}: capture of ${item.sourceId} missing`);
    else {
      const { quoteIn } = await import('./files.ts');
      if (!quoteIn(item.quote, capture)) errors.push(`${at}: quote not found verbatim in ${item.sourceId}`);
    }
  }
  return errors;
}

export interface AcceptOptions {
  agentRun?: string;
  model?: string;
  dryRun?: boolean;
  durationMs?: number;
  tokens?: number;
}

export async function accept(
  env: Env,
  batchId: string,
  stage: MerchantAgentStage,
  options: AcceptOptions,
): Promise<number> {
  if (!options.agentRun || !TOKEN.test(options.agentRun)) {
    env.log('accept: --agent-run <id> is required.');
    return 2;
  }
  if (options.model !== undefined && !TOKEN.test(options.model)) {
    env.log('accept: --model must be one token.');
    return 2;
  }
  const batch = await loadBatch(env.root, batchId);
  const packet = await openPacket(batch, stage);
  if (!packet) {
    env.log(`accept: no open ${stage} packet; claim one first.`);
    return 1;
  }
  const errors: string[] = [];
  for (const [path, sha] of Object.entries(packet.inputSha256))
    if (path !== packet.output && (await fileSha256(path)) !== sha)
      errors.push(`input changed since claim: ${relative(env.root, path)}`);
  const text = await readFile(packet.output, 'utf8').catch(() => null);
  if (text === null) errors.push(`output missing: ${relative(env.root, packet.output)}`);
  else {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      errors.push('output is not JSON');
    }
    if (raw !== undefined) {
      const schema = stage === 'research' ? researchFileSchema : verificationFileSchema;
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        errors.push(...parsed.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`));
      else if (stage === 'research') errors.push(...researchGate(parsed.data as ResearchFile, batch, packet));
      else {
        errors.push(...verifyGate(parsed.data as VerificationFile, batch, packet));
        for (const store of batch.meta.stores) errors.push(...(await draftGate(batch, store.domain)));
      }
    }
  }
  const now = env.now();
  if (errors.length) {
    env.log(`accept ${stage}: ${errors.length} gate error(s):`);
    for (const error of errors.slice(0, 60)) env.log(`  - ${error}`);
    if (!options.dryRun) {
      packet.attempts.push({ at: now.toISOString(), result: 'failed-gate' });
      await writePacket(batch, packet);
      batch.state.stages[stage] = {
        ...batch.state.stages[stage],
        status: 'failed-gate',
        attempts: packet.attempts.length,
      };
      await writeState(batch.dir, batch.state, now);
    }
    return 1;
  }
  if (options.dryRun) {
    env.log(`accept ${stage} --dry-run: gates pass.`);
    return 0;
  }
  packet.attempts.push({ at: now.toISOString(), result: 'accepted' });
  await writePacket(batch, { ...packet, status: 'accepted', closedAt: now.toISOString() });
  const agentFile = join(env.root, stage === 'research' ? RESEARCHER_AGENT : VERIFIER_AGENT);
  batch.state.stages[stage] = {
    status: 'done',
    finishedAt: now.toISOString(),
    attempts: packet.attempts.length,
    packetId: packet.packetId,
    agentRun: options.agentRun,
    ...(options.model ? { model: options.model } : {}),
    acceptedAt: now.toISOString(),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.tokens !== undefined ? { tokens: options.tokens } : {}),
    inputSha256: (await fileSha256(agentFile)) ?? undefined,
  };
  await writeState(batch.dir, batch.state, now);
  env.log(`Accepted ${stage} (packet ${packet.packetId}, run ${options.agentRun}).`);
  return 0;
}
