// Base class for all cart extractors
import type { CartItem, ExtractionResult, ExtractorMetadata } from '../types';

/**
 * Abstract base class for all cart extractors
 *
 * Each site-specific extractor should extend this class and implement:
 * - siteId: Unique identifier for the site
 * - urlPatterns: Array of hostname patterns to match
 * - extract(): Main extraction logic
 */
export abstract class BaseExtractor {
  /** Unique identifier for this extractor (e.g., 'sephora', 'amazon') */
  abstract readonly siteId: string;

  /** Display name for logging (e.g., 'Sephora') */
  abstract readonly displayName: string;

  /** URL patterns to match (e.g., ['sephora.com', 'sephora.ca']) */
  abstract readonly urlPatterns: string[];

  /** Version of this extractor (for debugging) */
  readonly version: string = '1.0.0';

  /**
   * Main extraction method - must be implemented by subclasses
   * @returns Array of extracted cart items
   */
  abstract extract(): CartItem[];

  /**
   * Check if this extractor can handle the given hostname
   * @param hostname - Current page hostname
   * @returns true if this extractor can handle the site
   */
  canHandle(hostname: string): boolean {
    const lowerHostname = hostname.toLowerCase();
    return this.urlPatterns.some(pattern => lowerHostname.includes(pattern.toLowerCase()));
  }

  /**
   * Extract cart items with error handling and timing
   * @returns Extraction result with metadata
   */
  extractWithMetadata(): ExtractionResult {
    const startTime = performance.now();

    try {
      console.log(`[${this.siteId}] Starting extraction using ${this.displayName} extractor v${this.version}`);

      const items = this.extract();
      const duration = performance.now() - startTime;

      console.log(`[${this.siteId}] Extracted ${items.length} items in ${duration.toFixed(2)}ms`);

      return {
        items,
        extractorId: this.siteId,
        success: true,
        duration
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`[${this.siteId}] Extraction failed:`, error);

      return {
        items: [],
        extractorId: this.siteId,
        success: false,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Get metadata about this extractor
   */
  getMetadata(): ExtractorMetadata {
    return {
      siteId: this.siteId,
      displayName: this.displayName,
      urlPatterns: this.urlPatterns,
      version: this.version
    };
  }

  /**
   * Helper: Extract text content from element
   */
  protected extractText(element: Element | null, selector?: string): string | null {
    if (!element) return null;

    const targetElement = selector ? element.querySelector(selector) : element;
    if (!targetElement) return null;

    return targetElement.textContent?.trim() || null;
  }

  /**
   * Helper: Extract quantity from input or select element
   */
  protected extractQuantityFromInput(element: Element | null): number {
    if (!element) return 1;

    if (element instanceof HTMLInputElement) {
      const value = parseInt(element.value, 10);
      return isNaN(value) ? 1 : value;
    }

    if (element instanceof HTMLSelectElement) {
      const value = parseInt(element.value, 10);
      return isNaN(value) ? 1 : value;
    }

    // Try to parse text content
    const text = element.textContent?.trim() || '';
    const value = parseInt(text, 10);
    return isNaN(value) ? 1 : value;
  }

  /**
   * Helper: Deduplicate items by name (case-insensitive)
   */
  protected deduplicateItems(items: CartItem[]): CartItem[] {
    const seen = new Map<string, CartItem>();

    for (const item of items) {
      const key = item.name.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Helper: Validate item before adding to results
   */
  protected isValidItem(item: Partial<CartItem>): item is CartItem {
    return (
      !!item.name &&
      item.name.length >= 3 &&
      item.name.length <= 500 &&
      !this.isNoiseText(item.name)
    );
  }

  /**
   * Helper: Check if text is likely noise (not a product name)
   */
  private isNoiseText(text: string): boolean {
    const noisePatterns = [
      /^(remove|delete|edit|save|quantity|qty|price|total|subtotal|checkout|continue)$/i,
      /^(cart|basket|bag|items?|products?)$/i,
      /^\d+$/, // Just numbers
      /^[\W_]+$/, // Just special characters
    ];

    return noisePatterns.some(pattern => pattern.test(text.trim()));
  }
}
