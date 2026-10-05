// `pipeline handoff`: prints (markdown, stdout) what the session and Evan need once a batch is through eval: the PR
// checklist, the build report summary, migrations, review-app readiness, the capture folders Evan selects and his
// publish steps (wiki/ops/catalog-release.md). It writes nothing, and the CLI has no publish, push or sign-in command.
import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { deriveBatch } from './derive.ts';
import type { BatchView } from './derive.ts';
import { listBatches, loadBatch } from './files.ts';
import { fileSha256 } from './hash.ts';
import { EVAL_FILE } from './eval.ts';
import { openPacketStatus } from './packets.ts';
import { PROPOSED_CONFIG, PROPOSED_DIR } from './run.ts';
import type { Env } from './run.ts';
import { CARD_STAGES } from './state.ts';
import { freshnessRecordSchema } from '../../../scripts/lib/freshness.mjs';

export const REVIEW_MANIFEST_MODULE = 'apps/review/src/manifest.ts';
export const BATCHES_CONFIG = 'evals/curation/catalog-batches.json';
export const LEDGER = 'evals/curation/rule-id-ledger.json';

export interface ManifestSource {
  id: string;
  sha256: string;
  capturedOn?: string;
  checkedOn?: string;
}
/** A manifest the review app bundles (repository-relative path), in import order. */
export interface ReviewManifest {
  path: string;
  sources: ManifestSource[];
}
/** A source the catalog cites, with the SHA-256 and directory of the layer manifest the build took it from. */
export interface CitedSource {
  id: string;
  sha256: string | null;
  dir: string | null;
  /** The catalog source's checkedOn: the review app requires the capture of this date when a manifest has one. */
  checkedOn?: string;
}
export interface PaymentPathChange {
  cardId: string;
  category: string;
  ruleIds: string[];
  before: string[];
  after: string[];
}
export interface CatalogSummary {
  version: string;
  verifiedAt: string;
  expiresAt: string;
  oldestSourceDate: string;
  cards: number;
  rules: number;
  sources: number;
  jsonBytes: number;
  budgetBytes: number;
  layers: { id: string; kind: string; dir: string; cards: number; replaced: number }[];
  /** Real cards a batch replaced, and their categories whose excluded payment paths differ from release 1. */
  replacedReal: string[];
  paymentPathChanges: PaymentPathChange[];
  heldOut: { cardId: string; layer: string; reason: string }[];
  dropped: { cardId: string; layer: string; reason: string }[];
  continuity: {
    previous: { version: string; rules: number; jsonBytes: number } | null;
    kept: string[];
    changed: { cardId: string; from: string; to: string }[];
    added: string[];
    dropped: string[];
  };
  cited: CitedSource[];
}

