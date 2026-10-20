import { expect, it } from 'vitest';
import { ALL_PAGES, OTHER_PAGES, PAGES } from '../src/Layout';
import { renderPage } from '../src/render';
import { CARD_COUNT, ISSUERS } from '../src/pages';
import { CATALOG_V3 } from '../../../packages/rewards-core/src/catalog-v3';

const rendered = ALL_PAGES.map((page) => ({ ...page, ...renderPage(page.id) }));
const body = (id: string) => rendered.find((page) => page.id === id)!.body;

it('renders every page with one h1, a title, a description and the current page marked in the navigation', () => {
  for (const page of rendered) {
    expect(page.body.match(/<h1[ >]/g), page.id).toHaveLength(1);
    expect(page.head).toMatch(/<title>[^<]+<\/title><meta name="description" content="[^"]+" \/>/);
    if (PAGES.some((entry) => entry.id === page.id)) {
      expect(page.body).toContain(`href="${page.path}" aria-current="page"`);
      expect(page.body.match(/aria-current="page"/g)).toHaveLength(1);
    } else {
      // Credits and the uninstall page are reached from the footer or from Chrome, not the navigation.
      expect(OTHER_PAGES.some((entry) => entry.id === page.id)).toBe(true);
      expect(page.body).not.toContain('aria-current="page"');
    }
    expect(page.body).toContain('href="/credits/"');
  }
});

it('needs nothing the site CSP forbids: no inline styles, scripts, handlers or remote resources', () => {
  for (const page of rendered) {
    expect(page.body).not.toMatch(/ style=|<style|<script|\son[a-z]+=/i);
    expect(page.body).not.toMatch(/<(img|link|iframe)[^>]+(src|href)="https?:/i);
  }
});

it('keeps the results page honest about what the numbers are', () => {
  const results = body('results');
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
    '97.5% for the same model, effort, prompt and source selection on the seven-card held-out split',
    'not directly comparable',
    'agent-verified, one repeat',
    'is an upper bound, not an accuracy measure',
    'href="/results/expansion.json"',
    'docs/evals/expansion.md',
  ])
    expect(results).toContain(text);
  expect(results.match(/class="chart"/g)).toHaveLength(2);
});

it('describes the badge at any store and the retired three-store flow nowhere', () => {
  for (const page of rendered) {
    const text = page.body;
    expect(text, page.id).not.toMatch(/Amazon US, Best Buy US,? and Newegg US/);
    expect(text, page.id).not.toMatch(
      /\b(?:three|3) (?:supported |named )?(?:stores|sites|checkouts|retailers|carts)\b/i,
    );
    expect(text, page.id).not.toMatch(
      /\bonly (?:on|at) (?:the |these )?(?:Amazon|Best Buy|Newegg|three|supported)/i,
    );
    expect(text, page.id).not.toMatch(/savings history|order-confirmation|order confirmation/i);
  }
  const home = body('home');
  expect(home).toContain('any U.S. online store');
  expect(home).toContain('any https store');
  expect(home).toContain('ranks your cards by rate');
});

it('states the privacy policy: what the badge reads, the requests, and usage reports under a random identifier', () => {
  const privacy = body('privacy');
  for (const text of [
    'Last updated 2026-10-20',
    'Operator: Evan Liu',
    'access to every https website',
    'address and title for a cart or checkout word',
    'reads nothing from the page and observes none of its content',
    'The script makes no network request.',
    'The store is matched on your device.',
    'Isolated badge.',
    'GET /v1/catalog',
    'GET /v1/merchants',
    'right after installation',
    'weekly',
    'hosted on Render, with its data stored in Supabase',
    'providers’ log retention',
    'Usage reports (optional)',
    'A random identifier, no name, email or browsing history.',
    'pseudonymous',
    'event dictionary',
    'POST /v1/events',
    '90 days',
    'Stop sharing',
    'Delete my data',
    'POST /v1/events/delete',
    'Suggest this store',
    'Report a problem',
    'Limited Use requirements',
    'not sold, not used for advertising, not used to decide creditworthiness',
    'not directed at children under 13',
    'United States only',
    'Protect with a passphrase',
    'Delete all local data',
    'the usage-reporting state',
    'cannot be deleted on request',
    'href="/uninstalled/"',
  ])
    expect(privacy).toContain(text);
  // Two taps send a domain without sharing, so the policy never says nothing leaves before Share without the exception.
  expect(privacy).toContain('Apart from the two things you send on purpose');
  expect(privacy).not.toMatch(/\banonym/i);
  expect(privacy).not.toContain('Only a request for the card catalog');
  expect(privacy).not.toContain('No analytics');
});

