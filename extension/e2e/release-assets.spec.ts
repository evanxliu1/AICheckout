// Release media (milestone 15.6): five captures of the real packaged extension for the Web Store images and
// the staged shopper recording. Everything is captured at 1 CSS pixel per image pixel: the popup page at its
// 360×600 popup size, the badge on a neutral fictional store page and the onboarding consent screen in an
// 880×800 window. Fixture pages carry no retailer branding and no real store is named: the named store is a
// fictional "Sample Kitchen" (a restaurant) on a reserved `.example` host, added to a test copy of the bundled merchant release
// cached in the capture profile (review of 2026-10-20: promotional media must not name a real retailer). The
// hosted build is required (the consent screen exists only in builds with usage reporting); its catalog origin
// is mapped to the loopback address so no request leaves the machine.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3';
import { MERCHANTS_V1 } from '../../packages/rewards-core/src/merchants-v1';
import { publishedMerchantReleaseSchema } from '../../packages/rewards-core/src/merchant-release';
import { addCard } from './wallet';

/** The sample wallet: four cards from the catalog; Blue Cash Everyday's online-retail spend is reported as $0. */
const SAMPLE_CARDS = [
  'Citi Double Cash',
  'Capital One Quicksilver',
  'Chase Freedom Unlimited',
  'American Express Blue Cash Everyday',
];
/** A fictional store, never a real retailer: a restaurant (online ordering) on the `definition` basis, so the
 * badge panel carries the evidence line, on a reserved `.example` host. Like every bundled dining record it sells
 * no physical goods, so online-retail rules do not apply and the card whose rule the evidence line names wins
 * outright: Freedom Unlimited's uncapped 3% on dining (review of 2026-10-20: a supermarket record let Blue Cash
 * Everyday's online-retail rule win under a supermarket evidence line, because its supermarket cap has no spend
 * input). It exists only in the test release below; the page is the neutral sample cart. */
const NAMED_STORE = { id: 'sample-kitchen-us', host: 'www.sample-kitchen.example', name: 'Sample Kitchen' };
/** The issuer page whose dining definition the fictional record cites (the catalog cites it for Chase cards). */
const ISSUER_DEFINITIONS = ['chase-rewards-category-faq'];
/** The bundled release plus the fictional record, as a cached hosted release (sequence 1, verified with the
 * bundled one, so the cache is in effect on a tie). Validated with the extension's own schema. */
function mediaMerchantRelease() {
  const sourceId = 'sample-kitchen-example-page-1';
  const release = {
    ...MERCHANTS_V1,
    version: `${MERCHANTS_V1.verifiedAt.slice(0, 10)}.media-sample.1`,
    sources: [
      ...MERCHANTS_V1.sources,
      {
        id: sourceId,
        url: `https://${NAMED_STORE.host}/about`,
        kind: 'store-page' as const,
        capturedAt: MERCHANTS_V1.verifiedAt.slice(0, 10),
        sha256: hash(Buffer.from(fixture('sample-cart.html'))),
      },
    ],
    merchants: [
      ...MERCHANTS_V1.merchants,
      {
        id: NAMED_STORE.id,
        name: NAMED_STORE.name,
        hosts: [NAMED_STORE.host.replace(/^www\./, '')],
        kind: 'merchant' as const,
        physicalGoods: false,
        category: 'dining' as const,
        evidence: { basis: 'definition' as const, sourceIds: [sourceId, ...ISSUER_DEFINITIONS] },
        brandIds: [],
        disabled: false,
      },
    ],
  };
  return publishedMerchantReleaseSchema.parse({
    sequence: 1,
    release,
    version: release.version,
    release_hash: hash(Buffer.from(JSON.stringify(release))),
    published_at: release.verifiedAt,
  });
}
const GENERIC_HOST = 'shop.example.com';
const WINDOW = { width: 880, height: 800 };
const POPUP = { width: 360, height: 600 };
const BADGE = '/src/badge/index.html';

type Frame = {
  name: string;
  sha256: string;
  width: number;
  height: number;
  text: string;
  viewport: { width: number; height: number; scale: number; scroll: number };
};

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const fixture = (file: string) => readFileSync(`tests/fixtures/${file}`, 'utf8');

