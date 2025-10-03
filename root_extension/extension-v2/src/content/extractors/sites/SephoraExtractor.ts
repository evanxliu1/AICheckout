// Sephora-specific cart extractor
import { BaseExtractor } from '../BaseExtractor';
import type { CartItem } from '../../../types';

/**
 * Sephora extractor
 *
 * Uses Sephora's stable data-at attributes for reliable extraction.
 * Tested on sephora.com/basket with desktop and mobile views.
 *
 * Key selectors:
 * - Cart items: [data-at="product_refinement"]
 * - Brand: [data-at="bsk_sku_brand"]
 * - Product name: [data-at="bsk_sku_name"]
 * - Price: [data-at="bsk_sku_price"]
 * - Quantity: select[data-at="sku_qty"]
 */
export class SephoraExtractor extends BaseExtractor {
  readonly siteId = 'sephora';
  readonly displayName = 'Sephora';
  readonly urlPatterns = ['sephora.com', 'sephora.ca'];
  readonly version = '1.0.0';

  extract(): CartItem[] {
    const items: CartItem[] = [];

    // Sephora uses data-at="product_refinement" for cart items
    const cartItems = document.querySelectorAll('[data-at="product_refinement"]');

    if (cartItems.length === 0) {
      console.warn('[Sephora] No cart items found. User may have empty cart or page structure changed.');
      return items;
    }

    cartItems.forEach((item, index) => {
      try {
        const cartItem = this.extractSephoraItem(item);
        if (cartItem && this.isValidItem(cartItem)) {
          items.push(cartItem);
        }
      } catch (error) {
        console.error(`[Sephora] Error extracting item ${index + 1}:`, error);
      }
    });

    return this.deduplicateItems(items);
  }

  /**
   * Extract a single Sephora cart item
   */
  private extractSephoraItem(element: Element): CartItem | null {
    // Brand: data-at="bsk_sku_brand"
    const brand = this.extractText(element, '[data-at="bsk_sku_brand"]');

    // Product name: data-at="bsk_sku_name"
    const productName = this.extractText(element, '[data-at="bsk_sku_name"]');

    // Combine brand + product name for full name
    const fullName = this.buildFullName(brand, productName);
    if (!fullName) {
      return null;
    }

    // Price: data-at="bsk_sku_price"
    const price = this.extractText(element, '[data-at="bsk_sku_price"]');

    // Quantity: select with data-at="sku_qty"
    const quantity = this.extractSephoraQuantity(element);

    const item: CartItem = { name: fullName };
    if (price) item.price = price;
    if (quantity) item.quantity = quantity;

    return item;
  }

  /**
   * Build full product name from brand and product name
   */
  private buildFullName(brand: string | null, productName: string | null): string | null {
    if (brand && productName) {
      return `${brand} ${productName}`.trim();
    }
    return productName || brand;
  }

  /**
   * Extract quantity from Sephora's quantity selector
   */
  private extractSephoraQuantity(element: Element): number {
    const quantitySelect = element.querySelector('select[data-at="sku_qty"]');

    if (quantitySelect) {
      const qty = this.extractQuantityFromInput(quantitySelect);
      return qty;
    }

    return 1; // Default quantity
  }
}
