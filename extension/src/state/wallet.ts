import { stableJson } from '../domain';
import type { Catalog, CardProductV3 } from '../domain';
import type { WalletState } from './contracts';

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
 * changed, even under the same ID, because the reported limit was for the old terms. Chosen
 * categories, gate answers and point values describe the shopper, not the terms, so they stay
 * while their IDs still resolve. v1 and v2 catalogs have none of them. */
export function reconcileWallet(wallet: WalletState, after: Catalog, before?: Catalog): ReconciledWallet {
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
      return !!old && stableJson(old) === stableJson(next);
    });
    if (usage.length !== owned.usage.length) usageDropped = true;
    if (owned.choices === undefined) return { ...owned, usage };
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
  if (wallet.gates !== undefined) {
    const gates = after.schemaVersion === 3 ? after.gates : [];
    next.gates = wallet.gates.filter((answer) =>
      gates.some((g) => g.id === answer.gateId && g.options.some((o) => o.id === answer.optionId)),
    );
    if (next.gates.length !== wallet.gates.length) optionsDropped = true;
  }
  if (wallet.valueOverrides !== undefined) {
    const programs = after.schemaVersion === 3 ? after.programs : [];
    // Point values only: cash-back programs have a fixed value.
    next.valueOverrides = wallet.valueOverrides.filter((o) =>
      programs.some((p) => p.id === o.programId && p.currency === 'points'),
    );
    if (next.valueOverrides.length !== wallet.valueOverrides.length) optionsDropped = true;
  }
  return { wallet: next, usageDropped, optionsDropped };
}

/** A wallet the shopper saves must use only cards and inputs the catalog in effect has. */
export function validateWallet(wallet: WalletState, catalog: Catalog): boolean {
  if (!wallet.cards.every((owned) => catalog.cards.some((c) => c.id === owned.cardId))) return false;
  const reconciled = reconcileWallet(wallet, catalog);
  return !reconciled.usageDropped && !reconciled.optionsDropped;
}
