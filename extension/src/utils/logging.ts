// Logging utilities for debugging recommendations
// Stores detailed logs in chrome.storage for analysis

import type { RecommendationLog } from '../types';

const MAX_LOGS = 20; // Keep last 20 recommendations

/**
 * Log a recommendation for debugging
 */
export async function logRecommendation(log: RecommendationLog): Promise<void> {
  try {
    if (!(await isDebugMode())) return;
    const logs = await getRecommendationLogs();
    // Retain only operational metadata; no basket, prompt, or model prose.
    const redacted: RecommendationLog = {
      timestamp: log.timestamp,
      site: log.site,
      cartItems: [],
      recommendation: { card: log.recommendation.card, rewards: log.recommendation.rewards, merchant: log.site, category: Object.keys(log.recommendation.rewards).join(', ') },
      allCards: [],
      prompt: '',
      rawResponse: '',
    };
    await chrome.storage.local.set({ recommendationLogs: [redacted, ...logs].slice(0, MAX_LOGS) });
  } catch (error) {
    console.error('Failed to log recommendation:', error);
  }
}

/**
 * Get all recommendation logs
 */
export async function getRecommendationLogs(): Promise<RecommendationLog[]> {
  const { recommendationLogs } = await chrome.storage.local.get('recommendationLogs');
  if (!Array.isArray(recommendationLogs)) return [];
  const oldest = Date.now() - 24 * 60 * 60 * 1000;
  return recommendationLogs.filter((log): log is RecommendationLog =>
    log && typeof log.timestamp === 'number' && log.timestamp >= oldest && log.timestamp <= Date.now() &&
    Array.isArray(log.cartItems) && log.cartItems.length === 0 &&
    log.prompt === '' && log.rawResponse === '' && log.recommendation &&
    typeof log.site === 'string' && typeof log.recommendation.card === 'string'
  ).slice(0, MAX_LOGS);
}

/**
 * Clear all recommendation logs
 */
export async function clearRecommendationLogs(): Promise<void> {
  await chrome.storage.local.remove('recommendationLogs');
}

export async function exportLogsAsJSON(): Promise<string> {
  return JSON.stringify(await getRecommendationLogs(), null, 2);
}

export async function isDebugMode(): Promise<boolean> {
  const { debugMode } = await chrome.storage.local.get('debugMode');
  return debugMode === true;
}

export async function setDebugMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ debugMode: enabled });
  if (!enabled) await clearRecommendationLogs();
}

/**
 * Get formatted log summary for display
 */
export function formatLogSummary(log: RecommendationLog): string {
  const date = new Date(log.timestamp).toLocaleString();
  const itemCount = log.cartItems.length;

  return `[${date}] ${log.site} (${itemCount} items) → ${log.recommendation.card}`;
}

/**
 * Analyze logs to find potential issues
 */
export async function analyzeLogs(): Promise<{
  totalRecommendations: number;
  cardFrequency: Record<string, number>;
  categoryFrequency: Record<string, number>;
  averageCartSize: number;
}> {
  const logs = await getRecommendationLogs();

  const cardFrequency: Record<string, number> = {};
  const categoryFrequency: Record<string, number> = {};
  let totalItems = 0;

  logs.forEach(log => {
    // Count card recommendations
    const cardName = log.recommendation.card;
    cardFrequency[cardName] = (cardFrequency[cardName] || 0) + 1;

    // Count categories
    const category = log.recommendation.category;
    categoryFrequency[category] = (categoryFrequency[category] || 0) + 1;

    // Sum cart items
    totalItems += log.cartItems.length;
  });

  return {
    totalRecommendations: logs.length,
    cardFrequency,
    categoryFrequency,
    averageCartSize: logs.length > 0 ? totalItems / logs.length : 0
  };
}
