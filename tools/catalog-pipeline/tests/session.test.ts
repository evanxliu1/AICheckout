// `pipeline login`, `logout`, `whoami` and the session file, against the in-memory hosted stand-in (tests/hosted.ts).
import { chmod, mkdir, mkdtemp, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RELOGIN,
  login,
  logout,
  openSession,
  readSession,
  sessionPathFrom,
  whoami,
  writeSession,
} from '../src/session.ts';
import type { Prompter, SessionDeps } from '../src/session.ts';
import { API, EMAIL, PASSWORD, PUBLISHABLE_KEY, REVIEWER_ID, SECRET, SUPABASE, hosted } from './hosted.ts';
import type { Hosted } from './hosted.ts';

const allOutput: string[] = [];
afterAll(() => {
  // No token or password ever reaches stdout or stderr in any test of this file.
  expect(allOutput.join('\n')).not.toContain(SECRET);
});

async function setup(server: Hosted = hosted()) {
  const home = await mkdtemp(join(tmpdir(), 'review-session-'));
  const root = await mkdtemp(join(tmpdir(), 'repo-'));
  const logs: string[] = [];
  const deps: SessionDeps = {
    fetch: server.fetch,
    sessionPath: join(home, 'ai-checkout', 'review-session.json'),
    root,
    now: () => new Date('2026-10-04T12:00:00Z'),
    log: (line) => {
      logs.push(line);
      allOutput.push(line);
    },
  };
  return { server, deps, logs, home, root };
}

const prompter = (answers: (string | null)[], interactive = true): Prompter & { asked: string[] } => {
  const asked: string[] = [];
  return {
    interactive,
    asked,
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? null;
    },
  };
};

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe('pipeline login', () => {
  it('refuses without an interactive terminal: no prompt, no request, no file', async () => {
    const { server, deps, logs } = await setup();
    const prompt = prompter([EMAIL, PASSWORD], false);
    expect(await login(deps, prompt, API)).toBe(2);
    expect(logs).toEqual(['login needs an interactive terminal; Evan runs it himself']);
    expect(prompt.asked).toEqual([]);
    expect(server.calls).toEqual([]);
    expect(await readSession(deps)).toBeNull();
  });

  it('saves a 0600 session file in a 0700 directory with the refresh token only', async () => {
    const { server, deps, logs } = await setup();
    const prompt = prompter([EMAIL, PASSWORD]);
    expect(await login(deps, prompt, API)).toBe(0);
    expect(prompt.asked).toEqual(['Email: ', 'Password (not shown): ']);
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${API}/review/config.json`,
      `POST ${SUPABASE}/auth/v1/token?grant_type=password`,
      `GET ${API}/v1/review/`,
    ]);
    expect(await mode(deps.sessionPath)).toBe(0o600);
    expect(await mode(join(deps.sessionPath, '..'))).toBe(0o700);
    const text = await readFile(deps.sessionPath, 'utf8');
    expect(text).not.toContain('access');
    expect(text).not.toContain(PASSWORD);
    expect(JSON.parse(text)).toEqual({
      api: API,
      supabaseUrl: SUPABASE,
      publishableKey: PUBLISHABLE_KEY,
      refreshToken: server.refreshToken,
      userId: REVIEWER_ID,
      email: EMAIL,
      savedAt: '2026-10-04T12:00:00.000Z',
    });
    expect(logs).toEqual([
      `Signing in to ${API}; your password goes to Supabase Auth at project.supabase.example.test.`,
      `Signed in as ${EMAIL}.`,
      'Reviewer access confirmed.',
      `Session saved to ${deps.sessionPath} (mode 600). End it with \`npm run pipeline -- logout\`.`,
    ]);
  });

  it('never writes a file when the account has no reviewer access (403), and ends that session', async () => {
    const { server, deps, logs } = await setup();
    server.reviewer = false;
    expect(await login(deps, prompter([EMAIL, PASSWORD]), API)).toBe(1);
    expect(logs.join('\n')).toMatch(/this account has no reviewer access/);
    expect(await readSession(deps)).toBeNull();
    expect(server.calls.at(-1)?.url).toBe(`${SUPABASE}/auth/v1/logout?scope=local`);
  });

  it('reports a wrong password by status and code only', async () => {
    const { deps, logs } = await setup();
    expect(await login(deps, prompter([EMAIL, `${SECRET}-wrong`]), API)).toBe(1);
    expect(logs).toEqual([
      `Signing in to ${API}; your password goes to Supabase Auth at project.supabase.example.test.`,
      'Sign-in refused (HTTP 400, invalid_credentials); nothing saved.',
    ]);
    expect(await readSession(deps)).toBeNull();
  });

  it('stops on Ctrl-C at either prompt', async () => {
    const { server, deps } = await setup();
    expect(await login(deps, prompter([EMAIL, null]), API)).toBe(1);
    expect(server.calls.filter((call) => call.url.includes('/token'))).toEqual([]);
    expect(await readSession(deps)).toBeNull();
  });

  it('refuses a session file inside the repository', async () => {
    const { deps, root } = await setup();
    deps.sessionPath = join(root, '.config', 'review-session.json');
    await expect(login(deps, prompter([EMAIL, PASSWORD]), API)).rejects.toThrow(/inside the repository/);
  });
});

