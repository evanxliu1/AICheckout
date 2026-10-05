// `pipeline publish`: the coordinator publishes `CATALOG_V3` through the hosted review API with the session Evan
// logged in (`pipeline login`), only on his chat instruction `publish <version>` (Phase 9 milestone 5,
// wiki/decisions/2026-10-05-agent-publish-cli-session.md, runbook wiki/ops/catalog-release.md).
//
// Without --confirm it is a dry run: every local check (version, git, expiry, every capture against the manifests
// the review app bundles) and read-only remote checks; no POST or PUT. With --confirm <version> --instruction-at
// <time of Evan's message> it uploads the captures, creates or resumes the draft, checks the draft equals
// `CATALOG_V3` (canonical JSON SHA-256) with every source attached once and matching, and publishes with an
// agent-verified review note. It never overwrites a draft someone edited and never rebases onto a moved head.
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  MAX_SOURCE_BODY_CHARS,
  draftSchema,
  reviewQueueSchema,
  reviewSummarySchema,
  sourceDocumentSchema,
} from '@ai-checkout/catalog-review';
import type { ReviewSummary } from '@ai-checkout/catalog-review';
import { publishedReleaseSchema } from '@ai-checkout/rewards-core';
import type { Catalog } from '@ai-checkout/rewards-core';
import { readReviewManifests, selectedCaptures } from './handoff.ts';
import type { ManifestSource, ReviewManifest } from './handoff.ts';
import { jsonSha256, sha256Hex } from './hash.ts';
import type { Env } from './run.ts';
import {
  ApiError,
  CliError,
  LOGIN_COMMAND,
  openSession,
  readSession,
  reviewClient,
  servedCatalog,
} from './session.ts';
import type { ReviewClient, SessionDeps } from './session.ts';

/** Paths whose uncommitted changes would make the checkout differ from the catalog and manifests on main. */
export const CLEAN_PATHS = ['packages/rewards-core', 'evals/curation', 'apps/review/src/manifest.ts'];
export const MAX_RATE_LIMIT_WAITS = 8;
const DEFAULT_RATE_LIMIT_WAIT_MS = 15_000;
const INSTRUCTION_SKEW_MS = 5 * 60_000;
const INSTRUCTION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const PROGRESS_EVERY = 25;
const INSTRUCTION_PLACEHOLDER = '<time of Evan’s chat message>';

export interface PublishDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** stdout of a git command in the root, or null when it fails. */
  git: (root: string, args: string[]) => Promise<string | null>;
  reviewManifests: (root: string) => Promise<ReviewManifest[]>;
  /** The catalog to publish: `CATALOG_V3` of this checkout. */
  catalog: () => Promise<Catalog>;
  sessionPath: string;
  timeoutMs?: number;
}

export interface PublishOptions {
  version?: string;
  captures: string[];
  confirm?: string;
  instructionAt?: string;
  /** The API origin (validated); a session's own API must equal it. */
  api: string;
  /** Skip every network request (git fetch, the session refresh, the API). Dry run only. */
  offline: boolean;
}

// ---- Captures ---------------------------------------------------------------------------------------------------

export interface MatchedCapture {
  text: string;
  sha256: string;
  folder: string;
}
export interface CaptureMatch {
  matched: Map<string, MatchedCapture>;
  /** No folder has `<id>.txt`. */
  missing: string[];
  /** Folders have the file, but none matches a capture the source's date selects. */
  differs: { id: string; folders: string[] }[];
  /** A file exists but no bundled manifest knows the source. */
  unknown: string[];
  /** Longer than MAX_SOURCE_BODY_CHARS, or empty. */
  unusable: { id: string; folder: string; reason: string }[];
  folders: { folder: string; files: number; used: number; exists: boolean }[];
}

/** The text the review app reads from a file: `File.text()` decodes UTF-8 with replacement and drops a leading BOM. */
export const decodeCapture = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/**
 * For every source, `<id>.txt` in the folders (in any order): the file whose SHA-256 (of the UTF-8 encoding of its
 * decoded text, as the database computes content_hash) is a capture the review app accepts for the source's
 * `checkedOn` (`selectedCaptures`, the rule of apps/review/src/manifest.ts).
 */
