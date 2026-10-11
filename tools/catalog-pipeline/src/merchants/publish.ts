// `pipeline merchants publish` (Phase 14.6): the coordinator publishes the bundled merchant release `MERCHANTS_V1`
// through the hosted review API (`POST /v1/review/merchants/publish`) with the session Evan logged in
// (`pipeline login`), only on his chat instruction `publish merchants <version>` (wiki/ops/catalog-release.md,
// "Merchant release"). The guards are the catalog publish's: without --confirm it is a dry run with local checks
// and read-only remote checks; with --confirm <version> --instruction-at <UTC time of Evan's message> it refuses a
// future or stale instruction, a HEAD that is not origin/main, uncommitted changes under the release's inputs or a
// version that is not MERCHANTS_V1's, then publishes on the head it just read. No token is ever printed.
import { execFile } from 'node:child_process';
import { publishedMerchantReleaseSchema, merchantReleaseSchema } from '@ai-checkout/rewards-core';
import type { MerchantRelease } from '@ai-checkout/rewards-core';
import { reviewQueueSchema } from '@ai-checkout/catalog-review';
import { jsonSha256 } from '../hash.ts';
import { gitState, instructionProblems } from '../publish.ts';
import type { PublishDeps } from '../publish.ts';
import type { Env } from '../run.ts';
import {
  CliError,
  LOGIN_COMMAND,
  openSession,
  readSession,
  refreshSession,
  reviewClient,
  servedMerchants,
} from '../session.ts';
import type { SessionDeps } from '../session.ts';

/** Paths whose uncommitted changes would make the checkout's release differ from main's. */
export const MERCHANT_CLEAN_PATHS = [
  'packages/rewards-core',
  'evals/merchants/db/records',
  'evals/merchants/db/release-config.json',
  'evals/merchants/db/release.json',
  'scripts/build-merchants-v1.mjs',
  'scripts/lib/merchants-v1.mjs',
  'tools/catalog-pipeline',
];
const INSTRUCTION_PLACEHOLDER = '<time of Evan’s chat message>';

export interface MerchantPublishDeps extends Pick<
  PublishDeps,
  'fetch' | 'git' | 'sessionPath' | 'timeoutMs'
> {
  /** The release to publish: `MERCHANTS_V1` of this checkout. */
  release: () => Promise<MerchantRelease>;
}

export interface MerchantPublishOptions {
  version?: string;
  confirm?: string;
  instructionAt?: string;
  /** The API origin (validated); a session's own API must equal it. */
  api: string;
  /** Skip every network request (git fetch, the session refresh, the API). Dry run only. */
  offline: boolean;
}

/** The review note (10–2000 characters) stating what the coordinator checked. */
export function merchantReviewNote(
  release: MerchantRelease,
  releaseSha256: string,
  mainSha: string,
  instructionAt: string,
): string {
  const processors = release.merchants.filter((m) => m.kind === 'processor').length;
  const bonus = release.merchants.filter((m) => m.evidence.basis !== 'default').length;
  return (
    `Merchant release ${release.version} (${release.merchants.length} records, ${processors} processors, ${bonus} with a bonus category on evidence, ${release.sources.length} sources, verified ${release.verifiedAt}) is agent-verified, not human-verified. ` +
    `The coding agent checked: the release is MERCHANTS_V1 on main ${mainSha.slice(0, 7)} (canonical JSON SHA-256 ${releaseSha256}), valid under merchant-release.1, built from the committed records; the blind audit report is docs/evals/merchant-db-v1.md. ` +
    `Published by the coding agent on Evan's chat instruction of ${instructionAt}.`
  );
}

export async function publishMerchants(
  env: Env,
  options: MerchantPublishOptions,
  deps: MerchantPublishDeps,
): Promise<number> {
  const log = env.log;
  const now = env.now();
  const confirmed = options.confirm !== undefined;
  if (!options.version)
    throw new CliError('merchants publish needs --version <merchant release version>.', 2);
  if (confirmed && options.offline) throw new CliError('--offline is for a dry run; drop --confirm.', 2);
  const release = await deps.release();
  const releaseSha256 = jsonSha256(release);
  const problems = instructionProblems(release, options, now, 'MERCHANTS_V1');
  const valid = merchantReleaseSchema.safeParse(release);
  if (!valid.success) problems.push('MERCHANTS_V1 is not a valid merchant release in this checkout');
  if (Date.parse(release.verifiedAt) > now.getTime())
    problems.push(`the release is verified in the future (${release.verifiedAt}); it cannot be published`);

  log(
    `# Publish merchants ${confirmed ? '' : 'dry run '}${options.version}${confirmed ? '' : ' (nothing is sent to the review API)'}`,
  );
  log('');
  log(
    `MERCHANTS_V1 here: ${release.version}, ${release.merchants.length} records, ${release.sources.length} sources, verified ${release.verifiedAt}; canonical JSON SHA-256 ${releaseSha256}.`,
  );

  const git = await gitState(env.root, deps, options.offline, MERCHANT_CLEAN_PATHS);
  log(
    `Git: HEAD ${git.head?.slice(0, 7) ?? 'unknown'}, origin/main ${git.originMain?.slice(0, 7) ?? 'unknown'}${git.problems.length ? '' : ', clean'}.`,
  );
  if (confirmed) problems.push(...git.problems.map((problem) => `git: ${problem}`));
  else for (const problem of git.problems) log(`- would refuse with --confirm: ${problem}`);

  const note = merchantReviewNote(
    release,
    releaseSha256,
    git.originMain ?? git.head ?? 'unknown',
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
    else await dryRunRemote(env, release, options.api, sessionDeps);
    if (problems.length) {
      log('');
      log('Refused (fix before publishing):');
      for (const problem of problems) log(`- ${problem}`);
      return 1;
    }
    log('');
    log(
      `Dry run passed. After Evan types "publish merchants ${options.version}" in chat, run this again with --confirm ${options.version} --instruction-at <UTC time of that message>.`,
    );
    return 0;
  }

  if (problems.length) {
    log('');
    log('Refused; nothing was sent:');
    for (const problem of problems) log(`- ${problem}`);
    return 1;
  }
  return confirmRemote(env, release, releaseSha256, note, options.api, sessionDeps);
}

