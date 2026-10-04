// The card-expansion pipeline CLI (wiki/system/card-expansion-pipeline.md).
//
//   npm run pipeline -- init <batch> --issuer "<Name>" --cards "<names or ids>" [--domains a.com,b.com]
//                           [--refresh] [--summary "<request in Evan's words>"]
//   npm run pipeline -- status [--batch B] [--json]
//   npm run pipeline -- next [--batch B] [--json]
//   npm run pipeline -- run <capture|extract|draft|apply|build|eval> [--batch B] [--only ids] [--concurrency N]
//                           [--wait-minutes N] [--proposed] [--version <catalog version>]
//   npm run pipeline -- drop-source --source <id> --reason <code> [--batch B]
//   npm run pipeline -- rebase-anchors [--batch B]
//   npm run pipeline -- claim <research|verify|adjudicate|overlay> --issuer <slug> [--batch B] [--release]
//   npm run pipeline -- accept <research|verify|adjudicate|overlay> --issuer <slug> --agent-run <id> [--model <id>]
//                           [--duration-ms N] [--tokens N] [--batch B] [--dry-run]
//   npm run pipeline -- resolve capture-flagged --source <id> --reason <code> [--batch B]
//   npm run pipeline -- lint-labels [--batch B | --dir evals/curation/expansion] [--json]
//   npm run pipeline -- eval [--batch B] [--cross-model-run DIR]
//   npm run pipeline -- handoff [--batch B]
//
// Exit status: 0 done, 1 error or failed gate, 2 usage or not built yet, 3 usage limit (extract paused).
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { deriveBatch, nextStep } from './derive.ts';
import type { BatchView, NextStep } from './derive.ts';
import { batchDir, batchFileSchema, listBatches, loadBatch, slugify, statePath } from './files.ts';
import { runEval } from './eval.ts';
import { handoff } from './handoff.ts';
import { rebaseAnchors } from './rebase.ts';
import { runStage } from './run.ts';
import type { Env } from './run.ts';
import { accept } from './accept.ts';
import { resolveCaptureFlag } from './capture.ts';
import { dropSource } from './drop-source.ts';
import { lintLabels } from './lint-command.ts';
import { claim, openPacketStatus } from './packets.ts';
import type { PacketStatus } from './packets.ts';
import {
  BATCH_ID,
  CAPTURE_FLAG_REASONS,
  CARD_STAGES,
  CLI_STAGES,
  DROP_SOURCE_REASONS,
  ISSUER_STAGES,
  STATUSES,
  initialState,
  writeJsonAtomic,
  writeState,
} from './state.ts';
import type { CliStage, IssuerStage } from './state.ts';
import { REPO_ROOT } from './root.ts';

const USAGE = `Usage: npm run pipeline -- <command>
  init <batch> --issuer "<Name>" --cards "<names or ids>" [--domains a.com,b.com] [--refresh] [--summary "<text>"]
  status [--batch B] [--json]
  next [--batch B] [--json]
  run <${CLI_STAGES.join('|')}> [--batch B] [--only ids] [--concurrency N] [--wait-minutes N]
      build: [--proposed] [--version <catalog version>] (--version is required with --proposed)
  rebase-anchors [--batch B]
  claim <${ISSUER_STAGES.join('|')}> --issuer <slug> [--batch B] [--release]
  accept <${ISSUER_STAGES.join('|')}> --issuer <slug> --agent-run <id> [--model <id>] [--duration-ms N] [--tokens N] [--batch B] [--dry-run]
  resolve capture-flagged --source <id> --reason <${CAPTURE_FLAG_REASONS.join('|')}> [--batch B]
  drop-source --source <id> --reason <${DROP_SOURCE_REASONS.join('|')}> [--batch B]
  lint-labels [--batch B | --dir <corpus dir>] [--json]
  eval [--batch B] [--cross-model-run DIR]
  handoff [--batch B]`;

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function defaultEnv(): Env {
  return {
    root: REPO_ROOT,
    now: () => new Date(),
    env: process.env,
    log: (line) => console.log(line),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    exec: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
        child.on('error', () => resolve(127));
        child.on('close', (code) => resolve(code ?? 1));
      }),
  };
}

async function batchesFor(env: Env, batch: string | undefined): Promise<string[]> {
  if (batch) return [batch];
  return listBatches(env.root);
}

/** The single batch a run or rebase acts on: --batch, or the only batch there is. */
async function oneBatch(env: Env, batch: string | undefined): Promise<string> {
  if (batch) return batch;
  const all = await listBatches(env.root);
  if (all.length !== 1) throw new UsageError(`--batch is required (${all.length} batches).`);
  return all[0];
}

class UsageError extends Error {}

