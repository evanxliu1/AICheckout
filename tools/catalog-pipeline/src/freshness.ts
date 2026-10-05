// `pipeline freshness` (Phase 9, wiki/system/card-expansion-pipeline.md "Freshness"): re-render every source the
// current build config's catalog cites, exactly as capture does (scripts/capture-issuer-pages.mjs, the layer's capture
// hints, one process per host with 2.5 s between its pages, hosts in parallel), into a temporary directory under
// os.tmpdir(), hash the normalized text and delete it in all cases. The result is one committed, text-free record per
// day, evals/curation/freshness/<YYYY-MM-DD>.json (scripts/lib/freshness.mjs), which the catalog builder reads for
// source dates and `init --refresh-from-freshness` reads for changed pages. No model; refused under CI and RENDER
// because it fetches live pages.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FRESHNESS_DIR,
  FRESHNESS_RESULTS,
  MERCHANT_LAYER,
  MERCHANT_MANIFEST,
  PROBLEM_FLAGS,
  freshnessCounts,
  freshnessRecordSchema,
  loadFreshnessRecords,
} from '../../../scripts/lib/freshness.mjs';
import { fileSha256, sha256Hex } from './hash.ts';
import type { Env } from './run.ts';
import { slugify } from './files.ts';
import { writeJsonAtomic } from './state.ts';

export const CAPTURE_SCRIPT = 'scripts/capture-issuer-pages.mjs';
export const FRESHNESS_DELAY_MS = 2500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const scriptLib = (name: string) => new URL(`../../../scripts/lib/${name}`, import.meta.url).href;

interface ManifestSource {
  id: string;
  sha256: string;
  url?: string;
  kind?: string;
  capturedOn: string;
  checkedOn?: string;
}
interface Layer {
  id: string;
  kind: string;
  dir: string;
  cards: { cards: { id: string; issuer: string; sourceIds: string[] }[] } | null;
  corpus: { cases: { cardId: string; issuer: string; sourceIds: string[] }[] };
  manifest: { sources: ManifestSource[] };
}
interface Loaded {
  config: { version: string };
  layers: Layer[];
  merchantManifest: { sources: ManifestSource[] } | null;
  freshness: unknown[];
}
interface CatalogLibs {
  loadCatalogBatches: (root: string) => Promise<Loaded>;
  mergeLayers: (loaded: Loaded) => {
    corpora: { cases: { cardId: string; issuer: string; sourceIds: string[] }[] }[];
  };
  effectiveSources: (
    layers: Layer[],
    freshness: unknown[],
  ) => Map<string, { source: ManifestSource; layer: string }>;
}
interface CatalogV3Libs {
  citedSourceIds: (inputs: unknown) => Set<string>;
}

export interface FreshnessSource {
  sourceId: string;
  /** The build-config layer whose manifest supplies the hash (`merchants` for the MCC pages). */
  layer: string;
  /** The layer's directory, where its sources.json and capture-hints.json are. */
  dir: string;
  manifestSha256: string;
  url: string;
  kind: string;
  /** The layer's capture hint for the source, if any. */
  hint: unknown;
}

export interface CatalogCard {
  cardId: string;
  issuer: string;
  sourceIds: string[];
  /** The newest layer whose corpus has the card (the one the catalog takes it from). */
  layer: Layer;
}

export interface FreshnessPlan {
  version: string;
  loaded: Loaded;
  sources: FreshnessSource[];
  cards: CatalogCard[];
}

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * Every source the build config's catalog cites (`citedSourceIds`: card sources, issuer-stated program valuations,
 * merchant MCC pages), with the layer and manifest entry each hash comes from (`effectiveSources`, as the builder picks
 * it) and that layer's capture hint; and the catalog's cards with the layer each comes from.
 */