export async function matchCaptures(
  sources: { id: string; checkedOn: string }[],
  folders: string[],
  manifests: ReviewManifest[],
): Promise<CaptureMatch> {
  const known = new Map<string, ManifestSource[]>();
  for (const manifest of manifests)
    for (const source of manifest.sources) known.set(source.id, [...(known.get(source.id) ?? []), source]);
  const result: CaptureMatch = {
    matched: new Map(),
    missing: [],
    differs: [],
    unknown: [],
    unusable: [],
    folders: [],
  };
  const used = new Map<string, number>();
  for (const folder of folders) {
    const names = await readdir(folder).catch(() => null);
    result.folders.push({
      folder,
      files: names ? names.filter((name) => name.endsWith('.txt')).length : 0,
      used: 0,
      exists: names !== null,
    });
  }
  for (const source of sources) {
    const captures = known.get(source.id);
    const selected = captures ? selectedCaptures(captures, source.checkedOn) : [];
    const present: string[] = [];
    for (const folder of folders) {
      const path = join(folder, `${source.id}.txt`);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) continue;
      present.push(folder);
      if (info.size > MAX_SOURCE_BODY_CHARS * 4) {
        result.unusable.push({ id: source.id, folder, reason: 'file too large to be a capture' });
        continue;
      }
      const text = decodeCapture(await readFile(path));
      if (text.length > MAX_SOURCE_BODY_CHARS || !text.trim()) {
        result.unusable.push({
          id: source.id,
          folder,
          reason: text.trim() ? `longer than ${MAX_SOURCE_BODY_CHARS} characters` : 'empty',
        });
        continue;
      }
      const sha256 = sha256Hex(new TextEncoder().encode(text));
      if (selected.some((capture) => capture.sha256 === sha256)) {
        result.matched.set(source.id, { text, sha256, folder });
        used.set(folder, (used.get(folder) ?? 0) + 1);
        break;
      }
    }
    if (result.matched.has(source.id)) continue;
    if (!present.length) result.missing.push(source.id);
    else if (!captures) result.unknown.push(source.id);
    else result.differs.push({ id: source.id, folders: present });
  }
  for (const entry of result.folders) entry.used = used.get(entry.folder) ?? 0;
  return result;
}

/** `<dir>/manifest.json` → `<dir>/captures`, `<dir>/<p>-manifest.json` → `<dir>/<p>-captures`. */
const captureDirOf = (manifestPath: string) =>
  join(dirname(manifestPath), basename(manifestPath).replace(/manifest\.json$/, 'captures'));

/**
 * Without --captures: the capture folder next to every bundled manifest (not the freshness records) that lists a
 * cited source, in this checkout. Batch captures usually live in another checkout, so pass --captures.
 */
export function defaultCaptureFolders(root: string, ids: string[], manifests: ReviewManifest[]): string[] {
  const cited = new Set(ids);
  return [
    ...new Set(
      manifests
        .filter((manifest) => manifest.path.endsWith('manifest.json'))
        .filter((manifest) => manifest.sources.some((source) => cited.has(source.id)))
        .map((manifest) => join(root, captureDirOf(manifest.path))),
    ),
  ].sort();
}

// ---- Checks -----------------------------------------------------------------------------------------------------

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/** Problems with --version, --confirm and --instruction-at (empty when fine). */
export function instructionProblems(catalog: Catalog, options: PublishOptions, now: Date): string[] {
  const problems: string[] = [];
  if (options.version !== catalog.version)
    problems.push(
      `--version ${options.version} is not CATALOG_V3's version ${catalog.version} in this checkout`,
    );
  if (options.confirm !== undefined && options.confirm !== options.version)
    problems.push(`--confirm ${options.confirm} must equal --version ${options.version} exactly`);
  if (options.confirm !== undefined && options.instructionAt === undefined)
    problems.push('--confirm needs --instruction-at <UTC time of Evan’s chat message "publish <version>">');
  if (options.instructionAt !== undefined) {
    const at = Date.parse(options.instructionAt);
    if (!ISO_UTC.test(options.instructionAt) || Number.isNaN(at))
      problems.push(
        `--instruction-at ${options.instructionAt} is not an ISO-8601 UTC time (YYYY-MM-DDTHH:MM:SSZ)`,
      );
    else if (at > now.getTime() + INSTRUCTION_SKEW_MS)
      problems.push(`--instruction-at ${options.instructionAt} is in the future`);
    else if (at < now.getTime() - INSTRUCTION_MAX_AGE_MS)
      problems.push(
        `--instruction-at ${options.instructionAt} is more than 7 days old; Evan's instruction must be recent`,
      );
  }
  return problems;
}

