# Site-Specific Cart Extractors

This document describes the site-specific cart extraction strategies implemented in the extension.

## Overview

The extension uses a **Hybrid Registry Pattern** to extract cart items:

1. **Registry initialization** - All extractors are registered at startup
2. **Automatic site detection** - Registry finds the right extractor (O(1) lookup)
3. **Site-specific extraction** - Uses custom extractor if available
4. **Fallback to generic** - Falls back if no specific extractor found

### Architecture

```
src/content/
├── index.ts                           # Main entry, initializes registry
├── extractors/
│   ├── ExtractorRegistry.ts          # O(1) lookup registry
│   ├── BaseExtractor.ts              # Abstract base class
│   ├── ConfigExtractor.ts            # Config-driven extractor
│   ├── GenericExtractor.ts           # Fallback
│   ├── sites/                         # Custom extractors
│   │   └── SephoraExtractor.ts       # ✅ Implemented
│   ├── configs/
│   │   └── simple-sites.config.ts    # Config for simple sites
│   └── types/
│       └── extractor.types.ts        # Type definitions
```

## Implemented Extractors

### ✅ Sephora (sephora.com)

**Status:** Implemented and tested
**URL Pattern:** `sephora.com/basket`
**Reliability:** Very High (uses stable `data-at` attributes)

**Key Selectors:**
- **Cart item container:** `[data-at="product_refinement"]`
- **Brand:** `[data-at="bsk_sku_brand"]`
- **Product name:** `[data-at="bsk_sku_name"]`
- **Price:** `[data-at="bsk_sku_price"]`
- **Quantity:** `select[data-at="sku_qty"]`

**Example Output:**
```javascript
[
  {
    name: "Summer Fridays The Lip Butter Balm Minis",
    price: "$25.00",
    quantity: 1
  },
  {
    name: "OLEHENRIKSEN Banana Bright+ Instant Glow Moisturizer with Niacinamides and Vitamin C",
    price: "$52.00",
    quantity: 1
  }
]
```

**Notes:**
- Combines brand + product name for full item name
- Handles missing data gracefully
- Quantity extracted from dropdown select element
- Works on both desktop and mobile views (Sephora uses same attributes)

---

## Planned Extractors

### 🔲 Amazon (amazon.com)

**URL Patterns:**
- `amazon.com/cart`
- `amazon.com/gp/cart`

**Key Challenges:**
- Frequently changing CSS classes
- Heavy JavaScript rendering
- Multiple cart types (main cart, saved items)

**Potential Selectors:**
- Cart items: `div[data-name="Active Items"]`
- Product name: `.sc-product-title`
- Price: `.sc-price`

### 🔲 Target (target.com)

**URL Pattern:** `target.com/cart`

**Potential Selectors:**
- Cart items: `[data-test="cartItem"]`
- Product name: `[data-test="cartItem-title"]`
- Price: `[data-test="cartItem-price"]`

### 🔲 Walmart (walmart.com)

**URL Pattern:** `walmart.com/cart`

**Potential Selectors:**
- Cart items: `[data-automation-id="cart-item"]`
- Product name: `[data-automation-id="product-title"]`
- Price: `[data-automation-id="product-price"]`

---

## Generic Extractor

**Used for:** Unknown sites or when site-specific extractor fails

**Strategy:**
1. Search for common cart-related classes/IDs
2. Extract item names from headings, links, or text
3. Extract prices using regex pattern: `/\$\d+(\.\d{2})?/`
4. Extract quantity from input fields or selects

**Selectors:**
- Cart containers: `[id*="cart"], [class*="cart"], [id*="basket"]`, etc.
- Item elements: `li, .cart-item, .product, .line-item`
- Names: `.product-title, .item-title, h2, h3, h4, a`
- Prices: `.price, .product-price, [class*="price"]`
- Quantities: `input[type="number"], select[class*="qty"]`

---

## Adding a New Extractor

### Option A: Config-Driven (Simple Sites) ⭐ Recommended for standard sites

**Time:** ~5 minutes

1. **Research the site's selectors** (DevTools → Inspect cart items)

2. **Add configuration to `simple-sites.config.ts`:**
   ```typescript
   {
     siteId: 'example',
     displayName: 'Example Store',
     urlPatterns: ['example.com'],
     itemSelector: '[data-cart-item]',
     brandSelector: '.brand',        // optional
     nameSelector: '.product-name',
     priceSelector: '.price',        // optional
     quantitySelector: 'input.qty',  // optional
     combineBrandName: true,         // optional (default: true)
   }
   ```