export async function freshnessPlan(root: string): Promise<FreshnessPlan> {
  const batches = (await import(scriptLib('catalog-batches.mjs'))) as CatalogLibs;
  const v3 = (await import(scriptLib('catalog-v3.mjs'))) as CatalogV3Libs;
  const loaded = await batches.loadCatalogBatches(root);
  const merged = batches.mergeLayers(loaded);
  const cited = v3.citedSourceIds(merged);
  const effective = batches.effectiveSources(loaded.layers, loaded.freshness);
  const dirs = new Map(loaded.layers.map((layer) => [layer.id, layer.dir]));
  const merchant = new Map((loaded.merchantManifest?.sources ?? []).map((source) => [source.id, source]));
  const hints = new Map<string, Record<string, unknown>>();
  const hintsOf = async (dir: string) => {
    if (!hints.has(dir))
      hints.set(dir, await readJsonOr<Record<string, unknown>>(join(root, dir, 'capture-hints.json'), {}));
    return hints.get(dir)!;
  };
  const sources: FreshnessSource[] = [];
  const problems: string[] = [];
  for (const sourceId of [...cited].sort()) {
    const found = effective.get(sourceId);
    const layer = found ? found.layer : merchant.has(sourceId) ? MERCHANT_LAYER : null;
    const source = found?.source ?? merchant.get(sourceId);
    if (!layer || !source) {
      problems.push(`${sourceId}: in no manifest of the build config or ${MERCHANT_MANIFEST}`);
      continue;
    }
    if (!source.url || !source.kind) {
      problems.push(`${sourceId}: its manifest entry has no url or kind`);
      continue;
    }
    const dir = found ? dirs.get(layer)! : 'evals/curation/real';
    sources.push({
      sourceId,
      layer,
      dir,
      manifestSha256: source.sha256,
      url: source.url,
      kind: source.kind,
      hint: found ? (await hintsOf(dir))[sourceId] : undefined,
    });
  }
  if (problems.length) throw new Error(`Cannot plan the freshness check:\n- ${problems.join('\n- ')}`);
  const layerOf = (cardId: string) =>
    [...loaded.layers].reverse().find((layer) => layer.corpus.cases.some((item) => item.cardId === cardId))!;
  // One entry per card: the real corpus has several cases (variants) per card; their sources are united.
  const byCard = new Map<string, CatalogCard>();
  for (const item of merged.corpora.flatMap((corpus) => corpus.cases)) {
    const card = byCard.get(item.cardId);
    if (card) card.sourceIds = [...new Set([...card.sourceIds, ...item.sourceIds])];
    else
      byCard.set(item.cardId, {
        cardId: item.cardId,
        issuer: item.issuer,
        sourceIds: item.sourceIds,
        layer: layerOf(item.cardId),
      });
  }
  const cards = [...byCard.values()];
  return { version: loaded.config.version, loaded, sources, cards };
}

/** One host's render: captures go to `<dir>/captures/<id>.txt`; the report is the capture script's. */
export interface RenderJob {
  dir: string;
  sources: { id: string; url: string; kind: string }[];
  hints: Record<string, unknown>;
}
export interface RenderResult {
  report: { id: string; ok: boolean; flags?: string[] }[];
  renderer: { playwright: string | null; chromium: string | null } | null;
}
export type Renderer = (job: RenderJob) => Promise<RenderResult>;

/** The real renderer: scripts/capture-issuer-pages.mjs on the job's directory; its output (no page text) is dropped. */
export function captureScriptRenderer(root: string): Renderer {
  return async (job) => {
    await writeFile(
      join(job.dir, 'sources.json'),
      JSON.stringify({ schemaVersion: 1, sources: job.sources }),
    );
    await writeFile(join(job.dir, 'hints.json'), JSON.stringify(job.hints));
    await new Promise<void>((done) => {
      const child = spawn(
        process.execPath,
        [
          join(root, CAPTURE_SCRIPT),
          ...['--dir', job.dir, '--sources', 'sources.json', '--captures', 'captures'],
          ...['--manifest', 'manifest.json', '--report', 'report.json', '--renderer', 'renderer.json'],
          ...['--hints', join(job.dir, 'hints.json'), '--delay-ms', String(FRESHNESS_DELAY_MS)],
        ],
        { cwd: root, stdio: 'ignore' },
      );
      child.on('error', () => done());
      child.on('close', () => done());
    });
    return {
      report: await readJsonOr(join(job.dir, 'report.json'), []),
      renderer: await readJsonOr(join(job.dir, 'renderer.json'), null),
    };
  };
}

/** The record's flag codes for the capture script's flags (`HTTP 403`, `short`, `bot-wall?`, `pdf download`). */
export function flagCodes(flags: string[] = [], ok = true): string[] {
  const codes = new Set<string>();
  for (const flag of flags) {
    if (/^HTTP \d+/.test(flag)) codes.add('http-error');
    else if (flag === 'short') codes.add('short');
    else if (flag.startsWith('bot-wall')) codes.add('bot-wall');
    else if (flag === 'pdf download') codes.add('pdf-download');
    else codes.add('other');
  }
  if (!ok) codes.add('fetch-failed');
  return [...codes].sort();
}

