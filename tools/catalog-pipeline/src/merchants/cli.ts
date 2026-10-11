// `npm run pipeline -- merchants <command>`: the merchant pipeline (Phase 14.3, wiki/system/merchant-pipeline.md).
//
//   merchants candidates [--check]                    build or check the frozen candidate list
//   merchants tier-a [--only a.com,b.com] [--limit N] [--allow-heldout]  deterministic long-tail records (no model)
//   merchants init <batch> --stores a.com,b.com [--development] [--allow-heldout]
//   merchants status [--batch B] [--json]
//   merchants claim research|verify --batch B [--release]
//   merchants accept research|verify --batch B --agent-run <id> [--model <id>] [--duration-ms N] [--tokens N] [--dry-run]
//   merchants run capture|draft|apply|build --batch B [--only a.com,b.com]
//   merchants review                                   rewrite evals/merchants/db/review.md
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { runApply } from './apply.ts';
import { candidatesCommand, loadCandidates } from './candidates.ts';
import { runCapture } from './capture.ts';
import { runDraft } from './draft.ts';
import {
  BATCH_ID,
  MERCHANT_AGENT_STAGES,
  MERCHANT_CLI_STAGES,
  PACKET_SIZE,
  REVIEW_FILE,
  batchDir,
  batchFileSchema,
  initialState,
  listBatches,
  loadBatch,
  statePath,
  writeState,
} from './files.ts';
import type { MerchantAgentStage, MerchantCliStage } from './files.ts';
import { accept, claim, openPacket } from './packets.ts';
import { collectReview, reviewMarkdown, runBuild } from './review.ts';
import { tierACommand } from './tier-a.ts';

export const MERCHANTS_USAGE = `Usage: npm run pipeline -- merchants <command>
  candidates [--check]
  tier-a [--only a.com,b.com] [--limit N] [--allow-heldout]
  init <batch> --stores a.com,b.com [--development] [--allow-heldout]
  status [--batch B] [--json]
  claim <${MERCHANT_AGENT_STAGES.join('|')}> --batch B [--release]
  accept <${MERCHANT_AGENT_STAGES.join('|')}> --batch B --agent-run <id> [--model <id>] [--duration-ms N] [--tokens N] [--dry-run]
  run <${MERCHANT_CLI_STAGES.join('|')}> --batch B [--only a.com,b.com]
  review`;

class UsageError extends Error {}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export async function initMerchantBatch(
  env: Env,
  batch: string,
  options: { stores: string[]; development: boolean; allowHeldout: boolean },
): Promise<number> {
  if (!BATCH_ID.test(batch)) throw new UsageError(`Batch id must match ${BATCH_ID}.`);
  if (!options.stores.length) throw new UsageError('--stores is required (comma separated domains).');
  if (options.stores.length > PACKET_SIZE) throw new UsageError(`At most ${PACKET_SIZE} stores per batch.`);
  const dir = batchDir(env.root, batch);
  if (
    await access(join(dir, 'batch.json')).then(
      () => true,
      () => false,
    )
  ) {
    env.log(`Batch ${batch} already exists; refusing to overwrite it.`);
    return 1;
  }
  const candidates = await loadCandidates(env.root);
  const byDomain = new Map(candidates.candidates.map((c) => [c.domain, c]));
  const stores = [];
  for (const domain of options.stores) {
    const candidate = byDomain.get(domain);
    if (!candidate) {
      env.log(`init: ${domain} is not in candidates.json; the list is frozen.`);
      return 1;
    }
    if (candidate.tier !== 'B') {
      env.log(`init: ${domain} is tier A; run \`merchants tier-a\` for it.`);
      return 1;
    }
    if (candidate.heldOut && !options.allowHeldout) {
      env.log(
        `init: ${domain} is on the held-out list (blind audit set); never a development store. 14.4 passes --allow-heldout.`,
      );
      return 1;
    }
    if (candidate.heldOut && options.development) {
      env.log(`init: ${domain} is held out and cannot be in a development batch.`);
      return 1;
    }
    stores.push({
      domain,
      groups: candidate.groups,
      ...(candidate.id ? { id: candidate.id } : {}),
      ...(candidate.hosts ? { hosts: candidate.hosts } : {}),
    });
  }
  const now = env.now();
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(
    join(dir, 'batch.json'),
    batchFileSchema.parse({
      schemaVersion: 1,
      batch,
      createdAt: now.toISOString(),
      development: options.development,
      stores,
    }),
  );
  await writeState(dir, initialState(batch, now), now);
  env.log(`Batch ${batch} created with ${stores.length} stores: ${dir}`);
  env.log(`Next: npm run pipeline -- merchants claim research --batch ${batch}`);
  return 0;
}