interface GitState {
  head: string | null;
  originMain: string | null;
  problems: string[];
}

async function gitState(root: string, deps: PublishDeps, offline: boolean): Promise<GitState> {
  const problems: string[] = [];
  if (offline) problems.push('origin/main was not fetched (--offline)');
  else if ((await deps.git(root, ['fetch', 'origin', 'main'])) === null)
    problems.push('git fetch origin main failed; cannot confirm this checkout is origin/main');
  const head = (await deps.git(root, ['rev-parse', 'HEAD']))?.trim() || null;
  const originMain = (await deps.git(root, ['rev-parse', 'origin/main']))?.trim() || null;
  if (!head || !originMain) problems.push('git rev-parse HEAD or origin/main failed');
  else if (head !== originMain)
    problems.push(`HEAD ${head.slice(0, 7)} is not origin/main ${originMain.slice(0, 7)}`);
  const status = await deps.git(root, ['status', '--porcelain', '--', ...CLEAN_PATHS]);
  if (status === null) problems.push('git status failed');
  else if (status.trim())
    problems.push(
      `uncommitted changes under ${CLEAN_PATHS.join(', ')}: ${status
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .join('; ')}`,
    );
  return { head, originMain, problems };
}

/** The review note (10–2000 characters) stating what the coordinator checked. */
export function reviewNote(
  catalog: Catalog,
  catalogSha256: string,
  mainSha: string,
  captures: number,
  instructionAt: string,
): string {
  return (
    `Catalog ${catalog.version} (${catalog.cards.length} cards, ${catalog.sources.length} sources, verified ${catalog.verifiedAt}, expires ${catalog.expiresAt}) is agent-verified, not human-verified. ` +
    `The coding agent checked: the draft's canonical JSON SHA-256 ${catalogSha256} equals CATALOG_V3 on main ${mainSha.slice(0, 7)}; ` +
    `all ${captures} captures match the committed manifest hashes for their dates. ` +
    `Published by the coding agent on Evan's chat instruction of ${instructionAt}.`
  );
}

// ---- Command ----------------------------------------------------------------------------------------------------

