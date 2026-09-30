import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** The installed CLI's `--version` line, or "unknown" when it cannot be read. */
export async function cliVersion(bin: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(bin, ['--version'], { timeout: 15_000 });
    return stdout.trim().split('\n')[0].slice(0, 80) || 'unknown';
  } catch {
    return 'unknown';
  }
}
