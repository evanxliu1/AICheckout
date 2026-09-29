import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

type Message = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
};

/** Own the process separately so all Playwright worker debugging can be disconnected
 * during a natural idle interval. The observer attaches only to the merchant page. */
export async function launchLifecycleBrowser(profile: string, extension: string) {
  await mkdir(profile, { recursive: true });
  const child = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      // Match Playwright's relevant startup defaults when owning the process directly:
      // native prompts/keychain and occluded rendering otherwise interfere with popups.
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      '--disable-popup-blocking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-search-engine-choice-screen',
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-service-autorun',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = once(child, 'exit');
  let socket: WebSocket | undefined;
  async function close() {
    socket?.close();
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    await exited;
    clearTimeout(deadline);
  }
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Lifecycle Chromium startup timed out')), 10000);
      let logs = '';
      child.stderr.on('data', (data) => {
        logs = `${logs}${String(data)}`.slice(-16384);
        const match = logs.match(
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/,
        );
        if (match) {
          clearTimeout(deadline);
          resolve(match[1]);
        }
      });
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(deadline);
        reject(new Error('Lifecycle Chromium exited before startup'));
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Lifecycle observer could not connect')), {
        once: true,
      });
    });
    let sequence = 0;
    const listeners = new Set<(event: Message) => void>();
    const pending = new Map<
      number,
      {
        resolve: (result: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      const request = message.id === undefined ? undefined : pending.get(message.id);
      if (request) {
        pending.delete(message.id!);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result ?? {});
      } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Lifecycle observer disconnected'));
      }
      pending.clear();
    });
    function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      const id = ++sequence;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Lifecycle ${method} timed out`));
        }, 8000);
        pending.set(id, { resolve, reject, timer });
        socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    }
    async function targets() {
      return (await send('Target.getTargets', { filter: [{}] })).targetInfos as {
        targetId: string;
        type: string;
        url: string;
        attached: boolean;
      }[];
    }
    return {
      connect: () => chromium.connectOverCDP(endpoint),
      close,
      targets,
      observe: async (merchantUrl: string, id: string) => {
        const target = (await targets()).find((value) => value.type === 'page' && value.url === merchantUrl);
        if (!target) throw new Error('Lifecycle merchant page was not found');
        const { sessionId } = await send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        let status = '';
        const transitions: { status: string; at: number }[] = [];
        listeners.add((event) => {
          if (event.method !== 'ServiceWorker.workerVersionUpdated') return;
          const versions = event.params?.versions as { scriptURL: string; runningStatus: string }[];
          for (const version of versions)
            if (version.scriptURL.startsWith(`chrome-extension://${id}/`)) {
              status = version.runningStatus;
              transitions.push({ status, at: Date.now() });
            }
        });
        await send('ServiceWorker.enable', {}, sessionId as string);
        await expect.poll(() => status).toBe('running');
        return { status: () => status, transitions };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