type Entry = {
  sourceId: string;
  layer: string;
  manifestSha256: string;
  sha256: string | null;
  result: (typeof FRESHNESS_RESULTS)[number];
  flags: string[];
  checkedOn: string;
};
type FreshnessRecord = {
  schemaVersion: 1;
  checkedOn: string;
  catalogVersion: string;
  renderer: { captureScriptSha256: string; playwright: string | null; chromium: string | null };
  counts: Record<string, number>;
  sources: Entry[];
};

export const freshnessPath = (root: string, date: string): string =>
  join(root, FRESHNESS_DIR, `${date}.json`);

export async function readFreshnessRecord(root: string, date: string): Promise<FreshnessRecord | null> {
  const path = freshnessPath(root, date);
  const data = await readJsonOr<unknown>(path, null);
  if (data === null) return null;
  const parsed = freshnessRecordSchema.safeParse(data);
  if (!parsed.success) throw new Error(`${FRESHNESS_DIR}/${date}.json is not a valid freshness record.`);
  return parsed.data as FreshnessRecord;
}

/** The entry for one rendered source: unchanged, changed, flagged (another hash with a problem flag), unreachable. */
export function entryFor(
  source: FreshnessSource,
  rendered: { ok: boolean; flags?: string[] } | undefined,
  sha256: string | null,
  checkedOn: string,
): Entry {
  const ok = Boolean(rendered?.ok) && sha256 !== null;
  const flags = flagCodes(rendered?.flags, ok);
  const base = {
    sourceId: source.sourceId,
    layer: source.layer,
    manifestSha256: source.manifestSha256,
    checkedOn,
  };
  if (!ok) return { ...base, sha256: null, result: 'unreachable', flags };
  if (sha256 === source.manifestSha256) return { ...base, sha256, result: 'unchanged', flags };
  const problem = flags.some((flag) => PROBLEM_FLAGS.has(flag));
  return { ...base, sha256, result: problem ? 'flagged' : 'changed', flags };
}

export interface FreshnessOptions {
  date?: string;
  only?: string[];
  concurrency?: number;
  /** Stands in for the capture script (tests). */
  render?: Renderer;
}