export async function init(
  env: Env,
  batch: string,
  options: { issuer?: string; cards?: string; domains?: string; refresh?: boolean; summary?: string },
): Promise<number> {
  if (!BATCH_ID.test(batch))
    throw new UsageError(`Batch id must match ${BATCH_ID} (e.g. wells-fargo-2026-10).`);
  if (!options.issuer) throw new UsageError('--issuer is required.');
  const cards = list(options.cards);
  if (!cards.length) throw new UsageError('--cards is required (comma separated names or ids).');
  const dir = batchDir(env.root, batch);
  const exists = await access(join(dir, 'pipeline', 'batch.json')).then(
    () => true,
    () => false,
  );
  if (exists) {
    env.log(`Batch ${batch} already exists; refusing to overwrite it.`);
    return 1;
  }
  const now = env.now();
  const slug = slugify(options.issuer);
  const meta = batchFileSchema.parse({
    schemaVersion: 1,
    batch,
    issuers: [
      { name: options.issuer, slug, domains: list(options.domains).map((domain) => domain.toLowerCase()) },
    ],
    requestedCards: cards,
    refresh: options.refresh ?? false,
    summary: options.summary ?? null,
    createdAt: now.toISOString(),
  });
  await writeJsonAtomic(join(dir, 'pipeline', 'batch.json'), meta);
  await writeState(statePath(dir), initialState(batch, [slug], now), now);
  env.log(`Batch ${batch} created: ${join(dir, 'pipeline')}`);
  return 0;
}

export interface StatusJson {
  batch: string;
  counts: Record<string, Partial<Record<string, number>>>;
  /** Open packets and their output: absent, present (awaiting accept), present-not-accepted (a gate failed). */
  packets: PacketStatus[];
  rebaseAnchors: string[];
  queue: BatchView['queue'];
}

export function statusJson(view: BatchView, packets: PacketStatus[]): StatusJson {
  const counts: StatusJson['counts'] = {};
  const add = (stage: string, status: string) => {
    counts[stage] ??= {};
    counts[stage][status] = (counts[stage][status] ?? 0) + 1;
  };
  for (const derived of Object.values(view.research)) add('research', derived.status);
  for (const stage of CARD_STAGES) for (const card of view.cards) add(stage, card.stages[stage].status);
  add('build', view.build.status);
  add('eval', view.eval.status);
  return {
    batch: view.batch.id,
    counts,
    packets,
    rebaseAnchors: view.cards.filter((card) => card.rebaseAnchors).map((card) => card.cardId),
    queue: view.queue,
  };
}

function statusText(status: StatusJson, cardCount: number): string {
  const order = [
    'research',
    'capture',
    'extract',
    'draft',
    'verify',
    'adjudicate',
    'apply',
    'overlay',
    'freshness',
    'build',
    'eval',
  ];
  const lines = [
    `${status.batch} (${cardCount} cards)`,
    `  ${'stage'.padEnd(11)}${STATUSES.map((s) => s.padStart(15)).join('')}`,
  ];
  for (const stage of order)
    lines.push(
      `  ${stage.padEnd(11)}${STATUSES.map((s) => String(status.counts[stage]?.[s] ?? 0).padStart(15)).join('')}`,
    );
  lines.push(
    `  open packets: ${status.packets.length ? status.packets.map((p) => `${p.file} (output ${p.output})`).join(', ') : 'none'}`,
  );
  if (status.rebaseAnchors.length) lines.push(`  rebase anchors: ${status.rebaseAnchors.join(', ')}`);
  lines.push(`  queue: ${status.queue.length ? '' : 'empty'}`);
  for (const item of status.queue)
    lines.push(
      `    ${item.code} ${item.stage} ${item.cardId ?? item.issuer ?? ''} owner=${item.owner} ref=${item.ref}`,
    );
  return lines.join('\n');
}

export async function next(env: Env, batch?: string): Promise<NextStep> {
  const ids = await batchesFor(env, batch);
  if (!ids.length)
    return {
      kind: 'cli',
      stage: 'init',
      command: 'npm run pipeline -- init <issuer-slug>-<YYYY-MM> --issuer "<Name>" --cards "<names>"',
      reason: 'no batch yet',
    };
  let fallback: NextStep | null = null;
  for (const id of ids) {
    const step = nextStep(await deriveBatch(await loadBatch(env.root, id), env.now()));
    if (step.kind !== 'wait') return step;
    if (!fallback || (step.until && (!fallback.until || step.until < fallback.until))) fallback = step;
  }
  return fallback!;
}

