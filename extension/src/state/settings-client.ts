import { settingsSchema } from '../badge/contracts';
import type { Settings } from '../badge/contracts';

async function send(request: unknown): Promise<Settings> {
  let input: unknown;
  try {
    input = await chrome.runtime.sendMessage(request);
  } catch {
    throw new Error('The extension could not connect. Reopen it and try again.');
  }
  const value = input as { ok?: boolean; settings?: unknown; error?: string } | undefined;
  if (!value?.ok) throw new Error(value?.error ?? 'Settings could not be loaded.');
  const parsed = settingsSchema.safeParse(value.settings);
  if (!parsed.success) throw new Error('Settings could not be read.');
  return parsed.data;
}
export const getSettings = () => send({ type: 'settings:get' });
export const saveSettings = (settings: Settings) => send({ type: 'settings:set', settings });