it('never calls the data anonymous and never names the retired per-store flow on any page', () => {
  for (const page of rendered) {
    expect(page.body, page.id).not.toMatch(/\banonym(?:ous|ized|ised|ization|ity)\b/i);
    expect(page.body, page.id).not.toMatch(/-summary-v1|site adapter/i);
  }
});

it('credits the Oklahoma CC BY 4.0 data verbatim with the DC, GSA, Visa, NerdWallet and font sources', () => {
  const credits = body('credits');
  for (const text of [
    'State of Oklahoma, Office of Management and Enterprise Services (data.ok.gov)',
    'Creative Commons Attribution 4.0 (CC BY 4.0)',
    'the State of Oklahoma does not endorse it',
    'href="https://creativecommons.org/licenses/by/4.0/"',
    'href="https://data.ok.gov/dataset/pcard-fy-2022"',
    'Government of the District of Columbia, Office of the Chief Technology Officer (Open Data DC)',
    'U.S. General Services Administration (GSA SmartPay), via catalog.data.gov',
    'CC0 1.0',
    'Changes made to the source data:',
    'Visa Merchant Data Standards Manual',
    'referenced, not reproduced',
    'NerdWallet',
    'Helios',
    'MPL-2.0',
    'SIL Open Font License 1.1',
    'evals/merchants/db/mcc/NOTICE.md',
  ])
    expect(credits).toContain(text);
  // The footer attribution and the listing sentence name the same licence on every page.
  for (const page of rendered) expect(page.body, page.id).toContain('State of Oklahoma (CC BY 4.0)');
});

it('tells an uninstalled shopper what was deleted, the 90-day expiry and that Delete my data had to come first', () => {
  const uninstalled = body('uninstalled');
  for (const text of [
    'carries no parameters',
    'Chrome removed the extension’s storage',
    'expire after 90 days',
    'stored without one',
    'Delete my data',
    'before',
    'href="/privacy/"',
    'href="/support/"',
  ])
    expect(uninstalled).toContain(text);
});

it('sends security reports to private vulnerability reporting and names the in-extension report', () => {
  const support = body('support');
  expect(support).toContain('/security/advisories/new');
  expect(support).toContain('SECURITY.md');
  expect(support).toContain('Report a problem');
  expect(support).toContain('Suggest this store');
  expect(support).toContain('Checking for updated terms');
  expect(support).toContain('Delete my data');
});

it('shows the install placeholder, not a store link, until the listing exists', () => {
  const home = body('home');
  expect(home).toContain('Coming soon');
  expect(home).not.toContain('chromewebstore.google.com');
});

it('lists the bundled catalog’s cards per issuer', () => {
  const counts = new Map<string, number>();
  for (const card of CATALOG_V3.cards) counts.set(card.issuer, (counts.get(card.issuer) ?? 0) + 1);
  expect(Object.fromEntries(ISSUERS)).toEqual(Object.fromEntries(counts));
  expect(CARD_COUNT).toBe(CATALOG_V3.cards.length);
  expect(body('home')).toContain(`${CATALOG_V3.cards.length} personal credit cards`);
});