async function dryRunRemote(env: Env, release: MerchantRelease, api: string, deps: SessionDeps) {
  const log = env.log;
  const file = await readSession(deps);
  if (!file) log(`Session: none at ${deps.sessionPath}. Evan runs ${LOGIN_COMMAND} in his own terminal.`);
  else if (file.api !== api)
    log(`Session: for ${file.api}, not ${api}; --confirm would refuse. Evan logs in with --api ${api}.`);
  else {
    const session = await openSession(deps);
    await reviewClient(deps, session!).request('GET', '/', reviewQueueSchema);
    log(`Session: ${file.email} at ${file.api}; reviewer access confirmed.`);
  }
  const served = await servedMerchants(deps, api);
  describeServed(log, served, release);
}

function describeServed(
  log: (line: string) => void,
  served: Awaited<ReturnType<typeof servedMerchants>>,
  release: MerchantRelease,
) {
  if (!served.release) {
    log(`Served now: no merchant release (${served.error?.message ?? 'none published'}).`);
    return;
  }
  log(
    `Served now: release ${served.release.sequence}, ${served.release.version}, ${served.release.release.merchants.length} records, verified ${served.release.release.verifiedAt}, published ${served.release.published_at}.`,
  );
  if (served.release.version === release.version)
    log(
      `- ${release.version} is already published; --confirm would republish only identical content (a no-op).`,
    );
  else if (Date.parse(served.release.release.verifiedAt) > Date.parse(release.verifiedAt))
    log(
      `- warning: the served release is verified later (${served.release.release.verifiedAt}) than this one; the extension keeps the newer verification date in effect.`,
    );
}

async function confirmRemote(
  env: Env,
  release: MerchantRelease,
  releaseSha256: string,
  note: string,
  api: string,
  sessionDeps: SessionDeps,
): Promise<number> {
  const log = env.log;
  const refuse = (lines: string[]) => {
    log('');
    log('Refused; not published:');
    for (const line of lines) log(`- ${line}`);
    return 1;
  };
  const file = await readSession(sessionDeps);
  if (!file) throw new CliError(`No session at ${sessionDeps.sessionPath}. Evan runs ${LOGIN_COMMAND}.`, 2);
  if (file.api !== api)
    return refuse([`the session is for ${file.api}, not ${api}; Evan logs in with --api ${api}`]);
  const session = await refreshSession(sessionDeps, file);
  const client = reviewClient(sessionDeps, session);
  log('');
  log(`Session: ${session.file.email} at ${session.file.api}.`);

  // 1. The head as served now: the publication must land on exactly this state.
  const served = await servedMerchants(sessionDeps, api);
  // A 503 (the API unconfigured or its read failing) hides the head; a first publication answers 200 with
  // a null release, so any error refuses rather than publishing against an unknown head.
  if (served.error)
    return refuse([
      `/v1/merchants did not answer (${served.error.message}); the head is unknown, nothing was sent`,
    ]);
  describeServed(log, served, release);
  if (served.release && served.release.version === release.version) {
    if (jsonSha256(served.release.release) === releaseSha256) {
      log(`${release.version} is already the served release with identical content; nothing to publish.`);
      return 0;
    }
    return refuse([`${release.version} is already published with different content; build a new version`]);
  }
  const expectedHead = served.release?.sequence ?? null;
  const expectedHash = served.release?.release_hash ?? null;

  // 2. Publish.
  const published = await client.request('POST', '/merchants/publish', publishedMerchantReleaseSchema, {
    release,
    expectedHead,
    expectedHash,
    reviewNote: note,
  });
  if (jsonSha256(published.release) !== releaseSha256)
    return refuse([
      `the API stored a release that is not MERCHANTS_V1 (canonical SHA-256 ${jsonSha256(published.release)}); check the review API`,
    ]);
  log('');
  log(
    `Published merchant release ${published.sequence}: ${published.version}, ${published.release.merchants.length} records, ${published.release.sources.length} sources, hash ${published.release_hash}.`,
  );

  // 3. The public endpoint serves it.
  const after = await servedMerchants(sessionDeps, api);
  if (after.release?.sequence === published.sequence && after.release.version === published.version) {
    log(`/v1/merchants serves release ${published.sequence} (${published.version}).`);
    return 0;
  }
  log(
    `Warning: /v1/merchants serves ${after.release ? `release ${after.release.sequence} (${after.release.version})` : `no release (${after.error?.message ?? 'none'})`}, not release ${published.sequence}. Do not publish again; check the API.`,
  );
  return 1;
}

export function defaultMerchantPublishDeps(sessionPath: string): MerchantPublishDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    git: (root, args) =>
      new Promise((done) =>
        execFile('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
          done(error ? null : stdout),
        ),
      ),
    release: async () => (await import('@ai-checkout/rewards-core')).MERCHANTS_V1,
    sessionPath,
  };
}
