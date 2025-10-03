// Cart extraction utilities
// Extracts cart items from e-commerce pages using DOM selectors

import type { CartItem } from '../types';

/**
 * Extract cart items from the current page
 * Uses multiple selector strategies for different e-commerce platforms
 */
export function extractCartItems(): CartItem[] {
  console.log('Extracting cart items from:', window.location.hostname);

  // Try different extraction strategies
  const items = [
    ...extractFromCartContainers(),
    ...extractFromCheckoutPages(),
    ...extractFromProductPages(),
    ...extractFallback()
  ];

  // Deduplicate by name
  const uniqueItems = Array.from(
    new Map(items.map((item) => [item.name.toLowerCase(), item])).values()
  );

  console.log('Extracted cart items:', uniqueItems);
  return uniqueItems;
}

/**
 * Strategy 1: Extract from cart containers
 */
function extractFromCartContainers(): CartItem[] {
  const items: CartItem[] = [];
  const containerSelectors = [
    '[id*="cart"]',
    '[class*="cart"]',
    '[id*="basket"]',
    '[class*="basket"]',
    '[data-testid*="cart"]',
    '[data-test*="cart"]'
  ];

  for (const selector of containerSelectors) {
    const containers = document.querySelectorAll(selector);

    containers.forEach((container) => {
      // Look for product items within container
      const itemSelectors = [
        '.cart-item',
        '.product',
        '.line-item',
        '[class*="item"]',
        '[class*="product"]',
        'li'
      ];

      for (const itemSelector of itemSelectors) {
        const itemElements = container.querySelectorAll(itemSelector);

        itemElements.forEach((item) => {
          const extracted = extractItemFromElement(item as HTMLElement);
          if (extracted) {
            items.push(extracted);
          }
        });
      }
    });
  }

  return items;
}

/**
 * Strategy 2: Extract from checkout pages
 */
function extractFromCheckoutPages(): CartItem[] {
  const items: CartItem[] = [];

  // Check if we're on a checkout page
  const isCheckout =
    window.location.pathname.includes('checkout') ||
    window.location.pathname.includes('cart') ||
    document.title.toLowerCase().includes('checkout') ||
    document.title.toLowerCase().includes('cart');

  if (!isCheckout) return items;

  // Look for order summary sections
  const summarySelectors = [
    '[class*="order-summary"]',
    '[class*="checkout-summary"]',
    '[id*="order-summary"]',
    '[class*="cart-summary"]'
  ];

  for (const selector of summarySelectors) {
    const summaries = document.querySelectorAll(selector);

    summaries.forEach((summary) => {
      const itemElements = summary.querySelectorAll('[class*="item"], [class*="product"], li');

      itemElements.forEach((item) => {
        const extracted = extractItemFromElement(item as HTMLElement);
        if (extracted) {
          items.push(extracted);
        }
      });
    });
  }

  return items;
}

/**
 * Strategy 3: Extract from product pages (single item)
 */
function extractFromProductPages(): CartItem[] {
  const items: CartItem[] = [];

  // Check if we're on a product page
  const isProduct =
    window.location.pathname.includes('/product') ||
    window.location.pathname.includes('/item') ||
    document.querySelector('[class*="product-detail"]') !== null ||
    document.querySelector('[class*="product-page"]') !== null;

  if (!isProduct) return items;

  // Try to extract product name
  const nameSelectors = [
    'h1[class*="product"]',
    'h1[class*="title"]',
    '[class*="product-name"]',
    '[class*="product-title"]',
    '[itemprop="name"]',
    'h1'
  ];

  for (const selector of nameSelectors) {
    const nameElement = document.querySelector(selector);
    if (nameElement && nameElement.textContent) {
      const name = nameElement.textContent.trim();
      if (name.length > 0 && name.length < 200) {
        // Try to extract price
        const priceElement = document.querySelector(
          '[class*="price"], [itemprop="price"], [data-test*="price"]'
        );
        const price = priceElement ? priceElement.textContent?.trim() : undefined;

        items.push({
          name,
          price,
          quantity: 1
        });
        break;
      }
    }
  }

  return items;
}

/**
 * Strategy 4: Fallback - look for any elements with prices
 */
function extractFallback(): CartItem[] {
  const items: CartItem[] = [];

  // Find all elements that contain price indicators
  const pricePattern = /\$\d+(\.\d{2})?/;
  const allElements = document.querySelectorAll('div, li, span, p');

  allElements.forEach((element) => {
    const text = element.textContent || '';
    if (pricePattern.test(text) && text.length < 300) {
      // Try to find nearby text that might be the product name
      const parentElement = element.parentElement;
      if (parentElement) {
        const name = extractNameFromElement(parentElement);
        const price = text.match(pricePattern)?.[0];

        if (name && price) {
          items.push({
            name,
            price,
            quantity: 1
          });
        }
      }
    }
  });

  return items.slice(0, 10); // Limit to avoid too many false positives
}

/**
 * Extract cart item details from a DOM element
 */
function extractItemFromElement(element: HTMLElement): CartItem | null {
  try {
    // Try to find product name
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

    let name = '';
    for (const selector of nameSelectors) {
      const nameElement = element.querySelector(selector);
      if (nameElement && nameElement.textContent) {
        name = nameElement.textContent.trim();
        if (name.length > 0 && name.length < 200) {
          break;
        }
      }
    }

    // If no name found, use element text content
    if (!name) {
      name = element.textContent?.trim() || '';
    }

    // Filter out invalid names
    if (!name || name.length < 3 || name.length > 300) {
      return null;
    }

    // Try to extract price
    const priceSelectors = [
      '.price',
      '.product-price',
      '[class*="price"]',
      '[data-price]',
      '[data-test*="price"]'
    ];

    let price: string | undefined;
    for (const selector of priceSelectors) {
      const priceElement = element.querySelector(selector);
      if (priceElement && priceElement.textContent) {
        price = priceElement.textContent.trim();
        if (price.includes('$')) {
          break;
        }
      }
    }

    // Try to extract quantity
    const quantitySelectors = [
      '[class*="quantity"]',
      '[class*="qty"]',
      'input[type="number"]',
      '[data-quantity]'
    ];

    let quantity: number | undefined;
    for (const selector of quantitySelectors) {
      const qtyElement = element.querySelector(selector) as HTMLInputElement;
      if (qtyElement) {
        const qtyValue = qtyElement.value || qtyElement.textContent;
        const parsed = parseInt(qtyValue || '1', 10);
        if (!isNaN(parsed) && parsed > 0) {
          quantity = parsed;
          break;
        }
      }
    }

    return {
      name,
      price,
      quantity
    };
  } catch (error) {
    console.error('Error extracting item:', error);
    return null;
  }
}

/**
 * Extract product name from element
 */
function extractNameFromElement(element: HTMLElement): string | null {
  const textContent = element.textContent?.trim() || '';

  // Look for text before price
  const priceIndex = textContent.indexOf('$');
  if (priceIndex > 0) {
    const beforePrice = textContent.substring(0, priceIndex).trim();
    if (beforePrice.length > 3 && beforePrice.length < 200) {
      return beforePrice;
    }
  }

  // Look for headings or links
  const heading = element.querySelector('h1, h2, h3, h4, a');
  if (heading && heading.textContent) {
    const headingText = heading.textContent.trim();
    if (headingText.length > 3 && headingText.length < 200) {
      return headingText;
    }
  }

  return null;
}
