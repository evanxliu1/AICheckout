// Platform group detection (docs/evals/generic-reader-protocol.md#platform-detection). Runs over the captured HTML
// and main-document headers of every state of a site, and its checkout host. The first group that matches wins, and
// the matched marker is recorded. Next.js and similar frameworks are not platforms. A `/checkouts/` path counts only
// on a Shopify-marked host, so it never decides on its own: the host's HTML markers already match `shopify`.

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
    ],
  },
];

const sap = (html) => /\/_ui\//.test(html) && (/\bACC\./.test(html) || /hybris/i.test(html));

/**
 * pages: [{ html: string, headers: { [name]: value } }], checkoutUrl: string|null (the checkout-1 URL, if any).
 * Returns { group, marker }.
 */
export function detectPlatform(pages, checkoutUrl = null) {
  if (checkoutUrl) {
    const u = new URL(checkoutUrl);
    if (u.hostname === 'checkout.shopify.com') return { group: 'shopify', marker: 'checkout.shopify.com' };
  }
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
