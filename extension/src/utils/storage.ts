// Chrome storage utilities with TypeScript type safety
// Provides helper functions for storing and retrieving data

import type { CreditCard, StorageData } from '../types';

/**
 * Generic storage getter with type safety
 */
async function getFromStorage<K extends keyof StorageData>(
  key: K
): Promise<StorageData[K] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] ?? null);
    });
  });
}

/**
 * Generic storage setter with type safety
 */
async function setInStorage<K extends keyof StorageData>(
  key: K,
  value: StorageData[K]
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}

/**
 * Get OpenAI API key from storage
 */
export async function getOpenAIKey(): Promise<string> {
  const key = await getFromStorage('openaiKey');
  return key || '';
}

/**
 * Set OpenAI API key in storage
 */
export async function setOpenAIKey(key: string): Promise<void> {
  await setInStorage('openaiKey', key);
}

/**
 * Validate OpenAI API key format
 */
export function validateOpenAIKey(key: string): boolean {
  return key.startsWith('sk-') && key.length > 20;
}

/**
 * Get cached credit cards from storage
 */
export async function getCachedCards(): Promise<CreditCard[]> {
  const cards = await getFromStorage('cachedCards');
  return cards || [];
}

/**
 * Set cached credit cards in storage
 */
export async function setCachedCards(cards: CreditCard[]): Promise<void> {
  await setInStorage('cachedCards', cards);
  await setInStorage('lastCardsFetch', Date.now());
}

/**
 * Check if cached cards are stale (older than 1 hour)
 */
export async function areCachedCardsStale(): Promise<boolean> {
  const lastFetch = await getFromStorage('lastCardsFetch');
  if (!lastFetch) return true;

  const ONE_HOUR = 60 * 60 * 1000;
  return Date.now() - lastFetch > ONE_HOUR;
}

/**
 * Get latest recommendation from storage
 */
export async function getLatestRecommendation(): Promise<string> {
  const recommendation = await getFromStorage('latestRecommendation');
  return recommendation || '';
}

/**
 * Set latest recommendation in storage
 */
export async function setLatestRecommendation(recommendation: string): Promise<void> {
  await setInStorage('latestRecommendation', recommendation);
}

/**
 * Clear all stored data (useful for testing/reset)
 */
export async function clearAllStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      resolve();
    });
  });
}

/**
 * Get all storage data (useful for debugging)
 */
export async function getAllStorageData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result) => {
      resolve(result as StorageData);
    });
  });
}

/**
 * Get storage quota info
 */
export async function getStorageInfo(): Promise<{
  bytesInUse: number;
  quotaBytes: number;
  percentUsed: number;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      const quotaBytes = chrome.storage.local.QUOTA_BYTES;
      const percentUsed = (bytesInUse / quotaBytes) * 100;

      resolve({
        bytesInUse,
        quotaBytes,
        percentUsed
      });
    });
  });
}

/**
 * Export settings (for backup)
 */
export async function exportSettings(): Promise<string> {
  const data = await getAllStorageData();
  return JSON.stringify(data, null, 2);
}

/**
 * Import settings (from backup)
 */
export async function importSettings(jsonString: string): Promise<void> {
  try {
    const data = JSON.parse(jsonString);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}
