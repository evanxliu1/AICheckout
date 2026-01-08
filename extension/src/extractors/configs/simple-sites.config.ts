// Configuration for simple config-driven extractors
import type { ExtractorConfig } from '../../types';

/**
 * Simple site configurations
 *
 * For sites with standard DOM structures, you can add support by just
 * configuring selectors here - no custom code needed!
 *
 * To add a new site:
 * 1. Research the site's cart page selectors
 * 2. Add configuration object below
 * 3. Rebuild extension - that's it!
 */
export const SIMPLE_SITE_CONFIGS: ExtractorConfig[] = [
  // Example: Ulta Beauty (placeholder - needs actual selectors)
  {
    siteId: 'ulta',
    displayName: 'Ulta Beauty',
    urlPatterns: ['ulta.com'],
    itemSelector: '[data-test="cart-item"]', // TODO: Verify actual selector
    brandSelector: '.product-brand', // TODO: Verify
    nameSelector: '.product-name', // TODO: Verify
    priceSelector: '.product-price', // TODO: Verify
    quantitySelector: 'input.quantity', // TODO: Verify
    combineBrandName: true
  },

  // NOTE: Best Buy now uses a custom extractor (BestBuyExtractor.ts)
  // Removed config-based entry to avoid conflicts

  // Add more sites here as needed
  // Example template:
  // {
  //   siteId: 'sitename',
  //   displayName: 'Site Display Name',
  //   urlPatterns: ['example.com'],
  //   itemSelector: '[data-cart-item]',
  //   brandSelector: '.brand',     // optional
  //   nameSelector: '.product-name',
  //   priceSelector: '.price',     // optional
  //   quantitySelector: 'input.qty', // optional
  //   combineBrandName: true,      // optional (default: true)
  // },
];

/**
 * Get config by site ID
 */
export function getConfigBySiteId(siteId: string): ExtractorConfig | null {
  return SIMPLE_SITE_CONFIGS.find(config => config.siteId === siteId) || null;
}

/**
 * Check if a site has a config
 */
export function hasConfig(siteId: string): boolean {
  return SIMPLE_SITE_CONFIGS.some(config => config.siteId === siteId);
}
