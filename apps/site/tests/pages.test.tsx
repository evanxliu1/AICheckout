import { expect, it } from 'vitest';
import { PAGES } from '../src/Layout';
import { renderPage } from '../src/render';
import { CARD_COUNT, ISSUERS } from '../src/pages';
import { CATALOG_V3 } from '../../../packages/rewards-core/src/catalog-v3';

const rendered = PAGES.map((page) => ({ ...page, ...renderPage(page.id) }));

it('renders every page with one h1, a title, a description and the current page marked', () => {
  for (const page of rendered) {
    expect(page.body.match(/<h1[ >]/g), page.id).toHaveLength(1);
    expect(page.head).toMatch(/<title>[^<]+<\/title><meta name="description" content="[^"]+" \/>/);
    expect(page.body).toContain(`href="${page.path}" aria-current="page"`);
    expect(page.body.match(/aria-current="page"/g)).toHaveLength(1);
  }
});

it('needs nothing the site CSP forbids: no inline styles, scripts, handlers or remote resources', () => {
  for (const page of rendered) {
    expect(page.body).not.toMatch(/ style=|<style|<script|\son[a-z]+=/i);
    expect(page.body).not.toMatch(/<(img|link|iframe)[^>]+(src|href)="https?:/i);
  }
});

it('keeps the results page honest about what the numbers are', () => {
  const results = rendered.find((page) => page.id === 'results')!.body;
  for (const text of [
    'agent-verified, not human-verified',
    'n=7',
    '±3 points',
    'Opus and gpt-5.6-luna were added after',
    'Limitations',
    'docs/evals/results.md',
    'href="/results/results.svg"',
    'href="/results/results-heldout.svg"',
  ])
    expect(results).toContain(text);
  expect(results.match(/<table/g)).toHaveLength(3);
  // The expansion section names the less biased number, the 7-card comparison and the upper bound.
  for (const text of [
    'Expansion: 173 cards',
    'gpt-5.5 (low) at 76.2% end to end',
    '97.5% for the same configuration on the seven-card held-out split',
    'not directly comparable',
    'agent-verified, one repeat',
    'is an upper bound, not an accuracy measure',
    'href="/results/expansion.json"',
    'docs/evals/expansion.md',
  ])
    expect(results).toContain(text);
  expect(results.match(/class="chart"/g)).toHaveLength(2);
});

it('states on the privacy page that only the catalog request leaves the device and there are no analytics', () => {
  const privacy = rendered.find((page) => page.id === 'privacy')!.body;
  expect(privacy).toContain('Only a request for the card catalog.');
  expect(privacy).toContain('No analytics, tracking or advertising.');
  for (const merchant of ['Amazon US', 'Best Buy US', 'Newegg US']) expect(privacy).toContain(merchant);
  expect(privacy).toMatch(/encrypt it with a\s+key derived from a passphrase/);
  // The request depends on the build, and its metadata, operator and providers are named.
  expect(privacy).toMatch(/default build .* makes no network\s+request/);
  expect(privacy).toContain('npm run build:hosted');
  expect(privacy).toContain('Check for updated terms');
  expect(privacy).toMatch(/IP address, your browser’s user agent and the time of the\s+request/);
  expect(privacy).toContain('github.com/evanxliu1/AICheckout');
  expect(privacy).toMatch(/hosted on Render, and the catalog is stored in Supabase/);
  expect(privacy).toContain('hosting providers’ log retention');
  for (const field of ['currency', 'random capture identifier', 'tab and document'])
    expect(privacy).toContain(field);
  // The automatic badge: three hosts only, the summary only, an isolated frame, orders by URL only.
  for (const text of [
    'www.amazon.com',
    'bestbuy.com',
    'secure.newegg.com',
    'Only the order summary.',
    'Isolated badge.',
    'Orders by address only.',
    'savings history',
    'Protection is off by default',
  ])
    expect(privacy).toContain(text);
});

it('sends security reports to private vulnerability reporting, not public issues', () => {
  const support = rendered.find((page) => page.id === 'support')!.body;
  expect(support).toContain('/security/advisories/new');
  expect(support).toContain('SECURITY.md');
});

it('shows the install placeholder, not a store link, until the listing exists', () => {
  const home = rendered.find((page) => page.id === 'home')!.body;
  expect(home).toContain('Coming soon');
  expect(home).not.toContain('chromewebstore.google.com');
});

it('lists the bundled catalog’s cards per issuer', () => {
  const counts = new Map<string, number>();
  for (const card of CATALOG_V3.cards) counts.set(card.issuer, (counts.get(card.issuer) ?? 0) + 1);
  expect(Object.fromEntries(ISSUERS)).toEqual(Object.fromEntries(counts));
  expect(CARD_COUNT).toBe(CATALOG_V3.cards.length);
  const home = rendered.find((page) => page.id === 'home')!.body;
  expect(home).toContain(`${CATALOG_V3.cards.length} personal credit cards`);
});