/** Runs `fn` over `items` with at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function runFreshness(env: Env, options: FreshnessOptions = {}): Promise<number> {
  const where = ['CI', 'RENDER'].filter((name) => env.env[name]);
  if (where.length) {
    env.log(`freshness fetches live issuer pages; refused where ${where.join(' and ')} is set.`);
    return 1;
  }
  const date = options.date ?? env.now().toISOString().slice(0, 10);
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new Error(`--date must be YYYY-MM-DD: ${date}`);
  const plan = await freshnessPlan(env.root);
  const byId = new Map(plan.sources.map((source) => [source.sourceId, source]));
  const unknown = (options.only ?? []).filter((id) => !byId.has(id));
  if (unknown.length) {
    env.log(`Not a source the catalog cites: ${unknown.join(', ')}`);
    return 2;
  }
  const existing = await readFreshnessRecord(env.root, date);
  const kept = new Map((existing?.sources ?? []).map((entry) => [entry.sourceId, entry]));
  // --only re-checks exactly those; otherwise resume: sources not in today's record, unreachable there, or whose
  // manifest hash moved since.
  const todo = options.only
    ? options.only.map((id) => byId.get(id)!)
    : plan.sources.filter((source) => {
        const entry = kept.get(source.sourceId);
        return !entry || entry.result === 'unreachable' || entry.manifestSha256 !== source.manifestSha256;
      });
  const captureScriptSha256 = await fileSha256(join(env.root, CAPTURE_SCRIPT));
  if (!captureScriptSha256) throw new Error(`${CAPTURE_SCRIPT} is missing.`);
  let renderer = existing?.renderer.captureScriptSha256 === captureScriptSha256 ? existing.renderer : null;
  const render = options.render ?? captureScriptRenderer(env.root);
  const order = new Map(plan.sources.map((source, i) => [source.sourceId, i]));

  const write = async () => {
    const sources = [...kept.values()].sort(
      (a, b) =>
        (order.get(a.sourceId) ?? Infinity) - (order.get(b.sourceId) ?? Infinity) ||
        a.sourceId.localeCompare(b.sourceId),
    );
    const record = freshnessRecordSchema.parse({
      schemaVersion: 1,
      checkedOn: date,
      catalogVersion: plan.version,
      renderer: renderer ?? { captureScriptSha256, playwright: null, chromium: null },
      counts: freshnessCounts(sources),
      sources,
    });
    await writeJsonAtomic(freshnessPath(env.root, date), record);
    return record as FreshnessRecord;
  };

  const hosts = new Map<string, FreshnessSource[]>();
  for (const source of todo) {
    const host = new URL(source.url).host;
    hosts.set(host, [...(hosts.get(host) ?? []), source]);
  }
  env.log(
    `freshness ${date}: checking ${todo.length} of ${plan.sources.length} cited sources on ${hosts.size} hosts`,
  );
  // Writes are serialized so concurrent hosts never interleave a record write.
  let writing = Promise.resolve<unknown>(null);
  await pool([...hosts.values()], options.concurrency ?? 4, async (group) => {
    const dir = await mkdtemp(join(tmpdir(), 'pipeline-freshness-'));
    try {
      const hints = Object.fromEntries(
        group.filter((source) => source.hint !== undefined).map((source) => [source.sourceId, source.hint]),
      );
      const result = await render({
        dir,
        sources: group.map((source) => ({ id: source.sourceId, url: source.url, kind: source.kind })),
        hints,
      }).catch(() => ({ report: [], renderer: null }) as RenderResult);
      if (result.renderer && !renderer)
        renderer = {
          captureScriptSha256,
          playwright: result.renderer.playwright ?? null,
          chromium: result.renderer.chromium ?? null,
        };
      const rows = new Map(result.report.map((row) => [row.id, row]));
      for (const source of group) {
        const row = rows.get(source.sourceId);
        let sha: string | null = null;
        if (row?.ok) {
          const text = await readFile(join(dir, 'captures', `${source.sourceId}.txt`), 'utf8').catch(
            () => null,
          );
          sha = text === null ? null : sha256Hex(text);
        }
        kept.set(source.sourceId, entryFor(source, row, sha, date));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    writing = writing.then(write);
    await writing;
  });
  const record = await write();
  env.log(freshnessSummary(record, plan));
  return 0;
}

/** Counts per layer and result, changed sources' cards per issuer, and the sources needing a decision. No page text. */
export function freshnessSummary(record: FreshnessRecord, plan: Pick<FreshnessPlan, 'cards'>): string {
  const lines = [
    `freshness ${record.checkedOn} (${record.catalogVersion}): ${FRESHNESS_RESULTS.map((r) => `${r} ${record.counts[r]}`).join(', ')}`,
  ];
  const layers = [...new Set(record.sources.map((entry) => entry.layer))];
  lines.push(`  ${'layer'.padEnd(16)}${FRESHNESS_RESULTS.map((r) => r.padStart(13)).join('')}`);
  for (const layer of layers)
    lines.push(
      `  ${layer.padEnd(16)}${FRESHNESS_RESULTS.map((r) =>
        String(record.sources.filter((e) => e.layer === layer && e.result === r).length).padStart(13),
      ).join('')}`,
    );
  const changed = new Set(record.sources.filter((e) => e.result === 'changed').map((e) => e.sourceId));
  const issuers = new Map<string, string[]>();
  for (const card of plan.cards)
    if (card.sourceIds.some((id) => changed.has(id)))
      issuers.set(card.issuer, [...(issuers.get(card.issuer) ?? []), card.cardId]);
  lines.push(`  cards with a changed source: ${[...issuers.values()].flat().length}`);
  for (const [issuer, cards] of [...issuers].sort(([a], [b]) => a.localeCompare(b)))
    lines.push(
      `    ${issuer} (${cards.length}): ${cards.join(', ')}\n      npm run pipeline -- init ${slugify(issuer)}-refresh-${record.checkedOn.slice(0, 7)} --issuer "${issuer}" --refresh-from-freshness ${record.checkedOn}`,
    );
  for (const result of ['flagged', 'unreachable'] as const) {
    const ids = record.sources
      .filter((e) => e.result === result)
      .map((e) => `${e.sourceId} [${e.flags.join(',')}]`);
    if (ids.length)
      lines.push(`  ${result} (decide: resolve, drop the source or hold the card out): ${ids.join(', ')}`);
  }
  lines.push(`  record: ${FRESHNESS_DIR}/${record.checkedOn}.json`);
  return lines.join('\n');
}

/** The newest committed freshness record, or null. */
export async function newestFreshnessRecord(root: string): Promise<FreshnessRecord | null> {
  const records = (await loadFreshnessRecords(root)) as FreshnessRecord[];
  return records.at(-1) ?? null;
}