describe('session file', () => {
  async function loggedIn() {
    const setupResult = await setup();
    expect(await login(setupResult.deps, prompter([EMAIL, PASSWORD]), API)).toBe(0);
    setupResult.logs.length = 0;
    setupResult.server.calls.length = 0;
    return setupResult;
  }

  it('persists the rotated refresh token before using the access token', async () => {
    const { server, deps } = await loggedIn();
    const before = (await readSession(deps))!.refreshToken;
    const session = await openSession(deps);
    expect(session!.accessToken).toContain('access');
    const after = (await readSession(deps))!.refreshToken;
    expect(after).not.toBe(before);
    expect(after).toBe(server.refreshToken);
    expect(await mode(deps.sessionPath)).toBe(0o600);
  });

  it('a refused refresh token asks Evan to log in again (exit 2)', async () => {
    const { server, deps } = await loggedIn();
    server.refreshToken = 'something-else';
    await expect(openSession(deps)).rejects.toMatchObject({ message: RELOGIN, exitCode: 2 });
  });

  it('refuses a group-readable session file and changes nothing', async () => {
    const { deps, logs } = await loggedIn();
    await chmod(deps.sessionPath, 0o640);
    const text = await readFile(deps.sessionPath, 'utf8');
    await expect(whoami(deps, false)).rejects.toMatchObject({ exitCode: 2 });
    await expect(readSession(deps)).rejects.toThrow(/accessible to group or others \(mode 640\)/);
    expect(await mode(deps.sessionPath)).toBe(0o640);
    expect(await readFile(deps.sessionPath, 'utf8')).toBe(text);
    expect(logs).toEqual([]);
  });

  it('refuses a session file that is a symlink, and a symlinked session directory', async () => {
    const { deps, home } = await loggedIn();
    const file = (await readSession(deps))!;
    const real = join(home, 'elsewhere.json');
    await rename(deps.sessionPath, real);
    await symlink(real, deps.sessionPath);
    await expect(readSession(deps)).rejects.toMatchObject({ exitCode: 2 });
    await expect(readSession(deps)).rejects.toThrow(/is a symlink/);
    const target = join(home, 'target-dir');
    await mkdir(target, { mode: 0o700 });
    const linked = join(home, 'linked-dir');
    await symlink(target, linked);
    await expect(
      writeSession({ ...deps, sessionPath: join(linked, 'review-session.json') }, file),
    ).rejects.toThrow(/is a symlink/);
  });

  it('whoami prints the file without secrets; --check confirms reviewer access', async () => {
    const { deps, logs } = await loggedIn();
    expect(await whoami(deps, true)).toBe(0);
    expect(logs).toEqual([
      `Session file: ${deps.sessionPath} (mode 600)`,
      `Email: ${EMAIL}`,
      `API: ${API}`,
      'Saved: 2026-10-04T12:00:00.000Z',
      'Reviewer access confirmed: head none, 0 draft(s) in the queue.',
    ]);
  });

  it('whoami without a session tells Evan to log in (exit 2)', async () => {
    const { deps, logs } = await setup();
    expect(await whoami(deps, false)).toBe(2);
    expect(logs[0]).toMatch(/No session file at .*Evan runs `npm run pipeline -- login`/);
  });

  it('logout revokes the session server-side and deletes the file; works without a terminal', async () => {
    const { server, deps, logs } = await loggedIn();
    expect(await logout(deps)).toBe(0);
    expect(server.calls.map((call) => call.url)).toEqual([
      `${SUPABASE}/auth/v1/token?grant_type=refresh_token`,
      `${SUPABASE}/auth/v1/logout?scope=local`,
    ]);
    expect(server.refreshToken).toBe('revoked');
    expect(await readSession(deps)).toBeNull();
    expect(logs).toEqual(['Session revoked in Supabase.', `Deleted ${deps.sessionPath}.`]);
  });

  it('logout says so when Supabase cannot be reached, and still deletes the file', async () => {
    const { server, deps, logs } = await loggedIn();
    server.logoutFails = true;
    expect(await logout(deps)).toBe(0);
    expect(logs[0]).toMatch(/Could not revoke the session in Supabase \(.*network_error\)/);
    expect(await readSession(deps)).toBeNull();
  });

  it('the session path honours AI_CHECKOUT_REVIEW_SESSION and XDG_CONFIG_HOME', async () => {
    expect(sessionPathFrom({ AI_CHECKOUT_REVIEW_SESSION: '/x/y.json' })).toBe('/x/y.json');
    expect(sessionPathFrom({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/ai-checkout/review-session.json');
    expect(sessionPathFrom({})).toMatch(/\.config\/ai-checkout\/review-session\.json$/);
  });

  it('writeSession replaces the file atomically and re-applies mode 600', async () => {
    const { deps } = await loggedIn();
    const file = (await readSession(deps))!;
    await writeFile(deps.sessionPath, '{}', { mode: 0o600 });
    await writeSession(deps, file);
    expect(await readSession(deps)).toEqual(file);
    expect(await mode(deps.sessionPath)).toBe(0o600);
  });
});
