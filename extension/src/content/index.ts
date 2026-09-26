// Injected into Chrome's isolated world after user activation.
import type { CartItem } from '../types';
import { getRegistry } from '../extractors/ExtractorRegistry';
import { GenericExtractor } from '../extractors/GenericExtractor';
import { SephoraExtractor } from '../extractors/sites/SephoraExtractor';
import { SafewayExtractor } from '../extractors/sites/SafewayExtractor';
import { BestBuyExtractor } from '../extractors/sites/BestBuyExtractor';

declare global {
  interface Window {
    __CC_extractCartItems?: () => CartItem[];
  }
}

if (!window.__CC_extractCartItems) {
  const registry = getRegistry();
  registry.register(new SephoraExtractor());
  registry.register(new SafewayExtractor());
  registry.register(new BestBuyExtractor());
  registry.setFallback(new GenericExtractor());
  window.__CC_extractCartItems = () => registry.extractItems(window.location.hostname);
}
