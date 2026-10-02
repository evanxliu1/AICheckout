import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareRewards } from '../../packages/rewards-core/src/engine.ts';
import { catalogV3Schema } from '../../packages/rewards-core/src/schema.ts';
import {
  checkOverlay,
  draftCatalogV3,
  loadOverlayInputs,
  overlayAnchors,
  overlaySchema,
  overlayStats,
} from './catalog-overlay.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const committed = await loadOverlayInputs(root);
const copy = () => structuredClone(committed);
const entry = (state, cardId) => state.overlay.cards.find((card) => card.cardId === cardId);
const parsedOverlay = () => overlaySchema.parse(committed.overlay);
const draft = () => draftCatalogV3({ ...committed, overlay: parsedOverlay() });

test('the corpus inputs are byte-identical to the agent-verified files the overlay was authored against', async () => {
  const hashes = {
    'evals/curation/expansion/corpus.json':
      '17c04cd4362d1412bdb8ae53edd677e1821aa35c53d8b4f45ddde349c3036485',
    'evals/curation/expansion/product-notes.verified.json':
      '619519ec293e55391b76c34cf75cbac0634ce812e05fd4ce67dbefa0c6d56d0d',
    'evals/curation/real/corpus.v2.json': '0737668c6a0aede174acfdb20cdd7ba8ac1285e6a8300f890e24cb19a9b2096e',
  };
  for (const [path, hash] of Object.entries(hashes))
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
      hash,
      path,
    );
});

test('the committed overlay covers every card, other rule, issue and hint and builds a valid catalog v3', () => {
  assert.deepEqual(checkOverlay(committed), []);
  assert.equal(committed.overlay.cards.length, committed.corpora[0].cases.length);
  const catalog = draft();
  assert.equal(catalogV3Schema.safeParse(catalog).success, true);
  assert.equal(
    catalog.cards.length,
    180 - overlayStats(committed.overlay, committed.merchants).heldOutCards.length,
  );
});

test('cards without a base rate are held out', () => {
  const held = overlayStats(committed.overlay, committed.merchants).heldOutCards;
  for (const cardId of ['marriott-bonvoy-bold', 'us-bank-shield']) assert.ok(held.includes(cardId), cardId);
  for (const cardId of held)
    for (const item of [...entry(committed, cardId).issues, ...entry(committed, cardId).hints])
      assert.equal(item.disposition, 'card-held-out');
});

test('Freedom Flex carries the Jan-Mar 2027 quarter after the current one', () => {
  const card = draft().cards.find((c) => c.id === 'chase-freedom-flex');
  const q1 = card.rules.filter((rule) => rule.limitedTime?.startsOn === '2027-01-01');
  assert.ok(q1.length >= 2);
  for (const rule of q1) {
    assert.equal(rule.limitedTime.endsOn, '2027-03-31');
    assert.equal(rule.activation, 'recurring');
  }
  assert.ok(card.rules.some((rule) => rule.limitedTime?.startsOn === '2026-10-01'));
});

test('the three merchant profiles keep their v2 facts and gain brands', async () => {
  const real = JSON.parse(await readFile(join(root, 'evals/curation/real/merchants.json'), 'utf8'));
  for (const merchant of real.merchants) {
    const { brandIds, ...rest } = committed.merchants.merchants.find((m) => m.id === merchant.id);
    assert.deepEqual(rest, merchant);
    assert.equal(brandIds.length, 1);
  }
  assert.deepEqual(
    committed.merchants.merchants.map((m) => [m.id, m.brandIds[0]]),
    [
      ['best-buy-us', 'best-buy'],
      ['newegg-us', 'newegg'],
      ['amazon-us', 'amazon'],
    ],
  );
});

test('an undisposed other rule, issue or hint fails', () => {
  const state = copy();
  const card = state.overlay.cards.find((c) => !c.heldOut && c.issues.length && c.hints.length);
  const other = card.rules.findIndex((patch) => patch.was.category === 'other');
  const issue = card.issues.shift();
  const hint = card.hints.shift();
  const problems = checkOverlay(state);
  assert.ok(problems.includes(`card ${card.cardId} issue ${issue.index}: no disposition`));
  assert.ok(problems.includes(`card ${card.cardId} hint ${hint.index}: no disposition`));
  if (other >= 0) {
    const [patch] = card.rules.splice(other, 1);
    assert.ok(
      checkOverlay(state).includes(
        `card ${card.cardId} rule ${patch.index}: other rule without a disposition`,
      ),
    );
  }
});

test('a patch whose guard disagrees with the corpus rule fails', () => {
  const state = copy();
  const card = state.overlay.cards.find((c) => c.rules.length);
  card.rules[0].was.rateBps = 9999;
  assert.ok(
    checkOverlay(state).some((p) => p.startsWith(`card ${card.cardId} rule ${card.rules[0].index}: was `)),
  );
});

test('an other rule kept without brand scope fails', () => {
  const state = copy();
  const card = state.overlay.cards.find((c) =>
    c.rules.some((p) => p.was.category === 'other' && p.set?.brandIds?.length),
  );
  const patch = card.rules.find((p) => p.was.category === 'other' && p.set?.brandIds?.length);
  patch.set.brandIds = [];
  assert.ok(
    checkOverlay(state).includes(
      `card ${card.cardId} rule ${patch.index}: an other rule must be brand-scoped, recategorized or held out`,
    ),
  );
});