async function launch(
  extension: string,
  catalogOrigin: string,
  profile: string,
  extra: Parameters<typeof chromium.launchPersistentContext>[1] = {},
) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 1,
    viewport: WINDOW,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      // The worker's install-time refresh and any usage report would go to the catalog origin; the
      // worker's fetches bypass context.route, so the host is resolved to the loopback address instead.
      `--host-resolver-rules=MAP ${new URL(catalogOrigin).hostname} 127.0.0.1`,
    ],
    ...extra,
  });
  // All page traffic is blocked except the two in-memory sample carts.
  await context.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (url === `https://${NAMED_STORE.host}/cart`)
      return route.fulfill({ contentType: 'text/html', body: fixture('sample-cart.html') });
    if (url === `https://${GENERIC_HOST}/cart`)
      return route.fulfill({ contentType: 'text/html', body: fixture('sample-cart-gift-card.html') });
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const onboarding = await onboardingTab(context, id);
  // The test release with the fictional store, cached as a hosted release would be (the install-time refresh
  // fails on the loopback address and writes nothing).
  await worker.evaluate((cache) => chrome.storage.local.set({ checkoutMerchantsV1: cache }), {
    release: mediaMerchantRelease(),
    lastCheckedAt: Date.now(),
  });
  return { context, worker, id, onboarding };
}
/** The onboarding tab a fresh install opens. */
async function onboardingTab(context: BrowserContext, id: string) {
  const url = `chrome-extension://${id}/src/onboarding/index.html`;
  await expect.poll(() => context.pages().some((p) => p.url() === url), { timeout: 10_000 }).toBe(true);
  return context.pages().find((p) => p.url() === url)!;
}
/** Picks the sample cards in a wallet editor (onboarding or popup) and reports $0 online-retail spend. */
async function pickSampleCards(page: Page) {
  for (const name of SAMPLE_CARDS) await addCard(page, name);
  await page.getByLabel(/Blue Cash Everyday online retail spend/).fill('0');
}
async function badgeFrame(page: Page) {
  await expect.poll(() => page.frames().some((f) => f.url().includes(BADGE)), { timeout: 10_000 }).toBe(true);
  return page.frames().find((f) => f.url().includes(BADGE))!;
}
/** Expands the badge and lets the frame reach its size for this window. */
async function expandBadge(page: Page, pill: RegExp) {
  const badge = await badgeFrame(page);
  const button = badge.getByRole('button', { name: pill });
  await expect(button).toBeVisible();
  await button.click();
  await expect(badge.getByRole('button', { name: 'Collapse' })).toBeVisible();
  await page.waitForTimeout(500);
  return badge;
}

