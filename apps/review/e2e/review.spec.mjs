import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { localCatalogFixture } from '../../../scripts/lib/local-catalog-fixture.mjs';
import { largeCatalogV3 } from '../../../packages/rewards-core/large-catalog-fixture.ts';

const MAX_REVIEW_RESPONSE_BYTES = 8 * 1024 * 1024;

test('real review: access control, evidence, stale approval, publication, memory-only session, sign-out', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localCatalogFixture(),
    errors = [];
  const { request, ok, reviewer, ordinary, draft, published, address } = fixture;
  let uiToken;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().startsWith(`${address}/v1/review`))
      uiToken = request.headers().authorization?.slice(7) ?? uiToken;
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
    await expect(
      page.getByRole('heading', { name: 'Review the terms behind every estimate.' }),
    ).toBeVisible();
    await signIn(ordinary);
    await expect(page.getByRole('heading', { name: 'Reviewer access is required.' })).toBeVisible();
    await expect(
      page.getByText('Synthetic issuer terms for browser verification', { exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(reviewer);
    await expect(page.getByRole('heading', { name: draft.catalog.version, exact: true })).toBeVisible();
    await expect(page.getByText('Matching evidence needed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeDisabled();
    await expect(page.getByRole('cell', { name: '1.5%', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '2.5%', exact: true })).toBeVisible();
    await page.getByText('Capture source evidence', { exact: true }).click();
    await page
      .getByLabel('Text from the source')
      .fill(
        'Synthetic updated terms: 2.5% on eligible purchases. No annual cap. No activation. <img src=x onerror=alert(1)>',
      );
    await page.getByRole('button', { name: 'Capture and attach evidence' }).click();
    await expect(page.getByText('Matching evidence captured', { exact: true })).toBeVisible();
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    expect(await page.locator('img').count()).toBe(0);
    const fresh = ok(await request(`/v1/review/drafts/${draft.id}`, { token: reviewer.token }));
    expect(fresh.published.sequence).toBe(published.sequence);
    await page.getByRole('checkbox', { name: /I checked the full source terms/ }).check();
    await page
      .getByLabel('Review note')
      .fill('Checked every synthetic term and condition for this browser test.');
    ok(
      await request(`/v1/review/drafts/${draft.id}`, {
        token: reviewer.token,
        method: 'PUT',
        body: {
          catalog: fresh.draft.catalog,
          sourceDocumentIds: fresh.draft.source_document_ids,
          baseSequence: fresh.draft.base_sequence,
          expectedRevision: fresh.draft.revision,
        },
      }),
    );
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await expect(page.getByRole('dialog', { name: /^Publish / })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish release' }).click();
    await expect(page.getByRole('alert')).toContainText('draft or published catalog changed');
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    await page.getByRole('button', { name: 'Reload latest draft' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /I checked the full source terms/ })).not.toBeChecked();
    await expect(page.getByLabel('Review note')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeDisabled();

    // One batched visual pass. No tokens/passwords or unlabelled issuer claims appear.
    await page.screenshot({ path: testInfo.outputPath('review-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('review-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    expect((await context.storageState()).cookies).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Review the terms behind every estimate.' }),
    ).toBeVisible();
    await signIn(reviewer);
    await expect(page.getByRole('heading', { name: draft.catalog.version, exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: /I checked the full source terms/ }).check();
    await page
      .getByLabel('Review note')
      .fill('Reviewed the latest synthetic revision and all captured conditions.');
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await expect(page.getByRole('dialog', { name: /^Publish / })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish release' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Published' })).toContainText(
      `Published ${draft.catalog.version}`,
    );
    const result = ok(await request('/v1/catalog')).release;
    expect(result.catalog.cards[0].rules[0].rateBps).toBe(250);
    expect(result.sequence).toBeGreaterThan(published.sequence);
    const sessionToRevoke = uiToken;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await request('/v1/review/', { token: sessionToRevoke })).status).toBe(403);
    await expect(page.getByText('Synthetic updated terms:', { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('large catalog v3: capture 340 sources from a folder, review under 8 MiB, publish', async ({
  page,
}, testInfo) => {
  test.setTimeout(600000);
  const fixture = await localCatalogFixture(),
    errors = [];
  const { request, ok, reviewer, published, address } = fixture;
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const catalog = largeCatalogV3();
    catalog.version = `${catalog.verifiedAt.slice(0, 10)}.large-e2e.${randomUUID().slice(0, 8)}`;
    expect(catalog.cards).toHaveLength(180);
    expect(catalog.sources).toHaveLength(340);
    // Two long captures: 250,000 characters with multibyte text (about 750 KB as UTF-8), and one the
    // size of the largest expansion capture; the rest are short.
    const bodies = new Map(
      catalog.sources.map((source, i) => [
        source.id,
        i === 0
          ? `Synthetic terms 界 ${'界'.repeat(124_990)} ${'a'.repeat(124_991)}`
          : i === 1
            ? `Synthetic terms ${'b'.repeat(204_318)}`
            : `Synthetic terms for ${source.id}: 3% at synthetic merchants. Test data only.`,
      ]),
    );
    expect([...bodies.values()][0]).toHaveLength(250_000);
    const folder = testInfo.outputPath('captures');
    await mkdir(folder, { recursive: true });
    for (const [id, body] of bodies) await writeFile(join(folder, `${id}.txt`), body);
    await writeFile(join(folder, 'capture-report.json'), '{}');
    const draft = ok(
      await request('/v1/review/drafts', {
        token: reviewer.token,
        method: 'POST',
        body: { catalog, sourceDocumentIds: [], baseSequence: published.sequence },
      }),
    );

    await page.goto(`${address}/review/#${draft.id}`);
    await page.getByLabel('Email', { exact: true }).fill(reviewer.email);
    await page.getByLabel('Password', { exact: true }).fill(reviewer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: catalog.version, exact: true })).toBeVisible();
    await expect(page.getByText('0 of 340 sources have matching captured evidence.')).toBeVisible();
    await page.getByText('Capture all missing sources', { exact: true }).click();
    await page.getByLabel('Load a capture folder').setInputFiles(folder);
    await expect(page.getByText(/^Loaded 340 files; skipped 1 that are not \.txt files\./)).toBeVisible();
    await page.getByRole('button', { name: 'Capture 340 of 340 missing sources and attach' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Captured 340 sources and attached them' }),
    ).toBeVisible({ timeout: 300000 });
    await expect(page.getByText('340 of 340 sources have matching captured evidence.')).toBeVisible();

    // The review detail lists every capture without its text and stays far under the response cap.
    const response = await fetch(`${address}/v1/review/drafts/${draft.id}`, {
      headers: { Authorization: `Bearer ${reviewer.token}` },
    });
    const raw = await response.text();
    expect(response.status).toBe(200);
    const bytes = Buffer.byteLength(raw);
    expect(bytes).toBeLessThan(MAX_REVIEW_RESPONSE_BYTES);
    const detail = JSON.parse(raw);
    expect(detail.sources).toHaveLength(340);
    expect(detail.sources.some((source) => 'body' in source)).toBe(false);
    expect(detail.sources.find((source) => source.source_key === catalog.sources[0].id).body_chars).toBe(
      250_000,
    );
    testInfo.annotations.push({ type: 'review-detail-bytes', description: String(bytes) });

    // One capture's text on demand, multibyte intact.
    await page.getByLabel('Find a source').fill(catalog.sources[0].id);
    await page.getByText('Captured text (250,000 characters)', { exact: true }).click();
    await expect(page.locator('.source-text')).toContainText('Synthetic terms 界 界界');

    await page.getByRole('checkbox', { name: /I checked the full source terms/ }).check();
    await page
      .getByLabel('Review note')
      .fill('Synthetic 180-card review for the large-catalog browser test.');
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish release' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Published' })).toContainText(
      `Published ${catalog.version}`,
      { timeout: 60000 },
    );
    const served = await fetch(`${address}/v1/catalog`);
    const servedBody = await served.text();
    expect(served.status).toBe(200);
    const release = JSON.parse(servedBody).release;
    expect(release.version).toBe(catalog.version);
    expect(release.sequence).toBeGreaterThan(published.sequence);
    expect(release.catalog.cards).toHaveLength(180);
    testInfo.annotations.push({
      type: 'catalog-response-bytes',
      description: String(Buffer.byteLength(servedBody)),
    });
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
