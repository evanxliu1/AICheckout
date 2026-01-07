// Content script for Credit Card Recommender extension
// Runs on all pages and provides cart extraction and banner display functionality

import type { CartItem } from '../types';
import { getRegistry } from '../extractors/ExtractorRegistry';
import { GenericExtractor } from '../extractors/GenericExtractor';
import { SephoraExtractor } from '../extractors/sites/SephoraExtractor';
import { SafewayExtractor } from '../extractors/sites/SafewayExtractor';
import { BestBuyExtractor } from '../extractors/sites/BestBuyExtractor';
import { createConfigExtractors } from '../extractors/ConfigExtractor';
import { SIMPLE_SITE_CONFIGS } from '../extractors/configs/simple-sites.config';

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
  registry.register(new SafewayExtractor());
  registry.register(new BestBuyExtractor());

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

export {};
