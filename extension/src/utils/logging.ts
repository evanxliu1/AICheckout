// Logging utilities for debugging recommendations
// Stores detailed logs in chrome.storage for analysis

import type { RecommendationLog } from '../types';

const MAX_LOGS = 20; // Keep last 20 recommendations

/**
 * Log a recommendation for debugging
 */
export async function logRecommendation(log: RecommendationLog): Promise<void> {
  try {
    const logs = await getRecommendationLogs();

    // Add new log at the beginning
    logs.unshift(log);

    // Keep only the most recent MAX_LOGS entries
    const trimmedLogs = logs.slice(0, MAX_LOGS);

    // Save to storage
    await chrome.storage.local.set({ recommendationLogs: trimmedLogs });

    // Also log to console for immediate debugging
    console.group('🔍 Recommendation Debug Log');
    console.log('Site:', log.site);
    console.log('Cart Items:', log.cartItems);
    console.log('Recommended Card:', log.recommendation.card);
    console.log('Category:', log.recommendation.category);
    console.log('Reasoning:', log.recommendation.reasoning);
    console.log('All Cards:', log.allCards);
    console.groupCollapsed('Full Prompt');
    console.log(log.prompt);
    console.groupEnd();
    console.groupCollapsed('Raw LLM Response');
    console.log(log.rawResponse);
    console.groupEnd();
    console.groupEnd();
  } catch (error) {
    console.error('Failed to log recommendation:', error);
  }
}

/**
 * Get all recommendation logs
 */
export async function getRecommendationLogs(): Promise<RecommendationLog[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['recommendationLogs'], (result) => {
      resolve(result.recommendationLogs || []);
    });
  });
}

/**
 * Clear all recommendation logs
 */
export async function clearRecommendationLogs(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['recommendationLogs'], () => {
      console.log('✅ Recommendation logs cleared');
      resolve();
    });
  });
}

/**
 * Export logs as JSON for analysis
 */
export async function exportLogsAsJSON(): Promise<string> {
  const logs = await getRecommendationLogs();
  return JSON.stringify(logs, null, 2);
}

/**
 * Get debug mode status
 */
export async function isDebugMode(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['debugMode'], (result) => {
      resolve(result.debugMode || false);
    });
  });
}

/**
 * Toggle debug mode
 */
export async function setDebugMode(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ debugMode: enabled }, () => {
      console.log(`🐛 Debug mode ${enabled ? 'enabled' : 'disabled'}`);
      resolve();
    });
  });
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