export async function main(argv: string[], env: Env = defaultEnv()): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        batch: { type: 'string' },
        json: { type: 'boolean', default: false },
        issuer: { type: 'string' },
        cards: { type: 'string' },
        domains: { type: 'string' },
        refresh: { type: 'boolean', default: false },
        summary: { type: 'string' },
        only: { type: 'string' },
        concurrency: { type: 'string' },
        'wait-minutes': { type: 'string' },
        release: { type: 'boolean', default: false },
        'agent-run': { type: 'string' },
        model: { type: 'string' },
        'duration-ms': { type: 'string' },
        tokens: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        source: { type: 'string' },
        reason: { type: 'string' },
        dir: { type: 'string' },
        'cross-model-run': { type: 'string' },
        proposed: { type: 'boolean', default: false },
        version: { type: 'string' },
      },
    });
    switch (command) {
      case 'init':
        if (positionals.length !== 1) throw new UsageError('init takes one batch id.');
        return await init(env, positionals[0], values);
      case 'status': {
        const out: StatusJson[] = [];
        const counts: number[] = [];
        for (const id of await batchesFor(env, values.batch)) {
          const view = await deriveBatch(await loadBatch(env.root, id), env.now());
          out.push(statusJson(view, await openPacketStatus(view.batch)));
          counts.push(view.cards.length);
        }
        if (values.json) env.log(JSON.stringify({ batches: out }, null, 2));
        else
          env.log(
            out.length ? out.map((status, i) => statusText(status, counts[i])).join('\n\n') : 'No batches.',
          );
        return 0;
      }
      case 'next': {
        const step = await next(env, values.batch);
        env.log(
          values.json
            ? JSON.stringify(step, null, 2)
            : `${step.kind} ${step.stage}: ${step.command ?? ''} (${step.reason})`,
        );
        return 0;
      }
      case 'run': {
        const stage = positionals[0] as CliStage;
        if (positionals.length !== 1 || !CLI_STAGES.includes(stage))
          throw new UsageError(
            `run takes one CLI stage: ${CLI_STAGES.join(', ')} (research, verify, adjudicate and overlay are agent stages).`,
          );
        const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
        if (
          concurrency !== undefined &&
          (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
        )
          throw new UsageError('--concurrency must be 1 to 8.');
        if ((values.proposed || values.version !== undefined) && stage !== 'build')
          throw new UsageError('--proposed and --version apply to run build only.');
        if (values.proposed && !values.version)
          throw new UsageError('run build --proposed needs --version <new catalog version>.');
        const waitMinutes = values['wait-minutes'] === undefined ? undefined : Number(values['wait-minutes']);
        if (waitMinutes !== undefined && !(waitMinutes >= 0))
          throw new UsageError('--wait-minutes must be 0 or more.');
        return await runStage(env, await oneBatch(env, values.batch), stage, {
          only: values.only ? list(values.only) : undefined,
          concurrency,
          waitMinutes,
          crossModelRun: values['cross-model-run'],
          proposed: values.proposed,
          version: values.version,
        });
      }
      case 'eval':
        return await runEval(env, await oneBatch(env, values.batch), {
          crossModelRun: values['cross-model-run'],
        });
      case 'handoff':
        return await handoff(env, values.batch);
      case 'rebase-anchors': {
        const result = await rebaseAnchors(env, await oneBatch(env, values.batch));
        env.log(
          `rebase-anchors: ${result.rebased.length} card(s) rebased, ${result.fixesChanged} finding(s) re-pointed` +
            (result.unresolved.length
              ? `; unresolved (re-verify): ${result.unresolved.map((item) => `${item.cardId} ${item.path}`).join(', ')}`
              : ''),
        );
        return result.unresolved.length ? 1 : 0;
      }
      case 'claim':
      case 'accept': {
        const stage = positionals[0] as IssuerStage;
        if (positionals.length !== 1 || !ISSUER_STAGES.includes(stage))
          throw new UsageError(`${command} takes one agent stage: ${ISSUER_STAGES.join(', ')}.`);
        if (!values.issuer) throw new UsageError('--issuer <slug> is required.');
        const batch = await oneBatch(env, values.batch);
        if (command === 'claim')
          return await claim(env, batch, stage, values.issuer, { release: values.release });
        const int = (value: string | undefined) => (value === undefined ? undefined : Number(value));
        return await accept(env, batch, stage, values.issuer, {
          agentRun: values['agent-run'],
          model: values.model,
          dryRun: values['dry-run'],
          durationMs: int(values['duration-ms']),
          tokens: int(values.tokens),
        });
      }
      case 'resolve':
        if (positionals[0] !== 'capture-flagged' || !values.source || !values.reason)
          throw new UsageError('resolve capture-flagged --source <id> --reason <code>.');
        return await resolveCaptureFlag(env, await oneBatch(env, values.batch), values.source, values.reason);
      case 'drop-source':
        if (positionals.length || !values.source || !values.reason)
          throw new UsageError('drop-source --source <id> --reason <code>.');
        return await dropSource(env, await oneBatch(env, values.batch), values.source, values.reason);
      case 'lint-labels':
        return await lintLabels(env, { batch: values.batch, dir: values.dir, json: values.json });
      default:
        env.log(USAGE);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      env.log(`${error.message}\n${USAGE}`);
      return 2;
    }
    env.log(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
