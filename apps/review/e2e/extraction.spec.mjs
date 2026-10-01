import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { localCatalogFixture } from '../../../scripts/lib/local-catalog-fixture.mjs';

test('extraction review: saved recovery, condition decisions, stale application, new revision and separate publication', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await localCatalogFixture({ curation: 'openai-extraction-intercepted' }),
    errors = [];
  const { reviewer, ordinary, request, ok, address, published } = fixture;
  page.on('pageerror', (error) => errors.push(error.message));
  async function signIn() {
    await page.getByLabel('Email', { exact: true }).fill(reviewer.email);
    await page.getByLabel('Password', { exact: true }).fill(reviewer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async function reviewConditions() {
    await page.getByLabel('How is condition 1 covered?').selectOption('existing-rules');
    await page.getByRole('checkbox', { name: 'quicksilver-base', exact: true }).check();
    await page
      .getByLabel('Why these rules cover condition 1')
      .fill('The all-eligible category covers the supplied eligibility condition.');
    await page
      .getByLabel('Extraction review note')
      .fill('Reviewed every synthetic fact and its exact evidence; this is not issuer validation.');
    await page.getByRole('checkbox', { name: 'I checked every extracted fact', exact: false }).check();
  }
  try {
    const date = new Date().toISOString().slice(0, 10),
      catalog = structuredClone(PILOT_CATALOG);
    catalog.cards = catalog.cards.slice(0, 1);
    catalog.sources = catalog.sources.slice(0, 1);
    catalog.version = `synthetic-extraction-ui.${randomUUID().slice(0, 8)}`;
    catalog.verifiedAt = `${date}T00:00:00Z`;
    catalog.expiresAt = new Date(Date.now() + 86400000).toISOString();
    catalog.sources[0].checkedOn = date;
    catalog.sources[0].title = 'Synthetic UI evidence; invented terms, no model called';
    const source = ok(
      await request('/v1/review/sources', {
        token: reviewer.token,
        method: 'POST',
        body: {
          sourceKey: catalog.sources[0].id,
          title: catalog.sources[0].title,
          url: catalog.sources[0].url,
          checkedOn: date,
          body: 'SYNTHETIC REVIEW TEST: invented terms, not issuer evidence. Earn 2.5% on all eligible purchases. There is no annual spending cap. No activation is required. Harmless markup test: <img src=x onerror=alert(1)>',
        },
      }),
    );
    const draft = ok(
      await request('/v1/review/drafts', {
        token: reviewer.token,
        method: 'POST',
        body: { catalog, sourceDocumentIds: [source.id], baseSequence: published.sequence },
      }),
    );
    const path = `/v1/review/drafts/${draft.id}/extractions`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { token: ordinary.token })).status).toBe(403);
    await page.goto(`${address}/review/#${draft.id}`);
    await signIn();
    await expect(page.getByRole('heading', { name: draft.catalog.version, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extract captured terms' })).toBeEnabled();
    await page.getByRole('button', { name: 'Extract captured terms' }).click();
    const apply = page.getByRole('button', { name: 'Apply reviewed extraction to draft' });
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();
    await expect(page.getByText('Add an extraction review note of at least 10 characters.')).toBeVisible();
    await page
      .getByRole('region', { name: 'Extract from captured terms' })
      .screenshot({ path: testInfo.outputPath('extraction-incomplete-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('region', { name: 'Extract from captured terms' })
      .screenshot({ path: testInfo.outputPath('extraction-incomplete-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const first = ok(await request(path, { token: reviewer.token })).runs[0];
    expect(first.outcome).toBe('evidence_valid');
    const firstReview = ok(await request(`${path}/${first.id}`, { token: reviewer.token }));
    expect(firstReview.proposedCatalog.cards[0].rules[0].rateBps).toBe(250);
    expect((await request(`${path}/${first.id}`, { token: ordinary.token })).status).toBe(403);
    expect(
      (
        await request(`${path}/${first.id}/apply`, {
          token: ordinary.token,
          method: 'POST',
          body: {
            expectedRevision: 1,
            expectedHash: draft.catalog_hash,
            conditionReviews: [],
            reviewNote: 'Unauthorized synthetic review attempt.',
          },
        })
      ).status,
    ).toBe(403);
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    await reviewConditions();
    await expect(apply).toBeEnabled();
    const unchanged = ok(
      await request(`/v1/review/drafts/${draft.id}`, {
        token: reviewer.token,
        method: 'PUT',
        body: {
          catalog,
          sourceDocumentIds: [source.id],
          baseSequence: published.sequence,
          expectedRevision: draft.revision,
        },
      }),
    );
    await apply.click();
    await expect(page.getByRole('alert')).toContainText('draft or published catalog changed');
    await page.getByRole('button', { name: 'Reload latest draft' }).click();
    await expect(page.getByText('The draft changed since this run.', { exact: false })).toBeVisible();
    await expect(apply).toHaveCount(0);
    await page.getByRole('button', { name: 'Extract captured terms' }).click();
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();
    const second = ok(await request(path, { token: reviewer.token })).runs[0];
    expect(second.id).not.toBe(first.id);
    await page.getByLabel('How is condition 1 covered?').selectOption('unrepresentable');
    await expect(apply).toBeDisabled();
    await reviewConditions();
    await expect(apply).toBeEnabled();
    // One desktop/mobile visual round, with clearly labeled synthetic source data.
    await page
      .getByRole('region', { name: 'Extract from captured terms' })
      .screenshot({ path: testInfo.outputPath('extraction-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('region', { name: 'Extract from captured terms' })
      .screenshot({ path: testInfo.outputPath('extraction-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const data = {
      expectedRevision: unchanged.revision,
      expectedHash: unchanged.catalog_hash,
      reviewNote: 'Reviewed every synthetic fact and its exact evidence; this is not issuer validation.',
      conditionReviews: [
        {
          index: 0,
          coverage: 'existing-rules',
          ruleIds: ['quicksilver-base'],
          note: 'The all-eligible category covers the supplied eligibility condition.',
        },
      ],
    };
    await apply.click();
    await expect(
      page.getByText('Extraction review recorded in a new draft revision.', { exact: false }),
    ).toBeVisible();
    const applied = ok(await request(`/v1/review/drafts/${draft.id}`, { token: reviewer.token }));
    expect(applied.draft.revision).toBe(unchanged.revision + 1);
    expect(applied.draft.catalog.cards[0].rules[0].rateBps).toBe(250);
    expect(applied.draft.catalog.expiresAt).toBe(catalog.expiresAt);
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    const retry = ok(
      await request(`${path}/${second.id}/apply`, { token: reviewer.token, method: 'POST', body: data }),
    );
    expect(retry.draft.revision).toBe(applied.draft.revision);
    expect(retry.application.condition_reviews).toEqual(data.conditionReviews);
    await expect(
      page.getByRole('checkbox', { name: 'I checked the full source terms', exact: false }),
    ).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Publish reviewed terms' })).toBeDisabled();
    expect(await page.locator('img').count()).toBe(0);
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    expect((await context.storageState()).cookies).toEqual([]);
    await page.reload();
    await signIn();
    await expect(page.getByText('Recorded application review', { exact: true })).toBeVisible();
    expect(ok(await request(path, { token: reviewer.token })).runs).toHaveLength(2);
    await page.getByRole('checkbox', { name: 'I checked the full source terms', exact: false }).check();
    await page
      .getByLabel('Review note', { exact: true })
      .fill('Reviewed the new draft revision independently after applying the synthetic extraction.');
    await page.getByRole('button', { name: 'Publish reviewed terms' }).click();
    await expect(page.getByRole('dialog', { name: /^Publish / })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish release' }).click();
    await expect(page.getByText(`Published ${catalog.version} as release`, { exact: false })).toBeVisible();
    expect(ok(await request('/v1/catalog')).release.catalog.cards[0].rules[0].rateBps).toBe(250);
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
