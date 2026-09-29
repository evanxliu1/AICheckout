/* global document, innerWidth, localStorage, sessionStorage */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { localCatalogFixture } from '../../../scripts/lib/local-catalog-fixture.mjs';
import { demoAssets, fileEvidence, fullStackEvidence } from '../../../scripts/lib/demo-evidence.mjs';

test('record the real local review, extraction and separate publication flow', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.PORTFOLIO_DEMO !== '1', 'Explicit local portfolio recording only');
  test.setTimeout(150000);
  mkdirSync(demoAssets, { recursive: true });
  const evidence = fullStackEvidence();
  const db = new pg.Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    application_name: 'aicheckout-portfolio-cleanup-check',
  });
  await db.connect();
  const baseline = (
    await db.query('select release_sequence::text as head from public.catalog_head where singleton')
  ).rows[0];
  const policySql =
    'select enabled,lifetime_budget_microusd,daily_budget_microusd,daily_run_limit,max_concurrent from catalog_private.curation_policy where singleton';
  const policyBefore = (await db.query(policySql)).rows;
  let fixture, context, page, capture;
  const chapters = [],
    frames = [],
    errors = [],
    externalRequests = [];
  try {
    fixture = await localCatalogFixture({ curation: 'openai-extraction-intercepted' });
    const { reviewer, ordinary, request, ok, address, published } = fixture;
    const date = new Date().toISOString().slice(0, 10),
      catalog = structuredClone(PILOT_CATALOG);
    catalog.cards = catalog.cards.slice(0, 1);
    catalog.sources = catalog.sources.slice(0, 1);
    catalog.cards[0].name = 'Synthetic Quicksilver example';
    catalog.cards[0].shortName = 'Synthetic example';
    catalog.version = `synthetic-portfolio.${randomUUID().slice(0, 8)}`;
    catalog.verifiedAt = `${date}T00:00:00Z`;
    catalog.expiresAt = new Date(Date.now() + 86400000).toISOString();
    catalog.sources[0].checkedOn = date;
    catalog.sources[0].title = 'Synthetic demonstration: invented terms, no model called';
    // Keep the registered source identity: arbitrary URLs must be rejected.
    // The capture title/body and video captions explicitly mark invented content.
    const source = ok(
      await request('/v1/review/sources', {
        token: reviewer.token,
        method: 'POST',
        body: {
          sourceKey: catalog.sources[0].id,
          title: catalog.sources[0].title,
          url: catalog.sources[0].url,
          checkedOn: date,
          body: 'SYNTHETIC REVIEW TEST: invented terms, not issuer evidence. Earn 2.5% on all eligible purchases. There is no annual spending cap. No activation is required.',
        },
      }),
    );
    const draft = ok(
      await request('/v1/review/drafts', {
        token: reviewer.token,
        method: 'POST',
        body: {
          catalog,
          sourceDocumentIds: [source.id],
          baseSequence: published.sequence,
        },
      }),
    );
    const path = `/v1/review/drafts/${draft.id}/extractions`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { token: ordinary.token })).status).toBe(403);
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: testInfo.outputPath('recording'), size: { width: 1280, height: 800 } },
    });
    await context.route('**/*', (route) => {
      const origin = new URL(route.request().url()).origin;
      if (origin === address || origin === 'http://127.0.0.1:54321') return route.continue();
      externalRequests.push(origin);
      return route.abort();
    });
    const started = Date.now();
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    function chapter(title, text) {
      chapters.push({ seconds: (Date.now() - started) / 1000, title, text });
    }
    async function hold(name, milliseconds = 4500) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (name) {
        const file = `full-stack-${name}.png`;
        await page.screenshot({ path: join(demoAssets, file) });
        frames.push({ file, ...fileEvidence(join(demoAssets, file)) });
      }
      // Deliberate reading time in a recording; functional waits use assertions.
      await page.waitForTimeout(milliseconds);
    }
    chapter(
      'Sign in to review',
      'Disposable local account. React connects to the compiled Node API and local Supabase Auth.',
    );
    await page.goto(`${address}/review/#${draft.id}`);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await hold('signin', 3000);
    await page.getByLabel('Email', { exact: true }).fill(reviewer.email);
    await page.getByLabel('Password', { exact: true }).fill(reviewer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: catalog.version, exact: true })).toBeVisible();
    chapter(
      'Start from a saved draft',
      'A revision and captured source identify the input. These invented 2.5% terms are demonstration data.',
    );
    await hold('draft');
    chapter(
      'Request bounded extraction',
      'The real SDK runs through a blocked, simulated transport. No live model call or provider charge occurs.',
    );
    await page.getByRole('button', { name: 'Extract captured terms' }).click();
    const apply = page.getByRole('button', { name: 'Apply reviewed extraction to draft' });
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();
    await page.locator('.extraction-result').scrollIntoViewIfNeeded();
    await hold('extracted');
    const run = ok(await request(path, { token: reviewer.token })).runs[0];
    expect(run.outcome).toBe('evidence_valid');
    const reviewed = ok(await request(`${path}/${run.id}`, { token: reviewer.token }));
    expect(reviewed.proposedCatalog.cards[0].rules[0].rateBps).toBe(250);
    chapter(
      'Inspect facts and exact quotations',
      'Each field points to a saved source span. Matching evidence is a mechanical check, not proof of correct interpretation.',
    );
    await page.locator('.extracted-facts').scrollIntoViewIfNeeded();
    await hold('evidence', 6000);
    chapter(
      'Review every condition',
      'A reviewer identifies which existing rules cover a condition and records a reason before applying anything.',
    );
    await page.locator('.condition-review').scrollIntoViewIfNeeded();
    await page.getByLabel('How is condition 1 covered?').selectOption('existing-rules');
    await page.getByRole('checkbox', { name: 'quicksilver-base', exact: true }).check();
    await page
      .getByLabel('Why these rules cover condition 1')
      .fill('The all-eligible rule covers this synthetic eligibility condition.');
    await hold('condition', 5500);
    chapter(
      'Approve a draft change',
      'The proposed rate changes from 1.5% to the invented 2.5%. A review note and fresh acknowledgement are required.',
    );
    await page.locator('.apply-extraction').scrollIntoViewIfNeeded();
    await page
      .getByLabel('Extraction review note')
      .fill('Checked all synthetic facts and source spans. Demonstration only; not issuer validation.');
    await page.getByRole('checkbox', { name: 'I checked every extracted fact', exact: false }).check();
    await expect(apply).toBeEnabled();
    await hold('proposal', 5500);
    chapter(
      'Apply without publishing',
      'The API creates a new draft revision and records the review. The public catalog remains unchanged.',
    );
    await apply.click();
    await expect(
      page.getByText('Extraction review recorded in a new draft revision.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('heading', { name: catalog.version, exact: true }).scrollIntoViewIfNeeded();
    const applied = ok(await request(`/v1/review/drafts/${draft.id}`, { token: reviewer.token })).draft;
    expect(applied.revision).toBe(draft.revision + 1);
    expect(applied.catalog.cards[0].rules[0].rateBps).toBe(250);
    expect(applied.catalog.expiresAt).toBe(catalog.expiresAt);
    expect(ok(await request('/v1/catalog')).release.sequence).toBe(published.sequence);
    await hold('applied');
    chapter(
      'Inspect the saved review',
      'The saved application records the revision and condition decisions. Refreshing a run reads the ledger without another model request.',
    );
    const application = page.getByText('Recorded application review', { exact: true });
    await application.click();
    await application.scrollIntoViewIfNeeded();
    await hold('review');
    await page.getByRole('button', { name: 'Refresh runs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh runs', exact: true })).toBeEnabled();
    expect(ok(await request(path, { token: reviewer.token })).runs).toHaveLength(1);
    chapter(
      'Inspect context and accounting',
      'The saved run exposes prompt/schema versions, context identity and attempts. Token and cost values here are simulated.',
    );
    const provenance = page.getByText('Run provenance and accounting', { exact: true });
    await provenance.click();
    await provenance.locator('..').scrollIntoViewIfNeeded();
    await hold('provenance', 6000);
    chapter(
      'Publish in a separate action',
      'A second review confirms the complete draft. Publication is bound to its exact revision, hash and current catalog head.',
    );
    const publish = page.getByRole('button', { name: 'Publish reviewed terms', exact: true });
    await publish.scrollIntoViewIfNeeded();
    await expect(publish).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I checked the full source terms', exact: false }).check();
    await page
      .getByLabel('Review note', { exact: true })
      .fill('Separately reviewed this synthetic revision. Local demonstration publication only.');
    await expect(publish).toBeEnabled();
    await hold('publication', 5000);
    await publish.click();
    await expect(page.getByText(`Published ${catalog.version} as release`, { exact: false })).toBeVisible();
    const release = ok(await request('/v1/catalog')).release;
    expect(release.catalog.version).toBe(catalog.version);
    expect(release.catalog.cards[0].rules[0].rateBps).toBe(250);
    chapter(
      'Verify the public result',
      'The local public endpoint now returns the reviewed revision. Cleanup restores the previous head and removes all demo records.',
    );
    await page.getByRole('heading', { name: catalog.version, exact: true }).scrollIntoViewIfNeeded();
    await hold('published', 5500);
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    expect((await context.storageState()).cookies).toEqual([]);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
    const video = page.video();
    await page.close();
    await video.saveAs(join(demoAssets, 'full-stack-demo.webm'));
    capture = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      browser: browser.version(),
      viewport: { width: 1280, height: 800 },
      scope:
        'Real local React → compiled Node API → Supabase Auth/PostgreSQL. Invented terms and intercepted SDK responses; no live model, billing or hosted publication.',
      chapters,
      frames,
      ...evidence,
      recording: fileEvidence(join(demoAssets, 'full-stack-demo.webm')),
      verified: {
        unauthorizedStatus: 401,
        ordinaryUserStatus: 403,
        extractionOutcome: run.outcome,
        initialDraftRevision: draft.revision,
        appliedDraftRevision: applied.revision,
        headUnchangedUntilSeparatePublication: true,
        savedRunCountAfterRefresh: 1,
        publishedRateBps: 250,
        browserCredentialPersistence: false,
        pageErrors: errors,
        externalBrowserRequests: externalRequests,
        versions: reviewed.run.context.versions,
        contextHash: reviewed.run.context.hash,
        providerModel: reviewed.run.profile.model,
        actualProviderSpendUsd: 0,
      },
    };
  } finally {
    try {
      await context?.close();
    } finally {
      try {
        await fixture?.close();
        if (fixture) {
          const users = [fixture.reviewer.id, fixture.ordinary.id];
          const remains = await db.query(
            `select
            (select count(*)::int from auth.users where id=any($1::uuid[])) as users,
            (select count(*)::int from catalog_private.drafts where created_by=any($1::uuid[])) as drafts,
            (select count(*)::int from catalog_private.source_documents where created_by=any($1::uuid[])) as sources,
            (select count(*)::int from catalog_private.curation_runs where requested_by=any($1::uuid[])) as runs`,
            [users],
          );
          expect(remains.rows[0]).toEqual({ users: 0, drafts: 0, sources: 0, runs: 0 });
          expect(
            (await db.query('select release_sequence::text as head from public.catalog_head where singleton'))
              .rows[0],
          ).toEqual(baseline);
          expect((await db.query(policySql)).rows).toEqual(policyBefore);
          if (capture)
            capture.cleanup = {
              checkedAt: new Date().toISOString(),
              ...remains.rows[0],
              previousHeadRestored: true,
              previousPolicyRestored: true,
            };
        }
      } finally {
        await db.end();
      }
    }
  }
  expect(fullStackEvidence()).toEqual(evidence);
  writeFileSync(join(demoAssets, 'full-stack-capture.json'), JSON.stringify(capture, null, 2) + '\n');
});