export async function publish(env: Env, options: PublishOptions, deps: PublishDeps): Promise<number> {
  const log = env.log;
  const now = env.now();
  const confirmed = options.confirm !== undefined;
  if (!options.version) throw new CliError('publish needs --version <catalog version>.', 2);
  if (confirmed && options.offline) throw new CliError('--offline is for a dry run; drop --confirm.', 2);
  const catalog = await deps.catalog();
  const catalogSha256 = jsonSha256(catalog);
  const problems = instructionProblems(catalog, options, now);

  log(
    `# Publish ${confirmed ? '' : 'dry run '}${options.version}${confirmed ? '' : ' (no POST or PUT is sent)'}`,
  );
  log('');
  log(
    `CATALOG_V3 here: ${catalog.version}, ${catalog.cards.length} cards, ${catalog.sources.length} sources, verified ${catalog.verifiedAt}, expires ${catalog.expiresAt}; canonical JSON SHA-256 ${catalogSha256}.`,
  );
  if (Date.parse(catalog.expiresAt) <= now.getTime())
    problems.push(`the catalog expired at ${catalog.expiresAt}; it cannot be published`);

  // Git: the catalog and manifests must be main's.
  const git = await gitState(env.root, deps, options.offline);
  log(
    `Git: HEAD ${git.head?.slice(0, 7) ?? 'unknown'}, origin/main ${git.originMain?.slice(0, 7) ?? 'unknown'}${git.problems.length ? '' : ', clean'}.`,
  );
  if (confirmed) problems.push(...git.problems.map((problem) => `git: ${problem}`));
  else for (const problem of git.problems) log(`- would refuse with --confirm: ${problem}`);

  // Captures against the manifests the review app bundles.
  const manifests = await deps.reviewManifests(env.root);
  const ids = catalog.sources.map((source) => source.id);
  const folders = (
    options.captures.length ? options.captures : defaultCaptureFolders(env.root, ids, manifests)
  ).map((folder) => resolve(folder));
  const match = await matchCaptures(catalog.sources, folders, manifests);
  log('');
  log(
    `Capture folders (${folders.length}${options.captures.length ? '' : ', defaults from this checkout; pass --captures'}):`,
  );
  for (const entry of match.folders)
    log(`- ${entry.folder}: ${entry.exists ? `${entry.files} .txt files, ${entry.used} used` : 'not found'}`);
  log(
    `Captures: ${match.matched.size} of ${ids.length} sources match a bundled manifest hash for their date.`,
  );
  for (const entry of match.folders)
    if (!entry.exists) problems.push(`capture folder not found: ${entry.folder}`);
  if (match.missing.length) problems.push(`missing (no folder has <id>.txt): ${match.missing.join(', ')}`);
  for (const item of match.differs)
    problems.push(
      `differs: ${item.id} (no selected manifest capture matches the file in ${item.folders.join(', ')})`,
    );
  if (match.unknown.length) problems.push(`unknown to the bundled manifests: ${match.unknown.join(', ')}`);
  for (const item of match.unusable) problems.push(`unusable: ${item.id} in ${item.folder} (${item.reason})`);

  const note = reviewNote(
    catalog,
    catalogSha256,
    git.originMain ?? git.head ?? 'unknown',
    ids.length,
    options.instructionAt ?? INSTRUCTION_PLACEHOLDER,
  );
  if (note.length > 2000) problems.push(`the review note is ${note.length} characters (limit 2000)`);
  log('');
  log('Review note:');
  log(note);

  const sessionDeps: SessionDeps = {
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    sessionPath: deps.sessionPath,
    root: env.root,
    now: env.now,
    log,
  };

  if (!confirmed) {
    log('');
    if (options.offline) log('Remote: skipped (--offline).');
    else await dryRunRemote(env, options.version, options.api, sessionDeps);
    if (problems.length) {
      log('');
      log('Refused (fix before publishing):');
      for (const problem of problems) log(`- ${problem}`);
      return 1;
    }
    log('');
    log(
      `Dry run passed. After Evan types "publish ${options.version}" in chat, run this again with --confirm ${options.version} --instruction-at <UTC time of that message>.`,
    );
    return 0;
  }

  if (problems.length) {
    log('');
    log('Refused; nothing was sent:');
    for (const problem of problems) log(`- ${problem}`);
    return 1;
  }
  return confirmRemote(env, catalog, catalogSha256, match.matched, note, options.api, sessionDeps, deps);
}

async function dryRunRemote(env: Env, version: string, api: string, deps: SessionDeps): Promise<void> {
  const log = env.log;
  const file = await readSession(deps);
  if (!file) log(`Session: none at ${deps.sessionPath}. Evan runs ${LOGIN_COMMAND} in his own terminal.`);
  else if (file.api !== api)
    log(`Session: for ${file.api}, not ${api}; --confirm would refuse. Evan logs in with --api ${api}.`);
  else {
    const session = await openSession(deps);
    const queue = await reviewClient(deps, session!).request('GET', '/', reviewQueueSchema);
    const pending = queue.drafts.filter((draft) => draft.status === 'draft' && draft.version === version);
    log(`Session: ${file.email} at ${file.api}; reviewer access confirmed.`);
    log(
      `Review head: ${queue.head ?? 'none'}; pending drafts of ${version}: ${
        pending.length
          ? pending
              .map(
                (draft) =>
                  `${draft.id} (revision ${draft.revision}, base ${draft.base_sequence ?? 'none'}, updated ${draft.updated_at})`,
              )
              .join(', ')
          : 'none (publish will create one)'
      }.`,
    );
  }
  const served = await servedCatalog(deps, api);
  log(
    served.release
      ? `Served now: release ${served.release.sequence}, ${served.release.version}, expires ${served.release.catalog.expiresAt}.`
      : `Served now: no release (${served.error?.message ?? 'none published'}).`,
  );
}

