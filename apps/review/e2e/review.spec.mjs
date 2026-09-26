import { test, expect } from '@playwright/test';
import { localCatalogFixture } from '../../../scripts/lib/local-catalog-fixture.mjs';

test('real review: access control, evidence, stale approval, publication, memory-only session, sign-out', async ({ page, context }, testInfo) => {
  const fixture = await localCatalogFixture(), errors = [];
  const { request, ok, reviewer, ordinary, draft, published, address } = fixture;
  let uiToken;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().startsWith(`${address}/v1/review`)) uiToken = request.headers().authorization?.slice(7) ?? uiToken;
  });
  async function signIn(account) {
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  try {
    const loaded = await page.goto(`${address}/review/#${draft.id}`);
    expect(loaded.status()).toBe(200);
    expect(loaded.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    await expect(page.getByRole('heading', { name: 'Review the terms behind every estimate.' })).toBeVisible();
    await signIn(ordinary);
    await expect(page.getByRole('heading', { name: 'Reviewer access is required.' })).toBeVisible();
    await expect(page.getByText('Synthetic issuer terms for browser verification', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(reviewer);
    await expect(page.getByRole('heading', { name: draft.catalog.version, exact: true })).toBeVisible();
    await expect(page.getByText('Matching evidence needed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeDisabled();
    await expect(page.getByRole('cell', { name: '1.5%', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '2.5%', exact: true })).toBeVisible();
    await page.getByText('Capture source evidence', { exact: true }).click();
    await page.getByLabel('Text from the source').fill('Synthetic updated terms: 2.5% on eligible purchases. No annual cap. No activation. <img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Capture and attach evidence' }).click();
    await expect(page.getByText('Matching evidence captured', { exact: true })).toBeVisible();
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    expect(await page.locator('img').count()).toBe(0);
    const fresh = ok(await request(`/v1/review/drafts/${draft.id}`, { token: reviewer.token }));
    expect(fresh.published.sequence).toBe(published.sequence);
    await page.getByRole('checkbox').check();
    await page.getByLabel('Review note').fill('Checked every synthetic term and condition for this browser test.');
    ok(await request(`/v1/review/drafts/${draft.id}`, { token: reviewer.token, method: 'PUT', body: {
      catalog: fresh.draft.catalog, sourceDocumentIds: fresh.draft.source_document_ids,
      baseSequence: fresh.draft.base_sequence, expectedRevision: fresh.draft.revision } }));
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await expect(page.getByRole('alert')).toContainText('draft or published catalog changed');
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    await page.getByRole('button', { name: 'Reload latest draft' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByLabel('Review note')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeDisabled();

    // One batched visual pass. No tokens/passwords or unlabelled issuer claims appear.
    await page.screenshot({ path: testInfo.outputPath('review-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('review-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect((await context.storageState()).cookies).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Review the terms behind every estimate.' })).toBeVisible();
    await signIn(reviewer);
    await expect(page.getByRole('heading', { name: draft.catalog.version, exact: true })).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByLabel('Review note').fill('Reviewed the latest synthetic revision and all captured conditions.');
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await expect(page.getByRole('status')).toContainText(`Published ${draft.catalog.version}`);
    const result = ok(await request('/v1/catalog')).release;
    expect(result.catalog.cards[0].rules[0].rateBps).toBe(250);
    expect(result.sequence).toBeGreaterThan(published.sequence);
    const sessionToRevoke = uiToken;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await request('/v1/review/', { token: sessionToRevoke })).status).toBe(403);
    await expect(page.getByText('Synthetic updated terms:', { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await fixture.close(); }
});
