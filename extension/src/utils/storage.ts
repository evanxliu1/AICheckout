import type { CreditCard, StorageData } from '../types';
import { creditCardsSchema } from '../types/schemas';

async function getFromStorage<K extends keyof StorageData>(key: K): Promise<unknown> {
  const values = await chrome.storage.local.get(key);
  return values[key];
}

export async function getOpenAIKey(): Promise<string> {
  const key = await getFromStorage('openaiKey');
  return typeof key === 'string' ? key : '';
}

export async function setOpenAIKey(key: string): Promise<void> {
  if (key) await chrome.storage.local.set({ openaiKey: key });
  else await chrome.storage.local.remove('openaiKey');
}

export function validateOpenAIKey(key: string): boolean {
  return key.startsWith('sk-') && key.length > 20 && key.length <= 512 && !/\s/.test(key);
}

export async function getCachedCards(): Promise<CreditCard[]> {
  const result = creditCardsSchema.safeParse(await getFromStorage('cachedCards'));
  return result.success ? result.data : [];
}

export async function setCachedCards(cards: CreditCard[]): Promise<void> {
  await chrome.storage.local.set({ cachedCards: creditCardsSchema.parse(cards), lastCardsFetch: Date.now() });
}

export async function areCachedCardsStale(): Promise<boolean> {
  const lastFetch = await getFromStorage('lastCardsFetch');
  if (typeof lastFetch !== 'number' || !Number.isFinite(lastFetch)) return true;
  const age = Date.now() - lastFetch;
  return age < 0 || age >= 60 * 60 * 1000;
}

export async function getLatestRecommendation(): Promise<string> {
  const value = await getFromStorage('latestRecommendation');
  return typeof value === 'string' ? value : '';
}

export async function setLatestRecommendation(recommendation: string): Promise<void> {
  await chrome.storage.local.set({ latestRecommendation: recommendation });
}

export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear();
}

export async function getAllStorageData(): Promise<StorageData> {
  return await chrome.storage.local.get(null) as StorageData;
}

export async function getStorageInfo() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  const quotaBytes = chrome.storage.local.QUOTA_BYTES;
  return { bytesInUse, quotaBytes, percentUsed: (bytesInUse / quotaBytes) * 100 };
}

// Backup only user preferences, never credentials, raw logs, or cached API data.
export async function exportSettings(): Promise<string> {
  return JSON.stringify({ debugMode: await getFromStorage('debugMode') === true }, null, 2);
}

export async function importSettings(jsonString: string): Promise<void> {
  const value: unknown = JSON.parse(jsonString);
  if (!value || typeof value !== 'object' || !('debugMode' in value) || typeof value.debugMode !== 'boolean') {
    throw new Error('Expected settings with a true/false diagnostics preference.');
  }
  await chrome.storage.local.set({ debugMode: value.debugMode });
}
