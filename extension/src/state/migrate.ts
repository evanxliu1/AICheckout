import { currentCatalog } from './catalog';
import type { AppState, StoredAppState } from './contracts';

export const MIGRATION_NOTICE =
  'Card terms were updated in this version. Some saved reward limits no longer apply; review your cards before comparing.';

/** Brings pilot-era (schema 1) state to schema 2. Wallet card IDs carry over unchanged; usage rows
 * for rules the current catalog no longer has are dropped (the v2 engine rejects unknown rule IDs),
 * and any saved comparison is cleared because it was computed under the old rules. */
export function migrateState(saved: StoredAppState): { state: AppState; notice: string | null } {
  if (saved.schemaVersion === 2) return { state: saved, notice: null };
  const catalog = currentCatalog(saved);
  let dropped = 0;
  const cards = saved.wallet.cards.map((owned) => {
    const card = catalog.cards.find((c) => c.id === owned.cardId);
    if (!card) return owned;
    const usage = owned.usage.filter((row) =>
      (card.rules as { id: string }[]).some((r) => r.id === row.ruleId),
    );
    dropped += owned.usage.length - usage.length;
    return { ...owned, usage };
  });
  return {
    state: {
      ...saved,
      schemaVersion: 2,
      revision: saved.revision + 1,
      wallet: { ...saved.wallet, cards },
      comparison: null,
      pendingNotice: dropped ? MIGRATION_NOTICE : null,
    },
    notice: dropped ? MIGRATION_NOTICE : null,
  };
}
