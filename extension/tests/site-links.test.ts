// Phase 15.5: the popup's credits link (and the consent screen's privacy link) point at the public site on the
// catalog origin; a build without an endpoint has no site to link to.
import { expect, it } from 'vitest';
import { CREDITS_URL, siteUrl } from '../src/state/keys';

it('derives a site page from the catalog endpoint, and nothing without one', () => {
  expect(siteUrl('https://ai-checkout-api.onrender.com/v1/catalog', '/credits/')).toBe(
    'https://ai-checkout-api.onrender.com/credits/',
  );
  expect(siteUrl('https://ai-checkout-api.onrender.com/v1/catalog', '/uninstalled/')).toBe(
    'https://ai-checkout-api.onrender.com/uninstalled/',
  );
  expect(siteUrl(undefined, '/credits/')).toBeNull();
  expect(siteUrl('', '/credits/')).toBeNull();
});

it('has no credits link in a build without a catalog endpoint (the unit-test build)', () => {
  expect(CREDITS_URL).toBeNull();
});