test('capture the real release UI and record the staged shopper walkthrough', async ({
  browserName,
}, testInfo) => {
  test.skip(process.env.RELEASE_ASSETS !== '1', 'Explicit release-media generation only.');
  test.setTimeout(180_000);
  expect(browserName).toBe('chromium');
  const output = resolve('../docs/release/assets'),
    captures = resolve(output, 'captures');
  mkdirSync(captures, { recursive: true });
  const extension = resolve('dist');
  const inventory = JSON.parse(readFileSync('artifacts/ai-checkout-2.1.0.inventory.json', 'utf8')) as {
    sha256: string;
    catalogOrigin: string | null;
    files: { path: string; sha256: string }[];
  };
  expect(hash(readFileSync('artifacts/ai-checkout-2.1.0.zip'))).toBe(inventory.sha256);
  for (const file of inventory.files)
    expect(hash(readFileSync(resolve(extension, file.path)))).toBe(file.sha256);
  expect(
    inventory.catalogOrigin,
    'Release media needs the hosted build (npm run build:hosted): the consent screen exists only there.',
  ).toBeTruthy();
  // The named store is fictional: no record of the shipped release matches its host.
  expect(
    MERCHANTS_V1.merchants.some((record) =>
      record.hosts.some((host) => NAMED_STORE.host === host || NAMED_STORE.host.endsWith(`.${host}`)),
    ),
  ).toBe(false);

  const frames: Frame[] = [];
  const { context, worker, id, onboarding } = await launch(
    extension,
    inventory.catalogOrigin!,
    testInfo.outputPath('capture-profile'),
  );
  try {
    async function capture(name: string, page: Page, text: string, scroll = 0) {
      const data = await page.screenshot();
      writeFileSync(resolve(captures, `${name}.png`), data);
      const viewport = page.viewportSize()!;
      frames.push({
        name,
        sha256: hash(data),
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
        text,
        viewport: { ...viewport, scale: 1, scroll },
      });
    }

    // 5. The consent screen: onboarding after the cards are saved (hosted builds only).
    await expect(onboarding.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
    await pickSampleCards(onboarding);
    await onboarding.getByRole('button', { name: 'Save cards' }).click();
    const consent = onboarding.getByRole('heading', { name: 'Help improve AI Checkout' });
    await expect(consent).toBeVisible();
    await expect(onboarding.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(onboarding.getByRole('button', { name: 'Not now' })).toBeVisible();
    // The whole screen fits the window: nothing is below the fold.
    expect(await onboarding.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      WINDOW.height,
    );
    await capture('consent', onboarding, await onboarding.locator('body').innerText());
    await onboarding.getByRole('button', { name: 'Not now' }).click();
    await expect(onboarding.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    await onboarding.close();
    // Not now: consent declined, no identifier, nothing queued or sent.
    expect(
      await worker.evaluate(async () => {
        const state = (await chrome.storage.local.get('checkoutTelemetryV1')).checkoutTelemetryV1 as {
          consent: string;
          installId: string | null;
          queue: unknown[];
        };
        return { consent: state.consent, installId: state.installId, queued: state.queue.length };
      }),
    ).toEqual({ consent: 'declined', installId: null, queued: 0 });

    // 2. The badge's amount view at a store the release names, expanded, with the evidence line.
    const named = await context.newPage();
    await named.goto(`https://${NAMED_STORE.host}/cart`);
    let badge = await expandBadge(named, /Use Freedom Unlimited · \$3\.00 back on this cart/);
    await expect(
      badge.getByText(`Based on $100.00 cart estimated total at ${NAMED_STORE.name}.`, { exact: false }),
    ).toBeVisible();
    await expect(
      badge.getByText("Treated as a restaurant (its own pages; fits Chase's restaurant definition).", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      badge.getByText('3% on “dining at restaurants, including takeout and eligible delivery services”', {
        exact: false,
      }),
    ).toBeVisible();
    await capture('badge', named, await badge.locator('body').innerText());
    // Only the store's id and host reached the extension: no path, no page text.
    const session = JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null)));
    expect(session).toContain(`"merchantId":"${NAMED_STORE.id}"`);
    expect(session).not.toMatch(/\/cart|Sample item|Order summary/);
    await named.close();

    // 3. The rates view at a store the release does not name: a gift card is applied, so the reader withholds
    // the amount and the badge ranks the cards by rate instead.
    const generic = await context.newPage();
    await generic.goto(`https://${GENERIC_HOST}/cart`);
    badge = await expandBadge(generic, /Use Blue Cash Everyday · 3% back at this store/);
    await expect(badge.getByText(/The cart amount wasn’t read on this page/)).toBeVisible();
    await expect(badge.getByRole('list', { name: 'Your cards by rate, best first' })).toBeVisible();
    await expect(badge.getByLabel('Amount (USD, optional)')).toHaveValue('');
    await capture('rates', generic, await badge.locator('body').innerText());
    await generic.close();

    // The popup page at the toolbar popup's own size. In a tab the popup has no store tab, so its Merchant is
    // the generic store ("Another U.S. online store"), as at any store the release does not name.
    const popup = await context.newPage();
    await popup.setViewportSize(POPUP);
    await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
    await expect(popup.getByRole('heading', { name: 'Your cards' })).toBeVisible();
    await expect(popup.getByLabel('Merchant')).toHaveValue('generic-us-online');
    // The popup scrolls inside its 600px height. Before each capture, move its own scroll (never the
    // pixels) by the smallest amount that puts the bottom edge, and the top edge, between lines of text
    // and outside rows, chips and controls. An optional anchor (a heading's text) first scrolls that
    // heading's section to the top.
    const scroller = `(() => [...document.querySelectorAll('.checkout-popup, main')]
      .find((el) => el.scrollHeight > el.clientHeight) ?? document.scrollingElement)()`;
    async function fitCrop(anchor?: string) {
      const offset = await popup.evaluate<number | null>(`(() => {
        const box = ${scroller}, crop = ${POPUP.height}, clear = 3, anchor = ${JSON.stringify(anchor ?? '')};
        if (anchor) {
          const target = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent.trim() === anchor)?.closest('.ac-card, section, li');
          if (!target) throw Error('Crop anchor not found');
          box.scrollTop += target.getBoundingClientRect().top;
        }
        const base = box.scrollTop, edges = [0, crop];
        const cut = (r, slack) => edges.some((e) => r.top < e + slack && r.bottom > e - slack);
        const fits = () => {
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walk.nextNode()) {
            const node = walk.currentNode;
            if (!node.textContent.trim() || !node.parentElement.checkVisibility({ visibilityProperty: true })) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) if (r.width && cut(r, clear)) return false;
          }
          // The header bar starts at the popup's top edge; scrolling only trims its top padding.
          for (const el of document.body.querySelectorAll('*:not(.popup-header)')) {
            const r = el.getBoundingClientRect();
            if (!r.height || r.height > 72 || !el.checkVisibility({ visibilityProperty: true })) continue;
            const s = getComputedStyle(el);
            const drawn = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0 ||
              parseFloat(s.borderBottomWidth) > 0 || el.matches('input, select, textarea, button, summary, svg, img');
            if (drawn && cut(r, -0.5)) return false;
          }
          return true;
        };
        for (let step = 0; step <= 200; step++) {
          const d = step % 2 ? (step + 1) / 2 : -step / 2;
          // Keep an anchored section's top in view: only scroll back from it.
          if (d < (anchor ? -150 : -60) || (anchor && d > 0)) continue;
          box.scrollTop = base + d;
          if (Math.abs(box.scrollTop - (base + d)) <= 0.5 && fits()) return box.scrollTop;
        }
        return null;
      })()`);
      expect(offset, 'No clean crop for this capture').not.toBeNull();
      return offset!;
    }

    // 1. Wallet search: the popup's card editor with a search under way (three matches) above the sample cards.
    await popup.getByRole('button', { name: 'Edit cards' }).click();
    const search = popup.getByRole('combobox', { name: 'Add a card' });
    await search.fill('Savor');
    await expect(popup.getByRole('option', { name: 'Capital One Savor', exact: true })).toBeVisible();
    await expect(popup.getByRole('listbox', { name: 'Matching cards' }).getByRole('option')).toHaveCount(3);
    await expect(popup.getByText('Cards you own (4)')).toBeVisible();
    await capture('wallet', popup, await popup.locator('body').innerText(), await fitCrop());
    await popup.getByRole('button', { name: 'Cancel' }).click();

    // 4. The comparison: a $100 eligible purchase at the generic store, the best card with its rule in the
    // issuer's words and its conditions.
    await popup.getByLabel('Purchase amount (USD)').fill('100');
    await popup.getByLabel('Online retail bonus eligibility').selectOption('eligible');
    await popup.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await popup.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(popup.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toBeVisible();
    await expect(
      popup.getByText('Saved estimate for a $100.00 Another U.S. online store purchase.'),
    ).toBeVisible();
    await expect(popup.getByText('3% on “U.S. online retail purchases”', { exact: false })).toBeVisible();
    await expect(popup.getByText('$3.00', { exact: true })).toBeVisible();
    await capture(
      'comparison',
      popup,
      await popup.locator('body').innerText(),
      await fitCrop('Use Blue Cash Everyday'),
    );
    await popup.close();

    writeFileSync(
      resolve(output, 'capture-manifest.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          browser: context.browser()?.version(),
          artifactSha256: inventory.sha256,
          extensionVersion: '2.1.0',
          catalogOrigin: inventory.catalogOrigin,
          catalogVersion: CATALOG_V3.version,
          catalogExpiresAt: CATALOG_V3.expiresAt,
          merchantReleaseVersion: MERCHANTS_V1.version,
          source:
            'Actual packaged extension (hosted build): the popup page at its 360×600 popup size, the badge on a neutral fictional sample cart in an 880×800 window, the onboarding consent screen; four sample cards.',
          sampleCards: SAMPLE_CARDS,
          namedStore: `${NAMED_STORE.name} (${NAMED_STORE.id}): a fictional store on a reserved .example host, added to a test copy of merchant release ${MERCHANTS_V1.version} cached in the capture profile and served the sample cart at https://${NAMED_STORE.host}/cart; not in the shipped store list`,
          liveMerchant: false,
          network: `Page traffic blocked except the two in-memory sample carts; the catalog origin ${inventory.catalogOrigin} resolved to 127.0.0.1, so no refresh or usage report left the machine; "Not now" chosen on the consent screen.`,
          amountsAre: 'Conditional estimates using sample inputs, not customer savings or earned rewards.',
          frames,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await context.close();
  }

  if (process.env.RELEASE_ASSETS_ONLY === 'screenshots') {
    // A visual-only recapture can reuse a completed recording of these exact
    // packaged bytes; never mix an old video with a changed artifact.
    const previous = JSON.parse(readFileSync(resolve(output, 'demo-chapters.json'), 'utf8'));
    expect(previous.artifactSha256).toBe(inventory.sha256);
    expect(readFileSync(resolve(output, 'shopper-demo.webm')).length).toBeGreaterThan(0);
    return;
  }

  // The staged shopper walkthrough: one tab, recorded, through the first run, a cart at the named store,
  // the rates view at the generic store and the popup comparison. Synthetic inputs; nothing leaves the machine.
  const VIDEO = { width: 880, height: 660 };
  const demo = await launch(extension, inventory.catalogOrigin!, testInfo.outputPath('demo-profile'), {
    viewport: VIDEO,
    recordVideo: { dir: testInfo.outputPath('video'), size: VIDEO },
  });
  const chapters: { atSeconds: number; caption: string }[] = [];
  try {
    await demo.onboarding.close();
    const page = await demo.context.newPage(),
      video = page.video();
    if (!video) throw new Error('Demo recording was not created');
    const started = Date.now();
    const pause = async (caption: string, seconds = 3) => {
      chapters.push({ atSeconds: Math.round((Date.now() - started) / 100) / 10, caption });
      // Deliberate presentation dwell for the recording, never a readiness check.
      await page.waitForTimeout(seconds * 1000);
    };
    await page.goto(`chrome-extension://${demo.id}/src/onboarding/index.html`);
    await expect(page.getByRole('heading', { name: 'Welcome to AI Checkout' })).toBeVisible();
    await pause(
      'Staged demo of the actual extension with sample inputs. No live store, no model; nothing left this machine.',
      3,
    );
    await pickSampleCards(page);
    await pause(
      'First run: search the 178-card catalog and add the cards you own. No card numbers or bank login.',
    );
    await page.getByRole('button', { name: 'Save cards' }).click();
    await expect(page.getByRole('heading', { name: 'Help improve AI Checkout' })).toBeVisible();
    await pause('One question: share usage reports or not. The extension works the same either way.', 4);
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('heading', { name: 'You’re set' })).toBeVisible();
    await pause('Not now: no usage reports are sent.', 2);
    await page.goto(`https://${NAMED_STORE.host}/cart`);
    let badge = await badgeFrame(page);
    const pill = badge.getByRole('button', { name: /Use Freedom Unlimited · \$3\.00 back on this cart/ });
    await expect(pill).toBeVisible();
    await pause(
      'On a cart page, the badge names your best card from the order summary. This fictional sample restaurant is in a test copy of the store list.',
      4,
    );
    await pill.click();
    await expect(badge.getByRole('button', { name: 'Collapse' })).toBeVisible();
    await pause(
      'Every card you own, ranked, with the rule in the issuer’s words, its conditions and why the store’s category applies.',
      5,
    );
    await page.goto(`https://${GENERIC_HOST}/cart`);
    badge = await badgeFrame(page);
    const ratePill = badge.getByRole('button', { name: /Use Blue Cash Everyday · 3% back at this store/ });
    await expect(ratePill).toBeVisible();
    await ratePill.click();
    await expect(badge.getByText(/The cart amount wasn’t read on this page/)).toBeVisible();
    await pause(
      'A gift card is applied here, so the amount is not certain: the badge ranks your cards by rate instead of guessing.',
      5,
    );
    await page.goto(`chrome-extension://${demo.id}/src/popup/index.html`);
    await expect(page.getByRole('heading', { name: 'Your cards' })).toBeVisible();
    await page.getByLabel('Purchase amount (USD)').fill('100');
    await page.getByLabel('Online retail bonus eligibility').selectOption('eligible');
    await page.getByRole('checkbox', { name: /I confirmed the amount/ }).check();
    await pause('The toolbar popup compares any amount you type, at any store.', 3);
    await page.getByRole('button', { name: 'Compare my cards' }).click();
    await expect(page.getByRole('heading', { name: 'Use Blue Cash Everyday' })).toBeVisible();
    await page
      .getByRole('heading', { name: 'Use Blue Cash Everyday' })
      .evaluate((h) => h.closest('section')?.scrollIntoView({ block: 'start' }));
    await pause(
      '$3.00 on $100: a conditional estimate from the issuer’s published terms, not an earned reward.',
      5,
    );
    writeFileSync(
      resolve(output, 'demo-chapters.json'),
      JSON.stringify(
        {
          artifactSha256: inventory.sha256,
          kind: 'Actual extension interaction recording in one tab (onboarding, sample carts, the popup page); synthetic inputs; nothing sent.',
          viewport: VIDEO,
          chapters,
        },
        null,
        2,
      ) + '\n',
    );
    // Finish the page recording while its persistent browser transport is still
    // connected; closing the whole context first invalidates the artifact handle.
    await page.close();
    await video.saveAs(resolve(output, 'shopper-demo.webm'));
  } finally {
    await demo.context.close();
  }
});
