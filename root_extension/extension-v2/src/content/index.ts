// Content script for Credit Card Recommender extension
// Runs on all pages and provides cart extraction and banner display functionality

import type { CartItem } from '../types';
import { getRegistry } from './extractors/ExtractorRegistry';
import { GenericExtractor } from './extractors/GenericExtractor';
import { SephoraExtractor } from './extractors/sites/SephoraExtractor';
import { ConfigExtractor, createConfigExtractors } from './extractors/ConfigExtractor';
import { SIMPLE_SITE_CONFIGS } from './extractors/configs/simple-sites.config';

// Debug mode flag
const DEBUG_MODE = false;

console.log('Credit Card Recommender content script loaded (Registry Pattern v2)');

// Initialize the extractor registry
const registry = getRegistry();

// Register all extractors
function initializeExtractors() {
  console.log('[Registry] Initializing extractors...');

  // Register site-specific extractors
  registry.register(new SephoraExtractor());

  // Register config-driven extractors
  const configExtractors = createConfigExtractors(SIMPLE_SITE_CONFIGS);
  registry.registerAll(configExtractors);

  // Register generic fallback extractor
  registry.setFallback(new GenericExtractor());

  const info = registry.getInfo();
  console.log(`[Registry] Initialized with ${info.registered} extractors for sites:`, info.sites);
}

// Initialize on load
initializeExtractors();

// Make functions available globally for popup to call
declare global {
  interface Window {
    __CC_extractCartItems?: () => CartItem[];
    __CC_createBanner?: (html: string) => void;
    __CC_DEBUG?: boolean;
    __CC_getRegistryInfo?: () => any;
  }
}

/**
 * Extract cart items from the current page
 * Exposed globally for popup script to call
 * Uses registry to automatically select the right extractor
 */
window.__CC_extractCartItems = function (): CartItem[] {
  const hostname = window.location.hostname;
  console.log(`[Extraction] Starting for: ${hostname}`);

  try {
    // Use registry to extract items (automatically selects right extractor)
    const items = registry.extractItems(hostname);

    console.log(`[Extraction] Successfully extracted ${items.length} items`);
    return items;
  } catch (error) {
    console.error('[Extraction] Failed:', error);
    return [];
  }
};

/**
 * Get registry info (for debugging)
 */
window.__CC_getRegistryInfo = function () {
  return registry.getInfo();
};

/**
 * Create or update recommendation banner on page
 * Exposed globally for popup script to call
 */
window.__CC_createBanner = function (html: string): void {
  console.log('Creating/updating recommendation banner');

  let banner = document.getElementById('cc-recommend-banner');

  if (!banner) {
    // Create new banner
    banner = document.createElement('div');
    banner.id = 'cc-recommend-banner';
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      min-width: 300px;
      max-width: 400px;
      padding: 16px;
      background: white;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      font-size: 14px;
      line-height: 1.5;
    `;

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
      padding: 0;
      width: 24px;
      height: 24px;
      line-height: 1;
    `;
    closeButton.onclick = () => {
      banner?.remove();
    };

    banner.appendChild(closeButton);
    document.body.appendChild(banner);

    // Animate in
    banner.style.opacity = '0';
    banner.style.transform = 'translateX(20px)';
    requestAnimationFrame(() => {
      banner!.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      banner!.style.opacity = '1';
      banner!.style.transform = 'translateX(0)';
    });
  }

  // Create content container (preserving close button)
  const closeBtn = banner.querySelector('button');
  banner.innerHTML = '';
  if (closeBtn) {
    banner.appendChild(closeBtn);
  }

  const content = document.createElement('div');
  content.innerHTML = html;
  content.style.paddingTop = '24px'; // Space for close button
  banner.appendChild(content);
};

/**
 * Build LLM prompt (exposed for popup to use)
 * Kept for backward compatibility with old popup code
 */
window.buildLLMPrompt = function (
  cartItems: CartItem[],
  site: string,
  cards: any[]
): string {
  const cardInfo = cards
    .map((card) => {
      const rewardCategories = Object.entries(card.rewards)
        .map(([cat, val]) => `${cat}: ${val}`)
        .join(', ');
      return `Name: ${card.name}\nReward Categories: ${rewardCategories}\nAnnual Fee: $${card.annualFee || card.annual_fee}\nDescription: ${card.description}`;
    })
    .join('\n---\n');

  const cartText =
    cartItems.length > 0
      ? cartItems.map((item, i) => `${i + 1}. ${item.name}`).join('\n')
      : '[Cart items could not be extracted]';

  return `You are a helpful assistant that recommends credit cards.

Here are the items in the user's shopping cart:
${cartText}

The website is: ${site}

Here are the available credit cards (with their reward categories):
${cardInfo}

First, infer the most likely merchant category for this purchase based on the cart and website.
Then, recommend the single best card for this purchase.

Respond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:
{
  "card": <Card Name>,
  "rewards": {<category>: <reward>, ...},
  "merchant": <website URL>,
  "category": <merchant category>
}`;
};

/**
 * Call OpenAI API (exposed for popup to use)
 * Kept for backward compatibility with old popup code
 */
window.callOpenAIChat = async function (prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that recommends credit cards.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 120,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
};

// Message listener for communication with background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.type);

  if (message.type === 'EXTRACT_CART') {
    const cartItems = window.__CC_extractCartItems?.() || [];
    sendResponse({ success: true, data: cartItems });
  } else if (message.type === 'CREATE_BANNER') {
    window.__CC_createBanner?.(message.payload);
    sendResponse({ success: true });
  } else if (message.type === 'GET_REGISTRY_INFO') {
    const info = window.__CC_getRegistryInfo?.() || {};
    sendResponse({ success: true, data: info });
  }

  return true;
});

// Set debug mode
window.__CC_DEBUG = DEBUG_MODE;

// Add type declarations for global functions
declare global {
  interface Window {
    buildLLMPrompt?: (cartItems: CartItem[], site: string, cards: any[]) => string;
    callOpenAIChat?: (prompt: string, apiKey: string) => Promise<string>;
  }
}

export {};
