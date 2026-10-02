import { z } from 'zod';
import {
  catalogResponseSchema,
  CATALOG_V2,
  catalogSchema,
  redateCatalog,
  publishedReleaseSchema,
  stableJson,
} from '../domain';
import type { Catalog } from '../domain';
import type { AppState } from './contracts';

// The bundled fallback is the real catalog v2; cached v1 releases are still accepted.
// Browser-test builds (dist-e2e, never packaged) set VITE_E2E_CATALOG_DATE so the bundled
// catalog's validity window follows the test run instead of expiring with the real terms.
const e2eCatalogDate = import.meta.env?.VITE_E2E_CATALOG_DATE;
const bundled = catalogSchema.parse(e2eCatalogDate ? redateCatalog(CATALOG_V2, e2eCatalogDate) : CATALOG_V2);
export const cachedCatalogSchema = z.strictObject({
  release: publishedReleaseSchema.nullable(),
  lastCheckedAt: z.number().int().nonnegative().nullable(),
});
export const emptyCatalogCache = () => ({ release: null, lastCheckedAt: null });
export function currentCatalog(state: Pick<AppState, 'catalog'>): Catalog {
  return state.catalog.release?.catalog ?? bundled;
}
export class CatalogUpdateError extends Error {}

/** Pure transition; the worker commits catalog/wallet/result changes in one storage write. */
export function prepareCatalogUpdate(state: AppState, input: unknown, now: number) {
  const parsed = catalogResponseSchema.safeParse(input);
  if (!parsed.success)
    throw new CatalogUpdateError('Updated card terms could not be verified. Your saved terms were kept.');
  const incoming = parsed.data.release,
    previous = state.catalog.release;
  // Catalog schema 3 is a contract only until the extension runs the v3 engine (Stage 2 M6), so a
  // v3 release is refused like the earlier schema refused it, and the saved terms are kept.
  if (incoming?.catalog.schemaVersion === 3)
    throw new CatalogUpdateError(
      'Updated card terms need a newer version of this extension. Your saved terms were kept.',
    );
  const checked = { ...state, catalog: { ...state.catalog, lastCheckedAt: now } };
  if (!incoming) {
    if (previous)
      throw new CatalogUpdateError(
        'The service is missing the published catalog. Your saved terms were kept.',
      );
    return {
      state: checked,
      notice: 'No published update is available. Using the terms bundled with this extension.',
    };
  }
  if (
    Date.parse(incoming.catalog.verifiedAt) > now ||
    Date.parse(incoming.published_at) > now ||
    Date.parse(incoming.catalog.expiresAt) <= now
  ) {
    throw new CatalogUpdateError(
      'Updated card terms are expired or not yet valid. Your saved terms were kept.',
    );
  }
  if (previous && incoming.sequence < previous.sequence)
    throw new CatalogUpdateError('The service returned an older release. Your newer card terms were kept.');
  if (previous && incoming.sequence === previous.sequence) {
    if (stableJson(incoming) !== stableJson(previous))
      throw new CatalogUpdateError('A published release changed unexpectedly. Your saved terms were kept.');
    return { state: checked, notice: 'Your card terms are up to date.' };
  }
  if (previous && incoming.version === previous.version)
    throw new CatalogUpdateError('The update reused a published version. Your saved terms were kept.');
  const before = currentCatalog(state),
    after = incoming.catalog;
  let changedUsage = false;
  // Missing cards stay in the wallet and block comparisons. Changed rule definitions
  // invalidate their reported limits, even when the publisher reuses the rule ID.
  const cards = state.wallet.cards.map((owned) => {
    const nextCard = after.cards.find((card) => card.id === owned.cardId);
    if (!nextCard) return owned;
    const oldCard = before.cards.find((card) => card.id === owned.cardId);
    const usage = owned.usage.filter((item) => {
      const oldRule = oldCard?.rules.find((rule) => rule.id === item.ruleId);
      const nextRule = nextCard.rules.find((rule) => rule.id === item.ruleId);
      return oldRule && nextRule && stableJson(oldRule) === stableJson(nextRule);
    });
    if (usage.length !== owned.usage.length) changedUsage = true;
    return { ...owned, usage };
  });
  const missing = cards.some((owned) => !after.cards.some((card) => card.id === owned.cardId));
  return {
    state: {
      ...checked,
      revision: state.revision + 1,
      catalog: { release: incoming, lastCheckedAt: now },
      wallet: { ...state.wallet, cards },
      comparison: null,
    } satisfies AppState,
    notice: missing
      ? 'Card terms updated. A saved card is unavailable; review your cards before comparing.'
      : changedUsage
        ? 'Card terms updated. Some reward limits need confirmation; edit your cards before comparing.'
        : 'Card terms updated. Confirm the purchase amount and compare again.',
  };
}
