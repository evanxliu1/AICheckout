// Content script for Credit Card Recommender extension
// Runs on all pages and provides cart extraction and banner display functionality

import type { CartItem, Recommendation } from '../types';

// Debug mode flag
const DEBUG_MODE = false;

console.log('Credit Card Recommender content script loaded');

// Make functions available globally for popup to call
declare global {
  interface Window {
    __CC_extractCartItems?: () => CartItem[];
    __CC_createBanner?: (html: string) => void;
    __CC_DEBUG?: boolean;
  }
}

/**
 * Extract cart items from the current page
 * Exposed globally for popup script to call
 */
window.__CC_extractCartItems = function (): CartItem[] {
  console.log('Extracting cart items from:', window.location.hostname);

  const items: CartItem[] = [];

  // Strategy 1: Common cart selectors
  const cartSelectors = [
    '[id*="cart"]',
    '[class*="cart"]',
    '[id*="basket"]',
    '[class*="basket"]',
    '[id*="checkout"]',
    '[class*="checkout"]',
    '[id*="bag"]',
    '[class*="bag"]'
  ];

  for (const selector of cartSelectors) {
    const containers = document.querySelectorAll(selector);
    containers.forEach((container) => {
      // Look for items within container
      const itemElements = container.querySelectorAll(
        'li, .cart-item, .product, .line-item, [class*="item"]'
      );

      itemElements.forEach((item) => {
        const name = extractItemName(item as HTMLElement);
        if (name) {
          const price = extractPrice(item as HTMLElement);
          const quantity = extractQuantity(item as HTMLElement);
          items.push({ name, price, quantity });
        }
      });
    });
  }

  // Strategy 2: Fallback - find elements with prices
  if (items.length === 0) {
    const pricePattern = /\$\d+(\.\d{2})?/;
    const candidates = document.querySelectorAll('li, .product, .cart-item, .line-item, div');

    candidates.forEach((element) => {
      const text = element.textContent || '';
      if (pricePattern.test(text) && text.length < 300) {
        const name = extractItemName(element as HTMLElement);
        if (name && name.length > 3 && name.length < 200) {
          items.push({ name });
        }
      }
    });
  }

  // Deduplicate by name
  const uniqueItems = Array.from(
    new Map(items.map((item) => [item.name.toLowerCase().trim(), item])).values()
  ).slice(0, 20); // Limit to 20 items max

  console.log('Extracted cart items:', uniqueItems.length);
  return uniqueItems;
};

/**
 * Extract item name from element
 */
function extractItemName(element: HTMLElement): string | null {
  // Try specific selectors first
  const nameSelectors = [
    '.product-title',
    '.item-title',
    '.product-name',
    '.name',
    '[class*="title"]',
    '[class*="name"]',
    'h2',
    'h3',
    'h4',
    'a'
  ];

  for (const selector of nameSelectors) {
    const nameElement = element.querySelector(selector);
    if (nameElement && nameElement.textContent) {
      const name = nameElement.textContent.trim();
      if (name.length > 0 && name.length < 200) {
        return name;
      }
    }
  }

  // Fallback to element's text content
  const text = element.textContent?.trim() || '';
  if (text.length > 3 && text.length < 300) {
    // Clean up: take first line or before price
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    if (firstLine.length > 3) {
      return firstLine;
    }
  }

  return null;
}

/**
 * Extract price from element
 */
function extractPrice(element: HTMLElement): string | undefined {
  const priceSelectors = [
    '.price',
    '.product-price',
    '[class*="price"]',
    '[data-price]',
    '[data-test*="price"]'
  ];

  for (const selector of priceSelectors) {
    const priceElement = element.querySelector(selector);
    if (priceElement && priceElement.textContent) {
      const price = priceElement.textContent.trim();
      if (price.includes('$')) {
        return price;
      }
    }
  }

  // Fallback: search text for price pattern
  const text = element.textContent || '';
  const priceMatch = text.match(/\$\d+(\.\d{2})?/);
  return priceMatch ? priceMatch[0] : undefined;
}

/**
 * Extract quantity from element
 */
function extractQuantity(element: HTMLElement): number | undefined {
  const quantitySelectors = [
    '[class*="quantity"]',
    '[class*="qty"]',
    'input[type="number"]',
    '[data-quantity]'
  ];

  for (const selector of quantitySelectors) {
    const qtyElement = element.querySelector(selector) as HTMLInputElement;
    if (qtyElement) {
      const qtyValue = qtyElement.value || qtyElement.textContent;
      const parsed = parseInt(qtyValue || '1', 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return undefined;
}

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
