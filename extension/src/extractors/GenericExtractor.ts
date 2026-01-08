// Generic fallback extractor for unknown e-commerce sites
import { BaseExtractor } from './BaseExtractor';
import type { CartItem } from '../types';

/**
 * Generic cart extractor - fallback for sites without specific extractors
 *
 * Uses common patterns and selectors to attempt extraction from any e-commerce site
 * Success rate varies but generally works on standard shopping cart implementations
 */
export class GenericExtractor extends BaseExtractor {
  readonly siteId = 'generic';
  readonly displayName = 'Generic (Fallback)';
  readonly urlPatterns = ['*']; // Matches all sites

  extract(): CartItem[] {
    console.log('[Generic] Using generic cart extraction strategy');

    const items: CartItem[] = [];

    // Strategy 1: Common cart selectors
    const cartItems = this.findItemsInCartContainers();
    if (cartItems.length > 0) {
      items.push(...cartItems);
    }

    // Strategy 2: Fallback - find elements with prices
    if (items.length === 0) {
      const fallbackItems = this.findItemsByPricePattern();
      items.push(...fallbackItems);
    }

    // Deduplicate and limit
    const uniqueItems = this.deduplicateItems(items);
    return uniqueItems.slice(0, 20); // Limit to 20 items
  }

  /**
   * Strategy 1: Look for items in common cart container selectors
   */
  private findItemsInCartContainers(): CartItem[] {
    const items: CartItem[] = [];

    const cartSelectors = [
      '[id*="cart"]',
      '[class*="cart"]',
      '[id*="basket"]',
      '[class*="basket"]',
      '[id*="checkout"]',
      '[class*="checkout"]',
      '[id*="bag"]',
      '[class*="bag"]',
      '[data-test*="cart"]',
      '[data-testid*="cart"]'
    ];

    for (const selector of cartSelectors) {
      const containers = document.querySelectorAll(selector);

      containers.forEach((container) => {
        // Look for items within container
        const itemElements = container.querySelectorAll(
          'li, .cart-item, .product, .line-item, [class*="item"], [class*="product"]'
        );

        itemElements.forEach((item) => {
          const name = this.extractItemName(item as HTMLElement);
          if (name) {
            const price = this.extractPrice(item as HTMLElement);
            const quantity = this.extractQuantity(item as HTMLElement);

            const cartItem: CartItem = { name };
            if (price) cartItem.price = price;
            if (quantity) cartItem.quantity = quantity;

            if (this.isValidItem(cartItem)) {
              items.push(cartItem);
            }
          }
        });
      });
    }

    return items;
  }

  /**
   * Strategy 2: Fallback - find elements containing price patterns
   */
  private findItemsByPricePattern(): CartItem[] {
    const items: CartItem[] = [];
    const pricePattern = /\$\d+(\.\d{2})?/;

    const candidates = document.querySelectorAll(
      'li, .product, .cart-item, .line-item, div[class*="item"], div[class*="product"]'
    );

    candidates.forEach((element) => {
      const text = element.textContent || '';

      // Must contain a price and be reasonably sized
      if (pricePattern.test(text) && text.length < 300) {
        const name = this.extractItemName(element as HTMLElement);

        if (name && name.length > 3 && name.length < 200) {
          const price = text.match(pricePattern)?.[0];
          const cartItem: CartItem = { name };
          if (price) cartItem.price = price;

          if (this.isValidItem(cartItem)) {
            items.push(cartItem);
          }
        }
      }
    });

    return items;
  }

  /**
   * Extract item name from element using common selectors
   */
  private extractItemName(element: HTMLElement): string | null {
    // Try specific selectors first
    const nameSelectors = [
      '.product-title',
      '.item-title',
      '.product-name',
      '.name',
      '[class*="title"]',
      '[class*="name"]',
      '[data-test*="name"]',
      '[data-testid*="name"]',
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
      const lines = text.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        const firstLine = lines[0].trim();
        if (firstLine.length > 3 && firstLine.length < 200) {
          return firstLine;
        }
      }
    }

    return null;
  }

  /**
   * Extract price from element
   */
  private extractPrice(element: HTMLElement): string | undefined {
    const priceSelectors = [
      '.price',
      '.product-price',
      '[class*="price"]',
      '[data-price]',
      '[data-test*="price"]',
      '[data-testid*="price"]'
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
  private extractQuantity(element: HTMLElement): number | undefined {
    const quantitySelectors = [
      '[class*="quantity"]',
      '[class*="qty"]',
      'input[type="number"]',
      '[data-quantity]',
      '[data-test*="quantity"]',
      '[data-testid*="quantity"]'
    ];

    for (const selector of quantitySelectors) {
      const qtyElement = element.querySelector(selector);
      if (qtyElement) {
        const qty = this.extractQuantityFromInput(qtyElement);
        if (qty > 0) {
          return qty;
        }
      }
    }

    return undefined;
  }

  /**
   * Override canHandle to always return false (only used as fallback)
   */
  canHandle(hostname: string): boolean {
    return false; // Never auto-selected, only used as fallback
  }
}