test('unknown brands and gates fail', () => {
  const state = copy();
  const card = state.overlay.cards.find((c) => c.rules.some((p) => p.set?.brandIds?.length));
  const patch = card.rules.find((p) => p.set?.brandIds?.length);
  patch.set.brandIds = ['acme-nowhere'];
  assert.ok(
    checkOverlay(state).includes(`card ${card.cardId} rule ${patch.index}: unknown brand acme-nowhere`),
  );
  const gated = copy();
  const withGate = gated.overlay.cards.find((c) => c.addedRules.some((r) => r.requires.length));
  withGate.addedRules.find((r) => r.requires.length).requires[0].gateId = 'acme-gate';
  assert.ok(checkOverlay(gated).some((p) => p.endsWith('unknown gate acme-gate')));
});

test('dispositions must agree with the card being held out', () => {
  const state = copy();
  const card = state.overlay.cards.find((c) => !c.heldOut && c.issues.length);
  card.issues[0].disposition = 'card-held-out';
  card.issues[0].how = [];
  assert.ok(
    checkOverlay(state).includes(
      `card ${card.cardId} issue ${card.issues[0].index}: card-held-out on a card that is not held out`,
    ),
  );
});

test('the draft catalog check catches an invariant the overlay breaks', () => {
  // The Newegg store card has no all-purchases rule; it is valid only as a closed-loop card.
  const state = copy();
  entry(state, 'synchrony-newegg-store-credit-card').acceptance = { kind: 'open-loop' };
  assert.ok(
    checkOverlay(state).some((p) =>
      p.startsWith(
        'draft catalog card synchrony-newegg-store-credit-card rules: An open-loop card needs exactly one',
      ),
    ),
  );
});

test('every anchor is listed for the verbatim check', () => {
  const anchors = overlayAnchors(committed.overlay);
  assert.ok(anchors.length > 100);
  for (const [, anchor] of anchors) assert.match(anchor.sourceId, /^[a-z0-9][a-z0-9-]*$/);
});

test('an account-age rate with no dates needs a gate, since the engine would always apply it', () => {
  const state = copy();
  const patch = entry(state, 'synchrony-onepay-cashrewards-card').rules.find((p) => p.index === 1);
  delete patch.set.requires;
  assert.ok(
    checkOverlay(state).includes(
      'card synchrony-onepay-cashrewards-card rule 1: a limited-time rule with no dates needs a gate',
    ),
  );
  const unpatched = copy();
  const card = entry(unpatched, 'synchrony-jcpenney-mastercard');
  card.rules = card.rules.filter((p) => p.index !== 2);
  assert.ok(
    checkOverlay(unpatched).includes(
      'card synchrony-jcpenney-mastercard rule 2: a limited-time rule with no dates needs a gate',
    ),
  );
});

test('account-age gates leave a range when unanswered and the after answer earns the standing rate', () => {
  const catalog = draft();
  const card = catalog.cards.find((c) => c.id === 'boa-customized-cash-rewards');
  const gateId = 'boa-customized-cash-rewards-first-year';
  assert.equal(card.rules.filter((r) => r.requires.some((q) => q.gateId === gateId)).length, 7);
  // Every bonus rule activated and no spend toward the shared quarterly cap yet.
  const usage = card.rules.map((r) => ({
    ruleId: r.id,
    calendarYear: 2026,
    recordedOn: '2026-10-15',
    spentCents: 0,
    activation: 'active',
  }));
  const earn = (gates) => {
    const wallet = {
      cards: [
        {
          cardId: card.id,
          usage,
          choices: [{ choiceId: 'choice-category', optionIds: ['online-shopping'] }],
        },
      ],
      defaultCardId: null,
      gates,
    };
    const purchase = {
      merchantId: 'amazon-us',
      currency: 'USD',
      amountCents: 20_000,
      purchasedOn: '2026-10-15',
      eligiblePurchase: 'eligible',
      onlineRetail: 'eligible',
    };
    const [estimate] = compareRewards(
      catalog,
      wallet,
      purchase,
      Date.parse('2026-10-15T12:00:00Z'),
    ).estimates;
    return [estimate.minRewardCents, estimate.maxRewardCents];
  };
  assert.deepEqual(earn([]), [600, 1200]);
  assert.deepEqual(earn([{ gateId, optionId: 'after-first-year' }]), [600, 600]);
  assert.deepEqual(earn([{ gateId, optionId: 'first-year' }]), [1200, 1200]);
});

test('store-credit cash-back programs count cents, and their programDetails repeat the program', () => {
  for (const program of committed.overlay.programs) {
    const detail = committed.overlay.programDetails.find((d) => d.programId === program.id);
    assert.equal(detail.unitName, program.unitName, program.id);
    assert.deepEqual(detail.redemptionBrandIds, program.redemptionBrandIds, program.id);
    // TJX Rewards Points are worth one cent each (1,000 points = a $10 certificate).
    assert.equal(program.unitName, program.id === 'tjx-rewards-certificates' ? 'Rewards Points' : 'cents');
  }
  const state = copy();
  state.overlay.programDetails.find((d) => d.programId === 'verizon-dollars').unitName = 'Verizon Dollars';
  assert.ok(
    checkOverlay(state).includes('programDetails verizon-dollars: differs from the store-credit program'),
  );
});