/** Uploads one capture, waiting out 429s (Retry-After, bounded) up to MAX_RATE_LIMIT_WAITS times. */
async function upload(
  env: Env,
  client: ReviewClient,
  deps: PublishDeps,
  body: { sourceKey: string; title: string; url: string; checkedOn: string; body: string },
) {
  for (let waits = 0; ; waits++) {
    try {
      return await client.request('POST', '/sources', sourceDocumentSchema, body);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429 || waits >= MAX_RATE_LIMIT_WAITS) throw error;
      const wait = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
      env.log(`  rate limit: waiting ${Math.ceil(wait / 1000)} s`);
      await deps.sleep(wait);
    }
  }
}

/** Why the draft is not CATALOG_V3, pending, on an unmoved head (empty when it is). */
function draftProblems(summary: ReviewSummary, catalogSha256: string): string[] {
  const problems: string[] = [];
  if (jsonSha256(summary.draft.catalog) !== catalogSha256)
    problems.push(
      `the draft's catalog (canonical SHA-256 ${jsonSha256(summary.draft.catalog)}) is not CATALOG_V3 (${catalogSha256}); someone edited it`,
    );
  if (summary.draft.status !== 'draft') problems.push(`the draft is ${summary.draft.status}`);
  if (summary.head !== summary.draft.base_sequence)
    problems.push(
      `the review head moved: head ${summary.head ?? 'none'}, draft base ${summary.draft.base_sequence ?? 'none'}; the coordinator decides, nothing is rebased automatically`,
    );
  return problems;
}

/** Why the draft does not have every cited source attached once with the local capture (empty when it does). */
function attachmentProblems(
  summary: ReviewSummary,
  catalog: Catalog,
  matched: Map<string, MatchedCapture>,
): string[] {
  const problems: string[] = [];
  const byKey = new Map<string, number>();
  for (const doc of summary.sources) byKey.set(doc.source_key, (byKey.get(doc.source_key) ?? 0) + 1);
  for (const source of catalog.sources) {
    const docs = summary.sources.filter((doc) => doc.source_key === source.id);
    if (docs.length !== 1) problems.push(`${source.id}: attached ${docs.length} times`);
    else if (
      docs[0].content_hash !== matched.get(source.id)?.sha256 ||
      docs[0].checked_on !== source.checkedOn
    )
      problems.push(`${source.id}: the attached capture is not the local one for ${source.checkedOn}`);
  }
  const cited = new Set(catalog.sources.map((source) => source.id));
  for (const key of byKey.keys()) if (!cited.has(key)) problems.push(`${key}: attached but not cited`);
  return problems;
}

