// `pipeline login`, `logout` and `whoami`, and the review API client `pipeline publish` uses (Phase 9 milestone 5,
// wiki/decisions/2026-10-05-agent-publish-cli-session.md). Evan creates the session himself: `login` refuses unless
// stdin and stdout are a terminal, reads the password without echo and keeps only the Supabase refresh token, in a
// mode-600 file outside the repository. No token or password is ever printed, logged or put in an error message;
// errors carry an HTTP status and a short code only.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { readBoundedJson } from '@ai-checkout/catalog-client';
import {
  MAX_REVIEW_RESPONSE_BYTES,
  reviewConfigSchema,
  reviewQueueSchema,
} from '@ai-checkout/catalog-review';
import type { ReviewConfig, ReviewQueue } from '@ai-checkout/catalog-review';
import { catalogResponseSchema } from '@ai-checkout/rewards-core';

export const DEFAULT_API = 'https://ai-checkout-api.onrender.com';
export const LOGIN_COMMAND = '`npm run pipeline -- login`';
export const RELOGIN = `session expired or revoked; Evan runs ${LOGIN_COMMAND}`;
/** Render's free instance can take about a minute to wake. */
export const REQUEST_TIMEOUT_MS = 90_000;
const ERROR_BODY_BYTES = 8192;

/** A refusal with its exit status (1 error, 2 usage or no session). The message never contains a secret. */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const messages: Record<string, string> = {
  sign_in_required: 'The session was refused.',
  reviewer_access_required: 'This account does not currently have reviewer access.',
  invalid_request: 'The API refused the request as invalid.',
  review_changed: 'The draft or published catalog changed in between.',
  draft_not_found: 'The draft is no longer available.',
  source_not_found: 'A capture is no longer attached to the draft.',
  invalid_catalog_evidence: 'The database refused the draft, its dates or its captured evidence.',
  too_many_requests: 'Too many requests.',
  request_too_large: 'The request is too large.',
  catalog_unavailable: 'No valid catalog release is served.',
  review_unavailable: 'The review API did not answer as expected.',
  network_error: 'The request did not reach the server.',
  timeout: 'The request timed out.',
  unexpected_response: 'The server answered with an unexpected response.',
};

