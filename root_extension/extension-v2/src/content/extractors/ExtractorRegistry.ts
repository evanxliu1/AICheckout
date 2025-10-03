// Registry for managing cart extractors with O(1) lookup
import type { BaseExtractor } from './BaseExtractor';
import type { CartItem } from '../../types';
import type { ExtractionResult } from '../types/extractor.types';

/**
 * Registry for managing and selecting cart extractors
 *
 * Features:
 * - O(1) lookup by site ID
 * - Automatic site detection
 * - Fallback to generic extractor
 * - Thread-safe singleton pattern
 */
export class ExtractorRegistry {
  /** Map of site ID -> extractor for O(1) lookup */
  private extractors = new Map<string, BaseExtractor>();

  /** Fallback extractor for unknown sites */
  private fallbackExtractor: BaseExtractor | null = null;

  /** Singleton instance */
  private static instance: ExtractorRegistry | null = null;

  /** Private constructor for singleton */
  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): ExtractorRegistry {
    if (!ExtractorRegistry.instance) {
      ExtractorRegistry.instance = new ExtractorRegistry();
    }
    return ExtractorRegistry.instance;
  }

  /**
   * Register an extractor
   * @param extractor - Extractor instance to register
   */
  register(extractor: BaseExtractor): void {
    if (this.extractors.has(extractor.siteId)) {
      console.warn(`[Registry] Overwriting existing extractor: ${extractor.siteId}`);
    }

    this.extractors.set(extractor.siteId, extractor);
    console.log(`[Registry] Registered extractor: ${extractor.displayName} (${extractor.siteId})`);
  }

  /**
   * Register multiple extractors at once
   * @param extractors - Array of extractors to register
   */
  registerAll(extractors: BaseExtractor[]): void {
    extractors.forEach(extractor => this.register(extractor));
  }

  /**
   * Set the fallback extractor for unknown sites
   * @param extractor - Generic extractor to use as fallback
   */
  setFallback(extractor: BaseExtractor): void {
    this.fallbackExtractor = extractor;
    console.log(`[Registry] Set fallback extractor: ${extractor.displayName}`);
  }

  /**
   * Get extractor by site ID (O(1) lookup)
   * @param siteId - Site identifier
   * @returns Extractor or null if not found
   */
  getById(siteId: string): BaseExtractor | null {
    return this.extractors.get(siteId) || null;
  }

  /**
   * Find extractor for the given hostname
   * @param hostname - Current page hostname
   * @returns Best matching extractor or fallback
   */
  findExtractor(hostname: string): BaseExtractor {
    // Try to find a matching extractor
    for (const extractor of this.extractors.values()) {
      if (extractor.canHandle(hostname)) {
        console.log(`[Registry] Found extractor for ${hostname}: ${extractor.siteId}`);
        return extractor;
      }
    }

    // Fallback to generic extractor
    if (this.fallbackExtractor) {
      console.log(`[Registry] Using fallback extractor for ${hostname}`);
      return this.fallbackExtractor;
    }

    throw new Error('No fallback extractor registered!');
  }

  /**
   * Extract cart items for the current page
   * @param hostname - Current page hostname (defaults to window.location.hostname)
   * @returns Extraction result with metadata
   */
  extract(hostname: string = window.location.hostname): ExtractionResult {
    const extractor = this.findExtractor(hostname);
    return extractor.extractWithMetadata();
  }

  /**
   * Extract cart items (simplified - returns just the items)
   * @param hostname - Current page hostname
   * @returns Array of cart items
   */
  extractItems(hostname: string = window.location.hostname): CartItem[] {
    const result = this.extract(hostname);
    return result.items;
  }

  /**
   * Get all registered extractors
   * @returns Array of all registered extractors
   */
  getAllExtractors(): BaseExtractor[] {
    return Array.from(this.extractors.values());
  }

  /**
   * Get list of supported sites
   * @returns Array of site IDs
   */
  getSupportedSites(): string[] {
    return Array.from(this.extractors.keys());
  }

  /**
   * Check if a site is supported
   * @param hostname - Hostname to check
   * @returns true if site has a specific extractor
   */
  isSupported(hostname: string): boolean {
    for (const extractor of this.extractors.values()) {
      if (extractor.canHandle(hostname)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get extractor info for debugging
   * @returns Object with registry statistics
   */
  getInfo(): {
    registered: number;
    sites: string[];
    hasFallback: boolean;
  } {
    return {
      registered: this.extractors.size,
      sites: this.getSupportedSites(),
      hasFallback: !!this.fallbackExtractor
    };
  }

  /**
   * Unregister an extractor
   * @param siteId - Site ID to unregister
   * @returns true if extractor was removed
   */
  unregister(siteId: string): boolean {
    return this.extractors.delete(siteId);
  }

  /**
   * Clear all registered extractors
   */
  clear(): void {
    this.extractors.clear();
    this.fallbackExtractor = null;
    console.log('[Registry] Cleared all extractors');
  }

  /**
   * Reset to a fresh state (useful for testing)
   */
  static reset(): void {
    ExtractorRegistry.instance = null;
  }
}

/**
 * Get the global registry instance
 * Convenience function for easier imports
 */
export function getRegistry(): ExtractorRegistry {
  return ExtractorRegistry.getInstance();
}
