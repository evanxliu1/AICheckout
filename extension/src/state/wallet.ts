import { stableJson } from '../domain';
import type { Catalog, CardProductV3 } from '../domain';
import type { WalletState } from './contracts';

/** A rule in v3 form for comparing terms across catalog versions: a v2 rule gets the v3 fields with
 * the values that leave its meaning unchanged (no brands, shared cap, choice, gate or required
 * payment path; `limitedTime` without a start). Release 1's real cards keep their rule IDs and terms
 * in catalog v3, so their usage rows survive the switch to the v3 bundle. v3 rules are returned as
 * they are; v1 rules keep their other differences and so never match a v3 rule. */
function ruleTerms(rule: Record<string, unknown>): string {
  if ('brandIds' in rule) return stableJson(rule);
  const limitedTime = rule.limitedTime as { endsOn: string | null } | null | undefined;
  return stableJson({
    ...rule,
    ...(limitedTime === undefined
      ? {}
      : { limitedTime: limitedTime && { startsOn: null, endsOn: limitedTime.endsOn } }),
    brandIds: [],
    excludedBrandIds: [],
    sharedCapId: null,
    choice: null,
    requires: [],
    requiredPaymentPaths: [],
  });
}

export interface ReconciledWallet {
  wallet: WalletState;
  /** Usage rows (reported spend or activation) were dropped. */
  usageDropped: boolean;
  /** Chosen categories, gate answers or point values were dropped. */
  optionsDropped: boolean;
}

/** Brings a wallet in line with the catalog in effect: the engine rejects usage rows, choices, gate
 * answers and point values whose IDs the catalog lacks, so those are dropped. Owned cards the
 * catalog lacks stay; comparisons report them (`unknown-owned-card`) until the shopper removes them.
 * With `before` (the catalog the wallet was saved under), a usage row is also dropped when its rule
 * changed, even under the same ID, because the reported limit was for the old terms (compared in v3
 * form, `ruleTerms`, so a v2 rule carried unchanged into v3 keeps its rows). Chosen
 * categories, gate answers and point values describe the shopper, not the terms, so they stay
 * while their IDs still resolve. v1 and v2 catalogs have none of them. */
export function reconcileWallet(
  wallet: WalletState,
  after: Catalog,
  before?: Catalog,
  /** Keep choices, gate answers and point values whatever `after` has: an expired catalog in effect
   * must not cost the shopper their answers (coordinator decision, 2026-10-03). */
  { keepOptions = false }: { keepOptions?: boolean } = {},
): ReconciledWallet {
  let usageDropped = false,
    optionsDropped = false;
  const cards = wallet.cards.map((owned) => {
    const card = after.cards.find((c) => c.id === owned.cardId);
    if (!card) return owned;
    const rules = card.rules as { id: string }[];
    const oldRules = before?.cards.find((c) => c.id === owned.cardId)?.rules as { id: string }[] | undefined;
    const usage = owned.usage.filter((row) => {
      const next = rules.find((r) => r.id === row.ruleId);
      if (!next) return false;
      if (!before) return true;
      const old = oldRules?.find((r) => r.id === row.ruleId);
      return !!old && ruleTerms(old) === ruleTerms(next);
    });
    if (usage.length !== owned.usage.length) usageDropped = true;
    if (owned.choices === undefined || keepOptions) return { ...owned, usage };
    const options = after.schemaVersion === 3 ? (card as CardProductV3).choices : [];
    const choices = owned.choices.filter((picked) => {
      const choice = options.find((c) => c.id === picked.choiceId);
      return (
        choice?.kind === 'chosen' &&
        picked.optionIds.length <= choice.picks &&
        picked.optionIds.every((id) => choice.options.some((o) => o.id === id))
      );
    });
    if (choices.length !== owned.choices.length) optionsDropped = true;
    return { ...owned, usage, choices };
  });
  const next: WalletState = { ...wallet, cards };
  if (wallet.gates !== undefined && !keepOptions) {
    const gates = after.schemaVersion === 3 ? after.gates : [];
    next.gates = wallet.gates.filter((answer) =>
      gates.some((g) => g.id === answer.gateId && g.options.some((o) => o.id === answer.optionId)),
    );
    if (next.gates.length !== wallet.gates.length) optionsDropped = true;
  }
  if (wallet.valueOverrides !== undefined && !keepOptions) {
    const programs = after.schemaVersion === 3 ? after.programs : [];
    // Point values only: cash-back programs have a fixed value.
    next.valueOverrides = wallet.valueOverrides.filter((o) =>
      programs.some((p) => p.id === o.programId && p.currency === 'points'),
    );
    if (next.valueOverrides.length !== wallet.valueOverrides.length) optionsDropped = true;
  }
  return { wallet: next, usageDropped, optionsDropped };
}

/** Whether a catalog's validity window has ended at `now`. */
export const catalogExpired = (catalog: Catalog, now: number) => now >= Date.parse(catalog.expiresAt);

/** A wallet the shopper saves must use only cards and inputs the catalog in effect has; while that
 * catalog has expired, choices, gate answers and point values it lacks are kept, not refused. */
export function validateWallet(wallet: WalletState, catalog: Catalog, now: number): boolean {
  if (!wallet.cards.every((owned) => catalog.cards.some((c) => c.id === owned.cardId))) return false;
  const reconciled = reconcileWallet(wallet, catalog, undefined, {
    keepOptions: catalogExpired(catalog, now),
  });
  return !reconciled.usageDropped && !reconciled.optionsDropped;
}

/** The wallet as the engine sees it: without inputs the catalog lacks (the engine rejects unknown
 * IDs). Kept options of an expired catalog stay in storage; comparisons report the expiry anyway. */
export function engineWallet(wallet: WalletState, catalog: Catalog): WalletState {
  return reconcileWallet(wallet, catalog).wallet;
}