async function status(env: Env, batchId: string | undefined, json: boolean): Promise<number> {
  const ids = batchId ? [batchId] : await listBatches(env.root);
  const out = [];
  for (const id of ids) {
    const batch = await loadBatch(env.root, id);
    const open = [];
    for (const stage of MERCHANT_AGENT_STAGES) {
      const packet = await openPacket(batch, stage);
      if (packet) open.push({ stage, packetId: packet.packetId, n: packet.n });
    }
    const drafts = Object.values(batch.state.stores)
      .map((s) => s.draft)
      .filter(Boolean);
    const tokens = drafts.reduce(
      (acc, d) => ({
        input: acc.input + d!.inputTokens,
        output: acc.output + d!.outputTokens,
        ms: acc.ms + d!.durationMs,
      }),
      { input: 0, output: 0, ms: 0 },
    );
    out.push({
      batch: id,
      development: batch.meta.development,
      stores: batch.meta.stores.length,
      stages: Object.fromEntries(Object.entries(batch.state.stages).map(([k, v]) => [k, v.status])),
      agents: Object.fromEntries(
        MERCHANT_AGENT_STAGES.map((stage) => {
          const record = batch.state.stages[stage];
          return [
            stage,
            {
              model: record.model ?? null,
              durationMs: record.durationMs ?? null,
              tokens: record.tokens ?? null,
            },
          ];
        }),
      ),
      draft: {
        stores: drafts.length,
        done: drafts.filter((d) => d!.status === 'done').length,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        modelMs: tokens.ms,
      },
      apply: {
        records: Object.values(batch.state.stores).filter((s) => s.apply === 'record').length,
        heldOut: Object.values(batch.state.stores).filter((s) => s.apply === 'held-out').length,
      },
      openPackets: open,
    });
  }
  if (json) env.log(JSON.stringify({ batches: out }, null, 2));
  else if (!out.length) env.log('No merchant batches.');
  else
    for (const b of out)
      env.log(
        [
          `${b.batch} (${b.stores} stores${b.development ? ', development' : ''})`,
          `  stages: ${Object.entries(b.stages)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`,
          `  research: ${b.agents.research.model ?? '-'} ${b.agents.research.tokens ?? '-'} tokens ${b.agents.research.durationMs ?? '-'} ms; verify: ${b.agents.verify.model ?? '-'} ${b.agents.verify.tokens ?? '-'} tokens ${b.agents.verify.durationMs ?? '-'} ms`,
          `  draft: ${b.draft.done}/${b.draft.stores} done, ${b.draft.inputTokens} in / ${b.draft.outputTokens} out tokens, ${Math.round(b.draft.modelMs / 1000)} s`,
          `  apply: ${b.apply.records} records, ${b.apply.heldOut} held out`,
          `  open packets: ${b.openPackets.length ? b.openPackets.map((p) => `${p.stage}.${p.n}`).join(', ') : 'none'}`,
        ].join('\n'),
      );
  return 0;
}

export async function merchantsMain(argv: string[], env: Env): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        batch: { type: 'string' },
        json: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        only: { type: 'string' },
        limit: { type: 'string' },
        stores: { type: 'string' },
        development: { type: 'boolean', default: false },
        'allow-heldout': { type: 'boolean', default: false },
        release: { type: 'boolean', default: false },
        'agent-run': { type: 'string' },
        model: { type: 'string' },
        'duration-ms': { type: 'string' },
        tokens: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
    });
    const oneBatch = async () => {
      if (values.batch) return values.batch;
      const all = await listBatches(env.root);
      if (all.length !== 1) throw new UsageError(`--batch is required (${all.length} batches).`);
      return all[0];
    };
    const int = (value: string | undefined) => (value === undefined ? undefined : Number(value));
    switch (command) {
      case 'candidates':
        return await candidatesCommand(env, { check: values.check });
      case 'tier-a':
        return await tierACommand(env, {
          only: values.only ? list(values.only) : undefined,
          limit: int(values.limit),
          allowHeldout: values['allow-heldout'],
        });
      case 'init':
        if (positionals.length !== 1) throw new UsageError('init takes one batch id.');
        return await initMerchantBatch(env, positionals[0], {
          stores: list(values.stores),
          development: values.development,
          allowHeldout: values['allow-heldout'],
        });
      case 'status':
        return await status(env, values.batch, values.json);
      case 'claim':
      case 'accept': {
        const stage = positionals[0] as MerchantAgentStage;
        if (positionals.length !== 1 || !MERCHANT_AGENT_STAGES.includes(stage))
          throw new UsageError(`${command} takes one agent stage: ${MERCHANT_AGENT_STAGES.join(', ')}.`);
        const batch = await oneBatch();
        if (command === 'claim') return await claim(env, batch, stage, { release: values.release });
        return await accept(env, batch, stage, {
          agentRun: values['agent-run'],
          model: values.model,
          dryRun: values['dry-run'],
          durationMs: int(values['duration-ms']),
          tokens: int(values.tokens),
        });
      }
      case 'run': {
        const stage = positionals[0] as MerchantCliStage;
        if (positionals.length !== 1 || !MERCHANT_CLI_STAGES.includes(stage))
          throw new UsageError(`run takes one CLI stage: ${MERCHANT_CLI_STAGES.join(', ')}.`);
        const only = values.only ? list(values.only) : undefined;
        if (stage === 'build') return await runBuild(env, values.batch);
        const batch = await oneBatch();
        if (stage === 'capture') return await runCapture(env, batch, { only });
        if (stage === 'draft') return await runDraft(env, batch, { only });
        return await runApply(env, batch);
      }
      case 'review': {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(env.root, REVIEW_FILE), reviewMarkdown(await collectReview(env.root)));
        env.log(`Wrote ${REVIEW_FILE}.`);
        return 0;
      }
      default:
        env.log(MERCHANTS_USAGE);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      env.log(`${error.message}\n${MERCHANTS_USAGE}`);
      return 2;
    }
    env.log(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export { statePath };
