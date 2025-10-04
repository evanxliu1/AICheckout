// Safeway-specific cart extractor
import { BaseExtractor } from '../BaseExtractor';
import type { CartItem } from '../../../types';

/**
 * Safeway extractor
 *
 * Extracts cart items from Safeway grocery cart.
 * Also works for Albertsons family stores (same platform).
 *
 * Key selectors:
 * - Cart container: app-cart-item (Angular component)
 * - Product ID: id="product-{productId}"
 * - Product name: a.product-name
 * - Price: b.main-netAmount
 * - Quantity: .stepper-amount > span (text content)
 */
export class SafewayExtractor extends BaseExtractor {
  readonly siteId = 'safeway';
  readonly displayName = 'Safeway';
  readonly urlPatterns = ['safeway.com', 'albertsons.com', 'vons.com', 'jewelosco.com'];
  readonly version = '1.0.0';

  extract(): CartItem[] {
    const items: CartItem[] = [];

    // Safeway uses Angular <app-cart-item> components
    const cartItems = document.querySelectorAll('app-cart-item');

    if (cartItems.length === 0) {
      console.warn('[Safeway] No cart items found. User may have empty cart or page structure changed.');
      return items;
    }

    console.log(`[Safeway] Found ${cartItems.length} cart items`);

    cartItems.forEach((item, index) => {
      try {
        const cartItem = this.extractSafewayItem(item);
        if (cartItem && this.isValidItem(cartItem)) {
          items.push(cartItem);
        }
      } catch (error) {
        console.error(`[Safeway] Error extracting item ${index + 1}:`, error);
      }
    });

    return this.deduplicateItems(items);
  }

  /**
   * Extract a single Safeway cart item
   */
  private extractSafewayItem(element: Element): CartItem | null {
    // Product name: <a class="product-name">
    const productName = this.extractText(element, 'a.product-name');

    if (!productName) {
      console.warn('[Safeway] No product name found for item');
      return null;
    }

    // Price: <b class="main-netAmount">
    const price = this.extractText(element, 'b.main-netAmount');

    // Quantity: Safeway uses a stepper with quantity in .stepper-amount > span
    const quantity = this.extractSafewayQuantity(element);

    const item: CartItem = { name: productName };
    if (price) item.price = price;
    if (quantity) item.quantity = quantity;

    return item;
  }

  /**
   * Extract quantity from Safeway's quantity stepper
   */
  private extractSafewayQuantity(element: Element): number {
    // Try desktop quantity: .stepper-amount > span
    const stepperAmount = element.querySelector('.stepper-amount');
    if (stepperAmount) {
      const quantityText = stepperAmount.textContent?.trim().replace(/[^0-9]/g, '');
      const qty = quantityText ? parseInt(quantityText, 10) : null;
      if (qty && qty > 0) {
        return qty;
      }
    }

    // Try mobile quantity: .stepper-qty-round
    const mobileQty = element.querySelector('.stepper-qty-round');
    if (mobileQty) {
      const quantityText = mobileQty.textContent?.trim().replace(/[^0-9]/g, '');
      const qty = quantityText ? parseInt(quantityText, 10) : null;
      if (qty && qty > 0) {
        return qty;
      }
    }

    // Fallback: try any input with type="number"
    const quantityInput = element.querySelector('input[type="number"]');
    if (quantityInput) {
      const qty = this.extractQuantityFromInput(quantityInput);
      if (qty > 0) {
        return qty;
      }
    }

    return 1; // Default quantity
  }
}
