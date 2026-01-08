// Config-driven extractor for simple e-commerce sites
import { BaseExtractor } from './BaseExtractor';
import type { CartItem, ExtractorConfig } from '../types';

/**
 * Config-driven extractor for simple sites
 *
 * Allows adding new sites via configuration without writing custom code.
 * Perfect for sites with standard DOM structures and stable selectors.
 *
 * Example usage:
 * ```typescript
 * const config: ExtractorConfig = {
 *   siteId: 'ulta',
 *   displayName: 'Ulta Beauty',
 *   urlPatterns: ['ulta.com'],
 *   itemSelector: '[data-test="cart-item"]',
 *   nameSelector: '.product-name',
 *   priceSelector: '.product-price',
 *   quantitySelector: 'input.quantity'
 * };
 * const extractor = new ConfigExtractor(config);
 * ```
 */
export class ConfigExtractor extends BaseExtractor {
  private config: ExtractorConfig;

  readonly siteId: string;
  readonly displayName: string;
  readonly urlPatterns: string[];

  constructor(config: ExtractorConfig) {
    super();
    this.config = config;
    this.siteId = config.siteId;
    this.displayName = config.displayName;
    this.urlPatterns = config.urlPatterns;
  }

  extract(): CartItem[] {
    const items: CartItem[] = [];

    // Find all cart item elements
    const itemElements = document.querySelectorAll(this.config.itemSelector);

    if (itemElements.length === 0) {
      console.warn(`[${this.siteId}] No items found with selector: ${this.config.itemSelector}`);
      return items;
    }

    console.log(`[${this.siteId}] Found ${itemElements.length} potential items`);

    itemElements.forEach((element) => {
      try {
        const item = this.extractItem(element);
        if (item && this.isValidItem(item)) {
          items.push(item);
        }
      } catch (error) {
        console.error(`[${this.siteId}] Error extracting item:`, error);
      }
    });

    return this.deduplicateItems(items);
  }

  /**
   * Extract a single cart item from an element
   */
  private extractItem(element: Element): CartItem | null {
    // Extract name
    let name: string | null = null;

    if (this.config.customNameExtractor) {
      // Use custom extractor if provided
      name = this.config.customNameExtractor(element);
    } else {
      // Use configured selectors
      const brandText = this.config.brandSelector
        ? this.extractText(element, this.config.brandSelector)
        : null;

      const nameText = this.extractText(element, this.config.nameSelector);

      // Combine brand + name if both exist and combineBrandName is true (default)
      const shouldCombine = this.config.combineBrandName !== false;
      if (brandText && nameText && shouldCombine) {
        name = `${brandText} ${nameText}`.trim();
      } else {
        name = nameText || brandText;
      }
    }

    if (!name) {
      return null;
    }

    // Extract price
    let price: string | undefined;
    if (this.config.customPriceExtractor) {
      const priceValue = this.config.customPriceExtractor(element);
      price = priceValue || undefined;
    } else if (this.config.priceSelector) {
      price = this.extractText(element, this.config.priceSelector) || undefined;
    }

    // Extract quantity
    let quantity: number | undefined;
    if (this.config.customQuantityExtractor) {
      const qtyValue = this.config.customQuantityExtractor(element);
      quantity = qtyValue || undefined;
    } else if (this.config.quantitySelector) {
      const qtyElement = element.querySelector(this.config.quantitySelector);
      if (qtyElement) {
        quantity = this.extractQuantityFromInput(qtyElement);
      }
    }

    const item: CartItem = { name };
    if (price) item.price = price;
    if (quantity) item.quantity = quantity;

    return item;
  }

  /**
   * Get the configuration used by this extractor
   */
  getConfig(): ExtractorConfig {
    return { ...this.config };
  }
}

/**
 * Create multiple config extractors from an array of configs
 */
export function createConfigExtractors(configs: ExtractorConfig[]): ConfigExtractor[] {
  return configs.map(config => new ConfigExtractor(config));
}