3. **Rebuild and test** - That's it! The registry auto-registers it.

### Option B: Custom Class (Complex Sites)

**Time:** ~20-30 minutes

For sites with complex DOM structures or special logic:

1. **Create new file:** `src/content/extractors/sites/ExampleExtractor.ts`

2. **Extend BaseExtractor:**
   ```typescript
   import { BaseExtractor } from '../BaseExtractor';
   import type { CartItem } from '../../../types';

   export class ExampleExtractor extends BaseExtractor {
     readonly siteId = 'example';
     readonly displayName = 'Example Store';
     readonly urlPatterns = ['example.com'];

     extract(): CartItem[] {
       const items: CartItem[] = [];

       // Custom extraction logic
       const cartItems = document.querySelectorAll('[data-cart-item]');

       cartItems.forEach((item) => {
         const name = this.extractText(item, '.product-name');
         const price = this.extractText(item, '.price');
         const quantity = this.extractQuantityFromInput(
           item.querySelector('input.qty')
         );

         if (name && this.isValidItem({ name })) {
           items.push({ name, price, quantity });
         }
       });

       return this.deduplicateItems(items);
     }
   }
   ```

3. **Register in `content/index.ts`:**
   ```typescript
   import { ExampleExtractor } from './extractors/sites/ExampleExtractor';

   // In initializeExtractors():
   registry.register(new ExampleExtractor());
   ```

4. **Build and test**

### Helper Methods Available in BaseExtractor

- `extractText(element, selector?)` - Extract text content
- `extractQuantityFromInput(element)` - Extract quantity from input/select
- `deduplicateItems(items)` - Remove duplicates
- `isValidItem(item)` - Validate item before adding

---

## Testing Checklist

For each extractor:

- [ ] Detects site correctly
- [ ] Extracts product names accurately
- [ ] Extracts prices (with currency symbol)
- [ ] Extracts quantities correctly
- [ ] Handles empty cart gracefully
- [ ] Handles missing data (price, quantity)
- [ ] Deduplicates identical items
- [ ] Works on mobile view (if different)
- [ ] Logs extraction results to console
- [ ] Falls back to generic if fails

---

## Performance Considerations

- **Minimize DOM queries:** Query once, iterate efficiently
- **Early returns:** Exit if no items found quickly
- **Error handling:** Wrap in try-catch to prevent script crashes
- **Deduplication:** Use Map for O(n) deduplication
- **Limit results:** Cap at 20 items to avoid overwhelming LLM

---

## Best Practices

1. **Prefer `data-*` attributes** over CSS classes (more stable)
2. **Combine brand + product name** for clarity
3. **Clean extracted text** (trim, remove extra whitespace)
4. **Validate before adding** (check name exists, length reasonable)
5. **Log extraction process** for debugging
6. **Handle edge cases** (out of stock, pre-order, etc.)

---

## Debug Commands

Test extraction in browser console:

```javascript
// Test Sephora
window.__CC_extractCartItems()

// Check detection
window.location.hostname

// Manual test
document.querySelectorAll('[data-at="product_refinement"]')
```

---

## Changelog

### 2024-10-03 (v2 - Registry Pattern)
- ✅ **Implemented Hybrid Registry Pattern**
  - Created ExtractorRegistry with O(1) lookup
  - Created BaseExtractor abstract class
  - Created ConfigExtractor for simple sites
  - Created GenericExtractor as fallback
- ✅ **Migrated Sephora to SephoraExtractor class**
- ✅ **Added simple-sites.config.ts** for config-driven extractors
- ✅ **Improved architecture** - Now scalable to 100+ sites
- ✅ **Reduced time to add new site** from 30 min → 5 min (config) or 20 min (custom)
- 📊 **Bundle size impact:** +6KB for registry infrastructure (12.68KB total for content script)

### 2024-10-03 (v1 - Initial)
- ✅ Implemented Sephora extractor (function-based)
- ✅ Added site detection strategy pattern
- ✅ Refactored generic extractor as fallback
- 📝 Created documentation

### Future
- 🔲 Amazon extractor (custom class)
- 🔲 Target extractor (config or custom)
- 🔲 Walmart extractor (config or custom)
- 🔲 Best Buy extractor (config)
- 🔲 Ulta extractor (config)
- 🔲 Performance metrics and monitoring
- 🔲 A/B testing framework for extractors
