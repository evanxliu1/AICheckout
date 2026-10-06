// Platform group detection (docs/evals/generic-reader-protocol.md#platform-detection). Runs over the captured HTML
// and main-document headers of a fixed set of a site's states (platformStates: `empty-cart` and the first captured
// cart state). Operator `view-NN` pages, `terms`, later states and reconnaissance pages are never read. Since
// protocol .5 no checkout page is entered, so the checkout-host marker is gone. The first group that matches wins, and
// the matched marker is recorded. Next.js and similar frameworks are not platforms.

const GROUPS = [
  {
    group: 'shopify',
    html: [
      ['cdn.shopify.com', /cdn\.shopify\.com/i],
      ['Shopify.shop', /Shopify\.shop\b/],
    ],
  },
  {
    group: 'sfcc',
    html: [
      ['/on/demandware.store/', /\/on\/demandware\.store\//i],
      ['demandware.static', /demandware\.static/i],
      ['dwvar_', /dwvar_/],
    ],
  },
  {
    group: 'adobe-commerce',
    html: [['Magento_', /Magento_[A-Z]/]],
    header: [['x-magento-*', /^x-magento-/i]],
  },
  { group: 'sap-commerce', html: [['/_ui/ with ACC. or hybris', null]] },
  {
    group: 'bigcommerce',
    html: [
      ['cdn11.bigcommerce.com', /cdn11\.bigcommerce\.com/i],
      ['bigcommerce.com/s-', /bigcommerce\.com\/s-/i],
    ],
  },
  {
    group: 'other-detected',
    html: [
      ['woocommerce', /woocommerce/i],
      ['vtex', /vtex(assets|commercestable|\.com)/i],
      ['wix-ecommerce', /wix-?ecommerce|wixstores/i],
      ['squarespace-commerce', /squarespace[^"']{0,40}commerce|commerce[^"']{0,40}squarespace/i],
      ['atg', /\/atg\/(commerce|userprofiling|dynamo)\//i],
      ['shopware', /\/bundles\/storefront\//i],
      ['prestashop', /prestashop/i],
      ['cafe24', /cafe24/i],
      ['makeshop', /makeshop/i],
    ],
  },
];

/**
 * The snapshots platform detection reads: `empty-cart` and the first captured cart state (`cart-1`, or `minicart-1`
 * when `cart-1` was not captured). Nothing else, whatever else the session captured.
 */
export function platformStates(snapshots) {
  const by = (state) => snapshots.find((s) => s.state === state);
  const cart = by('cart-1') ?? by('minicart-1');
  return [by('empty-cart'), cart].filter(Boolean);
}

const sap = (html) => /\/_ui\//.test(html) && (/\bACC\./.test(html) || /hybris/i.test(html));

/**
 * pages: [{ html: string, headers: { [name]: value } }]. Returns { group, marker }.
 */
export function detectPlatform(pages) {
  for (const { group, html = [], header = [] } of GROUPS) {
    for (const page of pages) {
      if (group === 'sap-commerce') {
        if (sap(page.html)) return { group, marker: html[0][0] };
        continue;
      }
      for (const [marker, re] of html) if (re.test(page.html)) return { group, marker };
      for (const [marker, re] of header)
        if (Object.keys(page.headers ?? {}).some((k) => re.test(k))) return { group, marker };
    }
  }
  return { group: 'none-detected', marker: null };
}
