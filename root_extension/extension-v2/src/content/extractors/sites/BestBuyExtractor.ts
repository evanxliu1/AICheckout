// Best Buy-specific cart extractor
import { BaseExtractor } from '../BaseExtractor';
import type { CartItem } from '../../../types';

/**
 * Best Buy extractor
 *
 * Uses Best Buy's semantic class names and data attributes for reliable extraction.
 * Tested on bestbuy.com/cart with desktop view.
 *
 * Key selectors:
 * - Cart container: ul.item-list
 * - Cart items: section.card (within .item-list li)
 * - Product name: h2.cart-item__title-heading > a.cart-item__title
 * - Price: .fluid-item__price .price-block__primary-price .price-block__inline
 * - Quantity: select.tb-select (within .fluid-item__quantity)
 * - Data attributes: data-test-sku, data-test-lineitemid (for debugging)
 */
export class BestBuyExtractor extends BaseExtractor {
  readonly siteId = 'bestbuy';
  readonly displayName = 'Best Buy';
  readonly urlPatterns = ['bestbuy.com', 'bestbuy.ca'];
  readonly version = '1.0.0';

  extract(): CartItem[] {
    const items: CartItem[] = [];

    // Try multiple selector strategies for Best Buy
    let cartItems = document.querySelectorAll('ul.item-list > li > section.card');

    // Fallback: try less specific selectors
    if (cartItems.length === 0) {
      console.log('[BestBuy] Primary selector failed, trying fallback: section.card');
      cartItems = document.querySelectorAll('section.card');
    }

    if (cartItems.length === 0) {
      console.log('[BestBuy] Fallback selector failed, trying: .fluid-item');
      cartItems = document.querySelectorAll('.fluid-item');
    }

    if (cartItems.length === 0) {
      console.warn('[BestBuy] No cart items found with any selector. User may have empty cart or page structure changed.');
      console.log('[BestBuy] Debug info:', {
        hasItemList: !!document.querySelector('ul.item-list'),
        hasSectionCard: !!document.querySelector('section.card'),
        hasFluidItem: !!document.querySelector('.fluid-item'),
        url: window.location.href
      });
      return items;
    }

    console.log(`[BestBuy] Found ${cartItems.length} cart items`);

    cartItems.forEach((item, index) => {
      try {
        const cartItem = this.extractBestBuyItem(item);
        if (cartItem && this.isValidItem(cartItem)) {
          items.push(cartItem);
          console.log(`[BestBuy] Extracted item ${index + 1}:`, cartItem.name);
        }
      } catch (error) {
        console.error(`[BestBuy] Error extracting item ${index + 1}:`, error);
      }
    });

    return this.deduplicateItems(items);
  }

  /**
   * Extract a single Best Buy cart item
   */
  private extractBestBuyItem(element: Element): CartItem | null {
    // Product name: Try multiple selectors
    let productName = this.extractText(element, 'h2.cart-item__title-heading > a.cart-item__title');

    // Fallback: try just the link
    if (!productName) {
      productName = this.extractText(element, 'a.cart-item__title');
    }

    // Fallback: try h2 directly
    if (!productName) {
      productName = this.extractText(element, 'h2.cart-item__title-heading');
    }

    if (!productName) {
      console.warn('[BestBuy] Could not extract product name, tried multiple selectors');
      console.log('[BestBuy] Element HTML preview:', element.innerHTML.substring(0, 200));
      return null;
    }

    // Price: Try multiple selectors
    let price = this.extractText(
      element,
      '.fluid-item__price .price-block__primary-price .price-block__inline'
    );

    // Fallback: try without the inline class
    if (!price) {
      price = this.extractText(element, '.price-block__primary-price');
    }

    // Quantity: select.tb-select within .fluid-item__quantity
    const quantity = this.extractBestBuyQuantity(element);

    const item: CartItem = { name: productName.trim() };
    if (price) item.price = price.trim();
    if (quantity) item.quantity = quantity;

    return item;
  }

  /**
   * Extract quantity from Best Buy's quantity selector
   */
  private extractBestBuyQuantity(element: Element): number {
    // Find the quantity select element
    const quantitySelect = element.querySelector('.fluid-item__quantity select.tb-select');

    if (quantitySelect) {
      const qty = this.extractQuantityFromInput(quantitySelect);
      return qty;
    }

    return 1; // Default quantity if not found
  }
}