async function confirmRemote(
  env: Env,
  catalog: Catalog,
  catalogSha256: string,
  matched: Map<string, MatchedCapture>,
  note: string,
  api: string,
  sessionDeps: SessionDeps,
  deps: PublishDeps,
): Promise<number> {
  const log = env.log;
  const refuse = (lines: string[]) => {
    log('');
    log('Refused; not published:');
    for (const line of lines) log(`- ${line}`);
    return 1;
  };
  const session = await openSession(sessionDeps);
  if (!session)
    throw new CliError(`No session at ${sessionDeps.sessionPath}. Evan runs ${LOGIN_COMMAND}.`, 2);
  if (session.file.api !== api)
    return refuse([`the session is for ${session.file.api}, not ${api}; Evan logs in with --api ${api}`]);
  const client = reviewClient(sessionDeps, session);
  log('');
  log(`Session: ${session.file.email} at ${session.file.api}.`);

  // 1. Queue; 2. resume a pending draft of this version, or create one.
  const queue = await client.request('GET', '/', reviewQueueSchema);
  const pending = queue.drafts
    .filter((draft) => draft.status === 'draft' && draft.version === catalog.version)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  let draftId: string;
  if (pending.length) {
    draftId = pending[0].id;
    log(
      `Resuming draft ${draftId} (revision ${pending[0].revision})${pending.length > 1 ? `; ${pending.length} pending drafts of ${catalog.version}, using the newest` : ''}.`,
    );
  } else {
    const draft = await client.request('POST', '/drafts', draftSchema, {
      catalog,
      sourceDocumentIds: [],
      baseSequence: queue.head,
    });
    draftId = draft.id;
    log(`Created draft ${draftId} on head ${queue.head ?? 'none'}.`);
  }
  const path = `/drafts/${encodeURIComponent(draftId)}`;

  // 3. The draft must be CATALOG_V3 on an unmoved head before anything is uploaded.
  let summary = await client.request('GET', path, reviewSummarySchema);
  const early = draftProblems(summary, catalogSha256);
  if (early.length) return refuse(early);

  // 4. Upload the captures the draft lacks.
  const keep: string[] = [];
  const kept = new Set<string>();
  for (const source of catalog.sources) {
    const local = matched.get(source.id)!;
    const docs = summary.sources.filter((doc) => doc.source_key === source.id);
    const good = docs.find((doc) => doc.content_hash === local.sha256 && doc.checked_on === source.checkedOn);
    if (good && !kept.has(source.id)) {
      keep.push(good.id);
      kept.add(source.id);
    }
  }
  const toUpload = catalog.sources.filter((source) => !kept.has(source.id));
  log(`Captures: ${kept.size} already attached and matching; uploading ${toUpload.length}.`);
  const uploaded: string[] = [];
  for (const [index, source] of toUpload.entries()) {
    const local = matched.get(source.id)!;
    const doc = await upload(env, client, deps, {
      sourceKey: source.id,
      title: source.title,
      url: source.url,
      checkedOn: source.checkedOn,
      body: local.text,
    });
    if (
      doc.content_hash !== local.sha256 ||
      doc.source_key !== source.id ||
      doc.checked_on !== source.checkedOn
    )
      return refuse([
        `${source.id}: the API stored a capture that is not the local file (hash or date differs)`,
      ]);
    uploaded.push(doc.id);
    if ((index + 1) % PROGRESS_EVERY === 0 || index + 1 === toUpload.length)
      log(`  uploaded ${index + 1} of ${toUpload.length}`);
  }

  // 5. Attach exactly the matching captures, then verify the saved draft.
  const ids = [...keep, ...uploaded];
  const current = summary.draft.source_document_ids;
  if (ids.length !== current.length || ids.some((id) => !current.includes(id))) {
    await client.request('PUT', path, draftSchema, {
      catalog,
      sourceDocumentIds: ids,
      baseSequence: summary.draft.base_sequence,
      expectedRevision: summary.draft.revision,
    });
    summary = await client.request('GET', path, reviewSummarySchema);
    log(`Saved draft revision ${summary.draft.revision} with ${ids.length} captures.`);
  } else log('The draft already has exactly these captures; no save needed.');
  const late = [...draftProblems(summary, catalogSha256), ...attachmentProblems(summary, catalog, matched)];
  if (late.length) return refuse(late);
  log(
    `Verified: the draft equals CATALOG_V3 (${catalogSha256}), all ${catalog.sources.length} sources attached once with the local hashes, head ${summary.head ?? 'none'} unchanged.`,
  );

  // 6. Publish.
  const release = await client.request('POST', `${path}/publish`, publishedReleaseSchema, {
    expectedRevision: summary.draft.revision,
    expectedHash: summary.draft.catalog_hash,
    expectedHead: summary.head,
    reviewNote: note,
  });
  log('');
  log(
    `Published release ${release.sequence}: ${release.version}, ${release.catalog.cards.length} cards, ${release.catalog.sources.length} sources, expires ${release.catalog.expiresAt}; draft ${draftId}.`,
  );

  // 7. The public endpoint serves it.
  const served = await servedCatalog(sessionDeps, session.file.api);
  if (served.release?.sequence === release.sequence && served.release.version === release.version) {
    log(`/v1/catalog serves release ${release.sequence} (${release.version}).`);
    return 0;
  }
  log(
    `Warning: /v1/catalog serves ${served.release ? `release ${served.release.sequence} (${served.release.version})` : `no release (${served.error?.message ?? 'none'})`}, not release ${release.sequence}. Do not publish again; check the review app and the API.`,
  );
  return 1;
}

// ---- Real dependencies ------------------------------------------------------------------------------------------

export function defaultPublishDeps(sessionPath: string): PublishDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    git: (root, args) =>
      new Promise((done) =>
        execFile('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
          done(error ? null : stdout),
        ),
      ),
    reviewManifests: readReviewManifests,
    catalog: async () => (await import('@ai-checkout/rewards-core')).CATALOG_V3,
    sessionPath,
  };
}
