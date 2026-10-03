import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';
import { redateCatalog } from '../../packages/rewards-core/src/catalog-helpers';
import { writeCatalogCache } from './vault';

/** Adds a card in the wallet editor (popup or onboarding): type its name in the search field and
 * pick it from the list of matches, as a shopper would. */
export async function addCard(page: Page, name: string) {
  const search = page.getByRole('combobox', { name: 'Add a card' });
  await search.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
}

/** Caches the synthetic catalog v3 fixture as a published release verified today (UTC), so it is the
 * newest valid catalog and takes effect over the bundled one on the next load. Test data only. */
export async function cacheCatalogV3Fixture(page: Page) {
  const catalog = redateCatalog(CATALOG_V3_FIXTURE, new Date().toISOString().slice(0, 10));
  catalog.version = 'test-v3.e2e';
  await writeCatalogCache(page, {
    lastCheckedAt: null,
    release: {
      sequence: 1,
      version: catalog.version,
      catalog,
      catalog_hash: '3'.repeat(64),
      published_at: catalog.verifiedAt,
    },
  });
  await page.reload();
}