/** A failed API request: HTTP status (0 when it never got one) and the API's `error` code. */
export class ApiError extends CliError {
  readonly status: number;
  readonly code: string;
  /** For a 429: how long the server asked to wait (`Retry-After`), in milliseconds. */
  readonly retryAfterMs?: number;
  constructor(status: number, code: string, retryAfterMs?: number) {
    super(
      `${messages[code] ?? 'The request did not finish.'} (HTTP ${status || 'none'}, ${code})`,
      status === 401 ? 2 : 1,
    );
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After` in seconds as milliseconds, bounded to 1–60 s; undefined when absent or not a number. */
function retryAfter(headers: Headers) {
  const value = headers.get('retry-after');
  if (!value || !/^\d{1,4}$/.test(value.trim())) return undefined;
  return Math.min(60, Math.max(1, Number(value))) * 1000;
}

const safeCode = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : undefined;

/** The `error` code of a failed response (bounded read; nothing else of the body is kept). */
async function errorCode(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await readBoundedJson(
      new Response(response.body, { status: 200, headers: response.headers }),
      ERROR_BODY_BYTES,
    )) as Record<string, unknown>;
    return safeCode(body?.error_code) ?? safeCode(body?.error) ?? fallback;
  } catch {
    return fallback;
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
}

/**
 * One JSON request: no redirects, no cache, a timeout, a bounded body parsed with `schema`. A failure becomes an
 * `ApiError` with the status and the response's `error` code only.
 */
export async function requestJson<T>(
  deps: HttpDeps,
  url: string,
  schema: z.ZodType<T>,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; maxBytes?: number } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: init.method ?? 'GET',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new ApiError(0, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error');
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      await errorCode(response, response.status === 401 ? 'sign_in_required' : 'review_unavailable'),
      response.status === 429 ? retryAfter(response.headers) : undefined,
    );
  let data: unknown;
  try {
    data = await readBoundedJson(response, init.maxBytes ?? MAX_REVIEW_RESPONSE_BYTES);
  } catch {
    throw new ApiError(response.status, 'unexpected_response');
  }
  // safeParse: a Zod error message could quote a field of the response.
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(response.status, 'unexpected_response');
  return parsed.data;
}

// ---- API origin and session file ------------------------------------------------------------------------------

/** The API origin: https, or http on localhost/127.0.0.1; an origin only (no path, query or credentials). */
export function apiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`--api must be an origin such as ${DEFAULT_API}.`, 2);
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !local) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new CliError(
      `--api must be an https origin (or http on localhost) without a path, such as ${DEFAULT_API}.`,
      2,
    );
  return url.origin;
}

/** `AI_CHECKOUT_REVIEW_SESSION`, else `${XDG_CONFIG_HOME || ~/.config}/ai-checkout/review-session.json`. */
export function sessionPathFrom(env: Record<string, string | undefined>): string {
  if (env.AI_CHECKOUT_REVIEW_SESSION) return resolve(env.AI_CHECKOUT_REVIEW_SESSION);
  const config =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(config, 'ai-checkout', 'review-session.json');
}

export const sessionFileSchema = z.strictObject({
  api: z.string().min(1).max(200),
  supabaseUrl: reviewConfigSchema.shape.supabaseUrl,
  publishableKey: reviewConfigSchema.shape.publishableKey,
  refreshToken: z.string().min(1).max(4096),
  userId: z.uuid(),
  email: z.string().min(3).max(320),
  savedAt: z.iso.datetime(),
});
export type SessionFile = z.infer<typeof sessionFileSchema>;

export interface SessionDeps extends HttpDeps {
  /** The session file (absolute). */
  sessionPath: string;
  /** The repository root: the session file must not be inside it. */
  root: string;
  now: () => Date;
  log: (line: string) => void;
}

function refuseInsideRepo(path: string, root: string) {
  const inside = relative(resolve(root), path);
  if (!inside.startsWith('..') && !isAbsolute(inside))
    throw new CliError(`The session file ${path} would be inside the repository; refusing.`, 2);
}

/** Writes the session file: directory 0700, file 0600, through a temporary file and a rename. */
export async function writeSession(deps: SessionDeps, file: SessionFile): Promise<void> {
  refuseInsideRepo(deps.sessionPath, deps.root);
  const dir = dirname(deps.sessionPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${deps.sessionPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(sessionFileSchema.parse(file), null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(tmp, 0o600);
    await rename(tmp, deps.sessionPath);
    await chmod(deps.sessionPath, 0o600);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** The session file, or null when there is none. Refuses (exit 2) a file group or others can read or write. */
export async function readSession(deps: SessionDeps): Promise<SessionFile | null> {
  let mode: number;
  try {
    mode = (await stat(deps.sessionPath)).mode;
  } catch {
    return null;
  }
  if (mode & 0o077)
    throw new CliError(
      `The session file ${deps.sessionPath} is accessible to group or others (mode ${(mode & 0o777).toString(8)}); nothing was changed. Evan deletes it and runs ${LOGIN_COMMAND} again.`,
      2,
    );
  let data: unknown;
  try {
    data = JSON.parse(await readFile(deps.sessionPath, 'utf8'));
  } catch {
    data = null;
  }
  const parsed = sessionFileSchema.safeParse(data);
  if (!parsed.success)
    throw new CliError(
      `The session file ${deps.sessionPath} is malformed. Evan runs ${LOGIN_COMMAND} again.`,
      2,
    );
  return parsed.data;
}

// ---- Supabase Auth --------------------------------------------------------------------------------------------

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(4096),
  user: z.object({ id: z.uuid(), email: z.string().max(320).optional() }),
});
type Tokens = z.infer<typeof tokenResponseSchema>;

async function authToken(
  deps: HttpDeps,
  config: ReviewConfig,
  grant: 'password' | 'refresh_token',
  body: Record<string, string>,
): Promise<Tokens> {
  return requestJson(
    deps,
    new URL(`/auth/v1/token?grant_type=${grant}`, config.supabaseUrl).href,
    tokenResponseSchema,
    { method: 'POST', headers: { apikey: config.publishableKey }, body, maxBytes: 65536 },
  );
}

/** Ends the session server-side (`/auth/v1/logout?scope=local`). */
async function revoke(deps: HttpDeps, config: ReviewConfig, accessToken: string): Promise<void> {
  let response: Response;
  try {
    response = await deps.fetch(new URL('/auth/v1/logout?scope=local', config.supabaseUrl).href, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }
  await response.body?.cancel();
  if (!response.ok && response.status !== 401 && response.status !== 403)
    throw new ApiError(response.status, 'logout_failed');
}

/** An open session: the file and a current access token (kept in memory only). */
export interface ReviewSession {
  file: SessionFile;
  accessToken: string;
}

/**
 * Exchanges the stored refresh token for an access token. Supabase rotates refresh tokens, so the new one is saved
 * (atomically) before the access token is used. A refused refresh token is a session to log in again (exit 2).
 */
export async function refreshSession(deps: SessionDeps, file: SessionFile): Promise<ReviewSession> {
  let tokens: Tokens;
  try {
    tokens = await authToken(deps, file, 'refresh_token', { refresh_token: file.refreshToken });
  } catch (error) {
    if (error instanceof ApiError && [400, 401, 403].includes(error.status)) throw new CliError(RELOGIN, 2);
    throw error;
  }
  const next = { ...file, refreshToken: tokens.refresh_token, savedAt: deps.now().toISOString() };
  await writeSession(deps, next);
  return { file: next, accessToken: tokens.access_token };
}

/** Reads and refreshes the session; null when there is no session file. */
export async function openSession(deps: SessionDeps): Promise<ReviewSession | null> {
  const file = await readSession(deps);
  return file ? refreshSession(deps, file) : null;
}

/** The review API (`/v1/review/*`) with the session's bearer token; a 401 refreshes once and retries once. */
export function reviewClient(deps: SessionDeps, session: ReviewSession) {
  const once = <T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown) =>
    requestJson(deps, `${session.file.api}/v1/review${path}`, schema, {
      method,
      body,
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  return {
    async request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
      try {
        return await once(method, path, schema, body);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const fresh = await refreshSession(deps, session.file);
        session.file = fresh.file;
        session.accessToken = fresh.accessToken;
        return await once(method, path, schema, body);
      }
    },
  };
}
export type ReviewClient = ReturnType<typeof reviewClient>;

/** The public `GET /v1/catalog`; null with the code when it answers an error (503 when no valid release). */
export async function servedCatalog(deps: HttpDeps, api: string) {
  try {
    return { release: (await requestJson(deps, `${api}/v1/catalog`, catalogResponseSchema)).release };
  } catch (error) {
    if (error instanceof ApiError) return { release: null, error };
    throw error;
  }
}

// ---- Terminal prompt -------------------------------------------------------------------------------------------

export interface Prompter {
  /** stdin and stdout are both terminals. */
  interactive: boolean;
  /** One line typed at the terminal (hidden: nothing echoed); null when Ctrl-C aborted it. */
  ask: (question: string, hidden: boolean) => Promise<string | null>;
}

/** Raw-mode line reader: echoes only when not hidden, handles backspace, Ctrl-C aborts; the terminal is restored. */
function askTerminal(question: string, hidden: boolean): Promise<string | null> {
  const input = process.stdin;
  const output = process.stdout;
  return new Promise((done) => {
    let value = '';
    let escape = false;
    const finish = (result: string | null) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      done(result);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        // Skip terminal escape sequences (arrow keys and the like): ESC, then up to a final letter or "~".
        if (escape) {
          if (/[A-Za-z~]/.test(char)) escape = false;
          continue;
        }
        if (char === '\u001b') escape = true;
        else if (char === '\u0003') return finish(null);
        else if (char === '\r' || char === '\n' || char === '\u0004') return finish(value);
        else if (char === '\u007f' || char === '\b') {
          if (value) {
            value = [...value].slice(0, -1).join('');
            if (!hidden) output.write('\b \b');
          }
        } else if (char >= ' ') {
          value += char;
          if (!hidden) output.write(char);
        }
      }
    };
    output.write(question);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

export function terminalPrompter(): Prompter {
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: askTerminal,
  };
}

// ---- Commands --------------------------------------------------------------------------------------------------

/** `pipeline login [--api <origin>]`: Evan only, in his own terminal. Exit 0 signed in, 1 refused, 2 no terminal. */
export async function login(deps: SessionDeps, prompt: Prompter, api: string): Promise<number> {
  if (!prompt.interactive) {
    deps.log('login needs an interactive terminal; Evan runs it himself');
    return 2;
  }
  refuseInsideRepo(deps.sessionPath, deps.root);
  const config = await requestJson(deps, `${api}/review/config.json`, reviewConfigSchema, {
    maxBytes: 4096,
  });
  const email = (await prompt.ask('Email: ', false))?.trim();
  if (email === undefined) {
    deps.log('login aborted; nothing saved');
    return 1;
  }
  if (!z.email().safeParse(email).success) {
    deps.log('That is not an email address; nothing saved.');
    return 1;
  }
  const password = await prompt.ask('Password (not shown): ', true);
  if (password === null || !password) {
    deps.log('login aborted; nothing saved');
    return 1;
  }
  let tokens: Tokens;
  try {
    tokens = await authToken(deps, config, 'password', { email, password });
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      deps.log(`Sign-in refused (HTTP ${error.status}, ${error.code}); nothing saved.`);
      return 1;
    }
    throw error;
  }
  let queue: ReviewQueue;
  try {
    queue = await requestJson(deps, `${api}/v1/review/`, reviewQueueSchema, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
  } catch (error) {
    await revoke(deps, config, tokens.access_token).catch(() => undefined);
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
      deps.log(
        'Signed in, but this account has no reviewer access; the session was ended and nothing saved.',
      );
      return 1;
    }
    throw error;
  }
  await writeSession(deps, {
    api,
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    refreshToken: tokens.refresh_token,
    userId: queue.reviewerId,
    email: tokens.user.email ?? email,
    savedAt: deps.now().toISOString(),
  });
  deps.log(`Signed in as ${tokens.user.email ?? email}.`);
  deps.log('Reviewer access confirmed.');
  deps.log(`Session saved to ${deps.sessionPath} (mode 600). End it with \`npm run pipeline -- logout\`.`);
  return 0;
}

/** `pipeline logout`: revokes the session server-side (best effort) and deletes the session file. */
export async function logout(deps: SessionDeps): Promise<number> {
  const file = await readSession(deps);
  if (!file) {
    deps.log(`No session file at ${deps.sessionPath}; nothing to do.`);
    return 0;
  }
  try {
    const session = await refreshSession(deps, file);
    await revoke(deps, session.file, session.accessToken);
    deps.log('Session revoked in Supabase.');
  } catch (error) {
    if (error instanceof CliError && error.message === RELOGIN)
      deps.log('The session was already expired or revoked.');
    else
      deps.log(
        `Could not revoke the session in Supabase (${error instanceof Error ? error.message : 'unknown error'}); deleting the local file anyway. Evan can end the session in Supabase.`,
      );
  }
  await rm(deps.sessionPath, { force: true });
  deps.log(`Deleted ${deps.sessionPath}.`);
  return 0;
}

/** `pipeline whoami [--check]`: what the session file says, without secrets; --check refreshes and asks the API. */
export async function whoami(deps: SessionDeps, check: boolean): Promise<number> {
  const file = await readSession(deps);
  if (!file) {
    deps.log(`No session file at ${deps.sessionPath}. Evan runs ${LOGIN_COMMAND} in his own terminal.`);
    return 2;
  }
  deps.log(`Session file: ${deps.sessionPath} (mode 600)`);
  deps.log(`Email: ${file.email}`);
  deps.log(`API: ${file.api}`);
  deps.log(`Saved: ${file.savedAt}`);
  if (!check) return 0;
  const session = await refreshSession(deps, file);
  const queue = await reviewClient(deps, session).request('GET', '/', reviewQueueSchema);
  deps.log(
    `Reviewer access confirmed: head ${queue.head ?? 'none'}, ${queue.drafts.length} draft(s) in the queue.`,
  );
  return 0;
}