export interface HandoffDeps {
  /** The catalog the committed build config (or a proposed build's config) builds now, or throws with its problems. */
  catalog: (root: string, configPath?: string) => Promise<CatalogSummary>;
  reviewManifests: (root: string) => Promise<ReviewManifest[]>;
  /** stdout of a git command in the root, or null when it fails. */
  git: (root: string, args: string[]) => Promise<string | null>;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// ---- Review-app readiness -------------------------------------------------------------------------------------

export interface ReviewReadiness {
  ok: boolean;
  /** Cited sources no bundled manifest has: the review app cannot match their captures. */
  missing: string[];
  /** Cited sources whose catalog hash is none of the hashes the bundled manifests record for them. */
  differs: { id: string; expected: string; review: string[] }[];
}

/**
 * Whether the hosted review app can match every source the catalog cites. The review app keeps every capture the
 * manifests `apps/review/src/manifest.ts` bundles record for a source ID; a loaded capture must be the one dated the
 * source's checkedOn when a manifest has that date, otherwise the newest-dated capture. A cited source with no bundled
 * hash, or whose hash is not among the captures its date selects, is missing or differs.
 */
export function reviewAppReadiness(cited: CitedSource[], manifests: ReviewManifest[]): ReviewReadiness {
  const known = new Map<string, ManifestSource[]>();
  for (const manifest of manifests)
    for (const source of manifest.sources) known.set(source.id, [...(known.get(source.id) ?? []), source]);
  const missing: string[] = [];
  const differs: ReviewReadiness['differs'] = [];
  for (const source of [...cited].sort((a, b) => a.id.localeCompare(b.id))) {
    const captures = known.get(source.id);
    if (!captures) {
      missing.push(source.id);
      continue;
    }
    const dated = captures.filter(
      (capture) => source.checkedOn && [capture.capturedOn, capture.checkedOn].includes(source.checkedOn),
    );
    // No capture of that date: only the newest-dated capture (as the review app does).
    const latest = (capture: ManifestSource) =>
      [capture.capturedOn ?? '', capture.checkedOn ?? ''].sort().at(-1)!;
    const newest = captures.map(latest).sort().at(-1)!;
    const selected = dated.length ? dated : captures.filter((capture) => latest(capture) === newest);
    if (source.sha256 && !selected.some((capture) => capture.sha256 === source.sha256))
      differs.push({
        id: source.id,
        expected: source.sha256,
        review: selected.map((capture) => capture.sha256),
      });
  }
  return { ok: !missing.length && !differs.length, missing, differs };
}

/**
 * The manifests the review app bundles, in its order: the JSON imports of apps/review/src/manifest.ts, then the
 * batch manifests its `import.meta.glob` matches, sorted by path, then the freshness records its second glob matches
 * (sorted by path; each page found unchanged is a capture of its hash dated the record's day, as the review app's
 * `parseFreshnessRecords`). Throws when any is missing, so a rewrite of its imports fails loudly here.
 */
export async function readReviewManifests(root: string): Promise<ReviewManifest[]> {
  const module = join(root, REVIEW_MANIFEST_MODULE);
  const text = await readFile(module, 'utf8');
  const paths = [...text.matchAll(/^import \w+ from '([^']+\.json)';$/gm)].map((match) =>
    resolve(dirname(module), match[1]),
  );
  const globs = [...text.matchAll(/import\.meta\.glob(?:<\w+>)?\('([^'*]+)\/\*\/manifest\.json'/g)];
  const freshnessGlobs = [...text.matchAll(/import\.meta\.glob(?:<\w+>)?\('([^'*]+)\/\*\.json'/g)];
  if (!paths.length || globs.length !== 1 || freshnessGlobs.length !== 1)
    throw new Error(
      `${REVIEW_MANIFEST_MODULE}: expected JSON imports, one batch-manifest glob and one freshness-record glob`,
    );
  const batches = resolve(dirname(module), globs[0][1]);
  const dirs = (await readdir(batches, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  for (const dir of dirs.map((entry) => join(batches, entry.name, 'manifest.json')).sort())
    if (await exists(dir)) paths.push(dir);
  const out: ReviewManifest[] = [];
  for (const path of paths) {
    const data = JSON.parse(await readFile(path, 'utf8')) as { sources?: ManifestSource[] };
    // The review app skips a manifest without sources; so does this check.
    if (Array.isArray(data.sources)) out.push({ path: relative(root, path), sources: data.sources });
  }
  const freshnessDir = resolve(dirname(module), freshnessGlobs[0][1]);
  const records = (await readdir(freshnessDir).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of records) {
    const parsed = freshnessRecordSchema.safeParse(
      JSON.parse(await readFile(join(freshnessDir, name), 'utf8')),
    );
    if (!parsed.success) continue; // the review app skips a malformed record too
    out.push({
      path: relative(root, join(freshnessDir, name)),
      sources: parsed.data.sources.flatMap((entry) =>
        entry.sha256 && entry.result === 'unchanged'
          ? [{ id: entry.sourceId, sha256: entry.sha256, checkedOn: entry.checkedOn }]
          : [],
      ),
    });
  }
  return out;
}

// ---- Capture folders --------------------------------------------------------------------------------------------

/** `<dir>/manifest.json` → `<dir>/captures`, `<dir>/<p>-manifest.json` → `<dir>/<p>-captures`. */
const captureDirOf = (manifestPath: string) =>
  join(dirname(manifestPath), basename(manifestPath).replace(/manifest\.json$/, 'captures'));

export interface CaptureFolder {
  folder: string;
  absolute: string;
  needed: number;
  present: number;
  matching: number;
}

/** The folders Evan selects in the review app: one per manifest the cited sources' hashes come from. */
export async function captureFolders(
  root: string,
  cited: CitedSource[],
  manifests: ReviewManifest[],
): Promise<{ folders: CaptureFolder[]; unplaced: string[] }> {
  const reviewPath = new Map<string, string>();
  for (const manifest of manifests)
    for (const source of manifest.sources) reviewPath.set(source.id, manifest.path);
  const byFolder = new Map<string, CitedSource[]>();
  const unplaced: string[] = [];
  for (const source of cited) {
    const folder = source.dir
      ? join(source.dir, 'captures')
      : reviewPath.has(source.id)
        ? captureDirOf(reviewPath.get(source.id)!)
        : null;
    if (!folder) unplaced.push(source.id);
    else byFolder.set(folder, [...(byFolder.get(folder) ?? []), source]);
  }
  const folders: CaptureFolder[] = [];
  for (const [folder, sources] of [...byFolder].sort((a, b) => a[0].localeCompare(b[0]))) {
    let present = 0;
    let matching = 0;
    for (const source of sources) {
      const sha = await fileSha256(join(root, folder, `${source.id}.txt`));
      if (sha) present++;
      if (sha && (!source.sha256 || sha === source.sha256)) matching++;
    }
    folders.push({ folder, absolute: join(root, folder), needed: sources.length, present, matching });
  }
  return { folders, unplaced: unplaced.sort() };
}

// ---- Batch readiness ----------------------------------------------------------------------------------------------

/** Why a batch is not ready to hand off (empty when it is), and what this checkout cannot re-check. */
export async function batchProblems(
  view: BatchView,
  configLayers: string[],
): Promise<{ problems: string[]; warnings: string[] }> {
  const { batch } = view;
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const [issuer, derived] of Object.entries(view.research))
    if (derived.status !== 'done') problems.push(`research ${issuer}: ${derived.status}`);
  for (const card of view.cards) {
    const state = batch.state.cards[card.cardId];
    if (state?.dropped || state?.heldOut) continue;
    for (const stage of CARD_STAGES) {
      if (stage === 'freshness') continue;
      const derived = card.stages[stage];
      if (derived.status === 'done') continue;
      // Recorded done, but a gitignored input (trace, capture) is not here, so the hash cannot be re-checked.
      if (derived.status === 'inputs-missing' && derived.record?.status === 'done') {
        warnings.push(`card ${card.cardId}: ${stage} recorded done; its inputs are not on this machine`);
        continue;
      }
      problems.push(`card ${card.cardId}: ${stage} ${derived.status}`);
      break;
    }
  }
  // Accepted and released packets stay in pipeline/packets as the run record; only open (or unreadable) ones block.
  const open = await openPacketStatus(batch);
  if (open.length) problems.push(`open packets: ${open.map((entry) => entry.file).join(', ')}`);
  if (view.build.status !== 'done') problems.push(`build: ${view.build.status}`);
  if (view.eval.status !== 'done') problems.push(`eval: ${view.eval.status}`);
  else {
    const recorded = view.eval.record?.outputs?.find((output) => output.ref === `file:${EVAL_FILE}`)?.sha256;
    const now = await fileSha256(join(batch.dir, EVAL_FILE));
    if (!now) problems.push(`eval: ${batch.rel}/${EVAL_FILE} is missing; run eval`);
    else if (recorded !== now)
      problems.push(`eval: ${batch.rel}/${EVAL_FILE} differs from the recorded eval`);
  }
  if (!configLayers.includes(batch.id))
    problems.push(`build config: ${BATCHES_CONFIG} has no layer { "kind": "batch", "id": "${batch.id}" }`);
  return { problems, warnings };
}

// ---- Rendering ----------------------------------------------------------------------------------------------------

const n = (value: number) => value.toLocaleString('en-US');
const code = (value: string) => `\`${value}\``;
const LIST_LIMIT = 50;
const idList = (ids: string[]) =>
  ids.length > LIST_LIMIT
    ? `${ids.slice(0, LIST_LIMIT).map(code).join(', ')} … and ${ids.length - LIST_LIMIT} more`
    : ids.map(code).join(', ');

/** The rule-ID continuity summary of the build (kept, changed old → new, added, dropped). */
export function renderRuleIds(continuity: CatalogSummary['continuity']): string {
  const lines = [
    continuity.previous
      ? `Against ${code(continuity.previous.version)} (${continuity.previous.rules} rules, ${n(continuity.previous.jsonBytes)} bytes):`
      : 'No previous catalog in the ledger: every rule ID counts as added.',
    `- kept ${continuity.kept.length}, changed ${continuity.changed.length}, added ${continuity.added.length}, dropped ${continuity.dropped.length}`,
  ];
  for (const item of continuity.changed)
    lines.push(`- changed ${code(item.cardId)}: ${code(item.from)} → ${code(item.to)}`);
  if (continuity.added.length) lines.push(`- added: ${idList(continuity.added)}`);
  if (continuity.dropped.length) lines.push(`- dropped: ${idList(continuity.dropped)}`);
  return lines.join('\n');
}

const PR_CHECKS = [
  'npm run lint',
  'npm run format:check',
  'npm run typecheck',
  'npm test',
  'npm audit --audit-level=high',
  'npm run catalog:v3:check',
  'npm run catalog:v2:check',
  'npm run eval:v2 -- --check',
  'node scripts/expansion-pipeline-metrics.mjs --check',
];

export interface HandoffReport {
  text: string;
  problems: string[];
}

export async function handoffReport(
  env: Env,
  batchId: string | undefined,
  deps: HandoffDeps,
): Promise<HandoffReport> {
  const root = env.root;
  const problems: string[] = [];
  const lines: string[] = [];
  const out = (...more: string[]) => lines.push(...more);

  const ids = batchId ? [batchId] : await listBatches(root);
  if (ids.length > 1) {
    problems.push(`${ids.length} batches: pass --batch`);
    return { text: `# Handoff\n\nPass --batch (${ids.join(', ')}).`, problems };
  }
  const view = ids.length ? await deriveBatch(await loadBatch(root, ids[0]), env.now()) : null;
  const branch = (await deps.git(root, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? 'unknown';
  out(`# Handoff: ${view ? view.batch.id : 'no pipeline batch'}`, '');
  if (!view) {
    problems.push(`no pipeline batch under evals/curation/batches: nothing to hand off`);
    out(
      'No pipeline batch exists, so there is nothing to hand off. The sections below describe the catalog the committed build config builds now.',
      '',
    );
  }

  // After `run build --proposed` the batch is a layer of its would-be config only, and nothing ships.
  const proposed =
    view?.build.status === 'done' && view.build.record?.proposed
      ? { config: `${view.batch.rel}/${PROPOSED_CONFIG}`, version: view.build.record.catalogVersion }
      : null;
  let configLayers: string[] = [];
  try {
    const config = JSON.parse(await readFile(join(root, proposed?.config ?? BATCHES_CONFIG), 'utf8')) as {
      layers: { id: string; kind: string }[];
    };
    configLayers = config.layers.filter((layer) => layer.kind === 'batch').map((layer) => layer.id);
  } catch {
    problems.push(`build config: ${proposed?.config ?? BATCHES_CONFIG} is missing or unreadable`);
  }
  const warnings: string[] = [];
  if (view) {
    const checked = await batchProblems(view, configLayers);
    problems.push(...checked.problems);
    warnings.push(...checked.warnings);
    const evalResult = await readFile(join(view.batch.dir, EVAL_FILE), 'utf8')
      .then((text) => JSON.parse(text) as { traces?: { status?: string } })
      .catch(() => null);
    if (evalResult?.traces?.status === 'inputs-missing')
      warnings.push(
        'eval: the trace re-score is inputs-missing; run eval again in the checkout that holds the captures and traces',
      );
  }

  let catalog: CatalogSummary | null = null;
  try {
    catalog = await deps.catalog(root, proposed?.config);
  } catch (error) {
    problems.push(`build: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Version reuse: a version already on origin/main with other contents would reuse a released label.
  if (catalog) {
    type Ledger = { catalogs: { version: string; jsonBytes: number; ruleIds: string[] }[] };
    const entryOf = (text: string | null) =>
      text
        ? (JSON.parse(text) as Ledger).catalogs.find((entry) => entry.version === catalog!.version)
        : undefined;
    const onMain = entryOf(await deps.git(root, ['show', `origin/main:${LEDGER}`]));
    const here = entryOf(await readFile(join(root, LEDGER), 'utf8').catch(() => null));
    if (
      onMain &&
      here &&
      (onMain.jsonBytes !== here.jsonBytes || onMain.ruleIds.join() !== here.ruleIds.join())
    )
      problems.push(
        `version: ${catalog.version} is on origin/main with other contents; bump "version" in ${BATCHES_CONFIG} and rebuild`,
      );
  }

  // 1. PR checklist.
  const manifests = await deps.reviewManifests(root).catch(() => [] as ReviewManifest[]);
  const capture = catalog
    ? await captureFolders(root, catalog.cited, manifests)
    : { folders: [], unplaced: [] };
  const quoteDir = view ? view.batch.rel : 'evals/curation/expansion';
  out(
    '## PR checklist',
    '',
    `- Branch: ${code(branch)} (one branch and one PR per batch, cut from the latest main). The session opens the PR; the coordinator merges it under Evan's standing authorization.`,
    ...PR_CHECKS.map((command) => `- [ ] ${code(command)}`),
    `- [ ] ${code(
      `node scripts/check-expansion-quotes.mjs --dir ${quoteDir}${capture.folders.map((folder) => ` --captures ${folder.absolute}`).join('')}`,
    )} (needs the captures)`,
    `- [ ] ${code('python3 scripts/lint_wiki.py')}`,
    `- [ ] Wiki: ${code('wiki/now.md')}, ${code('wiki/log.md')}, ${code('wiki/system/catalog-expansion.md')} (catalog facts), ${code('wiki/ops/catalog-release.md')} (release facts), ${code('docs/evals/')} if the eval numbers are published, a ${code('wiki/decisions/')} record for any non-obvious choice`,
    '- [ ] An independent reviewer subagent reviews the branch before merge (record it as agent-verified).',
    '',
  );

  // 2. Build report summary.
  out('## Build report summary', '');
  if (proposed)
    out(
      `**Proposed build: nothing ships.** Version ${code(proposed.version ?? 'unknown')} is built into ${code(`${view!.batch.rel}/${PROPOSED_DIR}`)} from ${code(proposed.config)}; ${code(BATCHES_CONFIG)}, ${code(LEDGER)} and ${code('CATALOG_V3')} are unchanged. To ship the batch, run ${code(`npm run pipeline -- run build --batch ${view!.batch.id} --version <new version>`)} in a PR Evan approves.`,
      '',
    );
  if (!catalog) out('The catalog does not build; see the problems below.', '');
  else {
    out(
      `- Version ${code(catalog.version)}, verifiedAt ${catalog.verifiedAt}, expiresAt ${catalog.expiresAt}; oldest issuer source date ${catalog.oldestSourceDate}.`,
      `- ${catalog.cards} cards, ${catalog.rules} rules, ${catalog.sources} sources; ${n(catalog.jsonBytes)} bytes JSON of a ${n(catalog.budgetBytes)}-byte budget (${((catalog.jsonBytes / catalog.budgetBytes) * 100).toFixed(1)}%).`,
      `- Layers: ${catalog.layers.map((layer) => `${code(layer.id)} (${layer.kind}, ${layer.cards} cards used, ${layer.replaced} replaced later)`).join(', ')}.`,
      ...(catalog.replacedReal.length
        ? [
            `- Real cards refreshed by a batch (release-1 names and rule-ID prefixes; not checked against release 1): ${catalog.replacedReal.map(code).join(', ')}. Excluded payment paths that differ from release 1: ${catalog.paymentPathChanges.length ? '' : 'none.'}`,
            ...catalog.paymentPathChanges.map(
              (c) =>
                `  - ${code(c.cardId)} ${c.category} (${c.ruleIds.map(code).join(', ') || 'no rule'}): ${c.before.join(', ') || 'none'} → ${c.after.join(', ') || 'none'}`,
            ),
          ]
        : []),
      `- Held out by the overlay: ${catalog.heldOut.length}${catalog.heldOut.length ? '' : '.'}`,
      ...catalog.heldOut.map((item) => `  - ${code(item.cardId)} (${item.layer}): ${item.reason}`),
      `- Dropped: ${catalog.dropped.length}${catalog.dropped.length ? '' : '.'}`,
      ...catalog.dropped.map((item) => `  - ${code(item.cardId)} (${item.layer}): ${item.reason}`),
      '',
    );
    if (view) {
      const { batch } = view;
      const heldOut = [...batch.overlay.entries()].filter(
        ([, entry]) => (entry as { heldOut?: unknown }).heldOut,
      );
      const dropped = Object.entries(batch.state.cards).filter(([, state]) => state.dropped);
      out(
        `This batch: ${batch.cards.length} researched, ${batch.corpus.size} in its corpus, ${batch.corpus.size - heldOut.length} included, ${heldOut.length} held out, ${dropped.length} dropped${dropped.length ? ` (${dropped.map(([id, state]) => `${code(id)} ${state.dropped}`).join(', ')})` : ''}.`,
        '',
      );
    }
    out('Rule IDs:', '', renderRuleIds(catalog.continuity), '');
  }

  // 3. Migrations.
  const added = (
    await deps.git(root, [
      'diff',
      '--name-only',
      '--diff-filter=A',
      'origin/main...HEAD',
      '--',
      'supabase/migrations',
    ])
  )?.trim();
  const untracked = (
    await deps.git(root, ['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations'])
  )?.trim();
  const migrations = [...(added ? added.split('\n') : []), ...(untracked ? untracked.split('\n') : [])];
  out(
    '## Migrations',
    '',
    added === undefined
      ? 'Could not compare with origin/main (git failed); check supabase/migrations by hand.'
      : migrations.length
        ? `New on this branch (Evan or the authorized coordinator runs ${code('./scripts/db-push.sh')} before publishing): ${migrations.map(code).join(', ')}`
        : 'None: no new file under supabase/migrations against origin/main.',
    '',
  );

  // 4. Review-app readiness.
  out('## Review-app readiness', '');
  if (!catalog) out('Not checked: the catalog does not build.', '');
  else {
    const readiness = reviewAppReadiness(catalog.cited, manifests);
    out(
      `The review app knows capture hashes only from the manifests ${code(REVIEW_MANIFEST_MODULE)} bundles at build time (the fixed corpora and every ${code('evals/curation/batches/*/manifest.json')}): ${manifests.map((m) => code(m.path)).join(', ') || 'none found'}. The hosted app knows a new batch's manifest only once this branch is merged and Render has deployed main, so Evan publishes after that deploy.`,
      '',
    );
    if (readiness.ok)
      out(
        `Every one of the ${catalog.cited.length} cited sources has its SHA-256 in a bundled manifest.`,
        '',
      );
    else {
      out(
        `**Publish blocked:** ${readiness.missing.length} cited source(s) are in no bundled manifest, ${readiness.differs.length} have none of the bundled hashes their date selects. Every cited capture's SHA-256 must be in a committed manifest the review app bundles before Evan can publish.`,
      );
      if (readiness.missing.length) out(`- missing: ${idList(readiness.missing)}`);
      for (const item of readiness.differs)
        out(
          `- differs: ${code(item.id)} catalog ${item.expected.slice(0, 12)}…, review app ${item.review.map((hash) => `${hash.slice(0, 12)}…`).join(', ')}`,
        );
      out('');
    }
  }

  // 5. Capture folders.
  out('## Capture folders Evan selects', '');
  if (!capture.folders.length) out('None computed.', '');
  for (const folder of capture.folders)
    out(
      `- ${code(folder.absolute)}: ${folder.needed} cited source(s); in this checkout ${folder.present} present, ${folder.matching} matching the manifest${folder.present ? '' : ' (the captures live in the checkout that captured them; select that folder)'}`,
    );
  if (capture.unplaced.length) out(`- no folder known for: ${idList(capture.unplaced)}`);
  out('');

  // 6. Publish steps.
  out(
    '## Publish (Evan, in the hosted review app)',
    '',
    `Release ${catalog ? `${code(catalog.version)}, expires ${catalog.expiresAt}` : '(not built)'}. Follow ${code('wiki/ops/catalog-release.md')} (assisted flow):`,
    '',
    '1. Coordinator: before Evan starts, check `/health`, `/v1/catalog` and that Render serves the merged main (the review app offers this catalog).',
    '2. Evan signs in at https://ai-checkout-api.onrender.com/review/ (the agent never types the password).',
    '3. Coordinator starts a new draft from the bundled catalog and opens **Capture all missing sources**.',
    '4. Evan selects the capture folders above in the file picker; the coordinator runs the capture and checks every source reads "Matching evidence captured".',
    "5. Coordinator verifies the draft's canonical JSON SHA-256 equals the catalog on main and writes the review note: agent-verified, not human-verified, and what was checked.",
    '6. Evan ticks the attestation himself and clicks **Publish reviewed terms**, then **Publish release**.',
    '7. Coordinator checks `/v1/catalog` serves the new release and updates the wiki.',
    '',
    'The CLI has no publish, push or sign-in command. Evan ticks the attestation and clicks Publish. Labels are agent-verified, not human-verified.',
    '',
  );

  out('## Ready', '');
  if (warnings.length) out('Warnings:', ...warnings.map((warning) => `- ${warning}`), '');
  if (problems.length) out('Not ready:', ...problems.map((problem) => `- ${problem}`));
  else
    out(
      proposed
        ? 'Ready: open the PR with the checklist above (the batch data and its proposed build; nothing ships).'
        : 'Ready: open the PR with the checklist above.',
    );
  return { text: lines.join('\n'), problems };
}

// ---- Real dependencies --------------------------------------------------------------------------------------------

const scriptLib = (name: string) => new URL(`../../../scripts/lib/${name}`, import.meta.url).href;

interface Layer {
  id: string;
  kind: string;
  dir: string;
  corpus: { cases: { cardId: string }[] };
  manifest: { sources: { id: string; sha256: string; capturedOn: string; checkedOn?: string }[] };
}
interface CatalogLibs {
  loadCatalogBatches: (root: string, path?: string) => Promise<{ layers: Layer[]; freshness: unknown[] }>;
  mergeLayers: (loaded: unknown) => {
    version: string;
    overlay: { cards: { cardId: string; heldOut: string | null }[] };
    dropped: { cardId: string; layer: string; reason: string }[];
    layers: { id: string; kind: string; dir: string; cards: number; replaced: string[] }[];
    replacedReal: string[];
  };
  effectiveSources: (
    layers: Layer[],
    freshness: unknown[],
  ) => Map<string, { source: { sha256: string }; layer: string }>;
}
interface CatalogV3Libs {
  buildRelease: (inputs: unknown) => {
    catalog: {
      version: string;
      verifiedAt: string;
      expiresAt: string;
      sources: { id: string; checkedOn: string }[];
    };
    dates: { oldest: string };
    continuity: CatalogSummary['continuity'];
  };
  realPaymentPathChanges: (catalog: unknown, catalogV2: unknown, replaced: string[]) => PaymentPathChange[];
  catalogStats: (catalog: unknown) => { cards: number; rules: number; sources: number };
  jsonBytes: (value: unknown) => number;
  CATALOG_V3_BYTE_BUDGET: number;
}

/** The catalog a build config (default the committed one) builds now, through milestone 1's builder (nothing is written). */
export async function buildCatalogSummary(
  root: string,
  configPath = BATCHES_CONFIG,
): Promise<CatalogSummary> {
  const batches = (await import(scriptLib('catalog-batches.mjs'))) as CatalogLibs;
  const v3 = (await import(scriptLib('catalog-v3.mjs'))) as CatalogV3Libs;
  const loaded = await batches.loadCatalogBatches(root, configPath);
  const merged = batches.mergeLayers(loaded);
  const ledger = (await exists(join(root, LEDGER)))
    ? JSON.parse(await readFile(join(root, LEDGER), 'utf8'))
    : undefined;
  const { catalog, dates, continuity } = v3.buildRelease({ ...merged, ledger });
  const stats = v3.catalogStats(catalog);
  const { CATALOG_V2 } = (await import(
    new URL('../../../packages/rewards-core/src/catalog-v2.ts', import.meta.url).href
  )) as { CATALOG_V2: unknown };
  // The manifest each source's hash comes from, as mergeLayers picks it (a later, newer capture or check wins).
  const dirs = new Map(loaded.layers.map((layer) => [layer.id, layer.dir]));
  const winner = new Map(
    [...batches.effectiveSources(loaded.layers, loaded.freshness)].map(([id, { source, layer }]) => [
      id,
      { sha256: source.sha256, dir: dirs.get(layer)! },
    ]),
  );
  const layerOf = (cardId: string) =>
    [...loaded.layers].reverse().find((layer) => layer.corpus.cases.some((item) => item.cardId === cardId))
      ?.id ?? 'unknown';
  return {
    version: catalog.version,
    verifiedAt: catalog.verifiedAt,
    expiresAt: catalog.expiresAt,
    oldestSourceDate: dates.oldest,
    cards: stats.cards,
    rules: stats.rules,
    sources: stats.sources,
    jsonBytes: v3.jsonBytes(catalog),
    budgetBytes: v3.CATALOG_V3_BYTE_BUDGET,
    layers: merged.layers.map((layer) => ({ ...layer, replaced: layer.replaced.length })),
    replacedReal: merged.replacedReal,
    paymentPathChanges: v3.realPaymentPathChanges(catalog, CATALOG_V2, merged.replacedReal),
    heldOut: merged.overlay.cards
      .filter((entry) => entry.heldOut)
      .map((entry) => ({ cardId: entry.cardId, layer: layerOf(entry.cardId), reason: entry.heldOut! })),
    dropped: merged.dropped,
    continuity,
    cited: catalog.sources.map((source) => {
      const entry = winner.get(source.id);
      return {
        id: source.id,
        sha256: entry?.sha256 ?? null,
        dir: entry?.dir ?? null,
        checkedOn: source.checkedOn,
      };
    }),
  };
}

export const defaultDeps: HandoffDeps = {
  catalog: buildCatalogSummary,
  reviewManifests: readReviewManifests,
  git: (root, args) =>
    new Promise((done) =>
      execFile('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) =>
        done(error ? null : stdout),
      ),
    ),
};

/** `pipeline handoff`: prints the report; exit 1 with the reasons when the batch is not ready. */
export async function handoff(env: Env, batchId?: string, deps: HandoffDeps = defaultDeps): Promise<number> {
  const report = await handoffReport(env, batchId, deps);
  env.log(report.text);
  return report.problems.length ? 1 : 0;
}
