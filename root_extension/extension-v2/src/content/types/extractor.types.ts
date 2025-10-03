// Type definitions for cart extractors
import type { CartItem } from '../../types';

/**
 * Configuration for simple config-driven extractors
 */
export interface ExtractorConfig {
  /** Unique site identifier */
  siteId: string;

  /** URL patterns to match (e.g., ['sephora.com', 'sephora.ca']) */
  urlPatterns: string[];

  /** Display name for logging */
  displayName: string;

  /** CSS selector for cart item containers */
  itemSelector: string;

  /** CSS selector for product brand (optional) */
  brandSelector?: string;

  /** CSS selector for product name */
  nameSelector: string;

  /** CSS selector for price */
  priceSelector?: string;

  /** CSS selector for quantity */
  quantitySelector?: string;

  /**
   * Whether to combine brand + name
   * @default true
   */
  combineBrandName?: boolean;

  /**
   * Custom name extraction function (for complex cases)
   */
  customNameExtractor?: (element: Element) => string | null;

  /**
   * Custom price extraction function (for complex cases)
   */
  customPriceExtractor?: (element: Element) => string | null;

  /**
   * Custom quantity extraction function (for complex cases)
   */
  customQuantityExtractor?: (element: Element) => number | null;
}

/**
 * Result of extraction with metadata
 */
export interface ExtractionResult {
  /** Extracted items */
  items: CartItem[];

  /** Extractor that was used */
  extractorId: string;

  /** Whether extraction was successful */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Extraction time in milliseconds */
  duration?: number;
}

/**
 * Extractor metadata
 */
export interface ExtractorMetadata {
  siteId: string;
  displayName: string;
  urlPatterns: string[];
  version?: string;
  author?: string;
}
