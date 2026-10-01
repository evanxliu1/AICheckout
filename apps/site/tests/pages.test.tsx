import { expect, it } from 'vitest';
import { PAGES } from '../src/Layout';
import { renderPage } from '../src/render';

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
    'Opus was added after',
    'Limitations',
    'docs/evals/results.md',
    'href="/results/results.svg"',
    'href="/results/results-heldout.svg"',
  ])
    expect(results).toContain(text);
  expect(results.match(/<table/g)).toHaveLength(2);
  expect(results.match(/class="chart"/g)).toHaveLength(2);
});

it('states on the privacy page that only the catalog request leaves the device and there are no analytics', () => {
  const privacy = rendered.find((page) => page.id === 'privacy')!.body;
  expect(privacy).toContain('Only a request for the card catalog.');
  expect(privacy).toContain('No analytics, tracking or advertising.');
  for (const merchant of ['Amazon US', 'Best Buy US', 'Newegg US']) expect(privacy).toContain(merchant);
  expect(privacy).toMatch(/encrypted with a key derived from a passphrase/);
});

it('shows the install placeholder, not a store link, until the listing exists', () => {
  const home = rendered.find((page) => page.id === 'home')!.body;
  expect(home).toContain('Coming soon');
  expect(home).not.toContain('chromewebstore.google.com');
});
