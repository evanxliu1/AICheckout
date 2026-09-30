import { useState } from 'react';
import { parseUsd, usageInputs } from '../domain';
import type { Catalog, RuleUsage, Wallet } from '../domain';
import { localDate } from '../state/service';

export default function WalletEditor({
  wallet,
  catalog,
  busy,
  onSave,
  onCancel,
}: {
  wallet: Wallet;
  catalog: Catalog;
  busy: boolean;
  onSave: (wallet: Wallet) => Promise<void>;
  onCancel?: () => void;
}) {
  const [recordedOn] = useState(() => localDate(Date.now()));
  const year = Number(recordedOn.slice(0, 4));
  const [selected, setSelected] = useState(wallet.cards.map((c) => c.cardId));
  const [defaultId, setDefaultId] = useState(wallet.defaultCardId ?? wallet.cards[0]?.cardId ?? '');
  const [inputs, setInputs] = useState<
    Record<string, { spend: string; activation: RuleUsage['activation'] }>
  >(() =>
    Object.fromEntries(
      catalog.cards.flatMap((card) =>
        (card.rules as { id: string }[]).map((rule) => {
          const saved = wallet.cards
            .find((c) => c.cardId === card.id)
            ?.usage.find(
              (u) => u.ruleId === rule.id && u.recordedOn === recordedOn && u.calendarYear === year,
            );
          return [
            rule.id,
            {
              spend: saved?.spentCents != null ? (saved.spentCents / 100).toFixed(2) : '',
              activation: saved?.activation ?? 'unknown',
            },
          ];
        }),
      ),
    ),
  );
  const [error, setError] = useState('');
  const unavailable = wallet.cards.filter((owned) => !catalog.cards.some((card) => card.id === owned.cardId));
  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
    setSelected(next);
    if (!next.includes(defaultId)) setDefaultId(next[0] ?? '');
  }
  async function save() {
    setError('');
    if (recordedOn !== localDate(Date.now())) {
      setError('The date changed. Close and reopen the card editor before entering today’s reward limits.');
      return;
    }
    if (selected.some((id) => !catalog.cards.some((card) => card.id === id))) {
      setError('Remove unavailable cards before saving. They cannot be compared with these terms.');
      return;
    }
    const cards: Wallet['cards'] = [];
    for (const card of catalog.cards.filter((card) => selected.includes(card.id))) {
      const usage: RuleUsage[] = [];
      for (const rule of usageInputs(catalog, card.id)) {
        const input = inputs[rule.ruleId];
        const spentCents = input.spend.trim() ? parseUsd(input.spend) : null;
        if (input.spend.trim() && spentCents === null) {
          setError(
            `Enter a dollar amount up to $100,000 for ${card.shortName}, or leave its annual spend blank.`,
          );
          return;
        }
        if (spentCents !== null || input.activation !== 'unknown')
          usage.push({
            ruleId: rule.ruleId,
            calendarYear: year,
            recordedOn,
            spentCents: rule.needsSpend ? spentCents : null,
            activation: rule.needsActivation ? input.activation : 'unknown',
          });
      }
      cards.push({ cardId: card.id, usage });
    }
    try {
      await onSave({ defaultCardId: selected.length ? defaultId || selected[0] : null, cards });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your cards could not be saved. Try again.');
    }
  }
  return (
    <section aria-labelledby="wallet-heading" className="surface">
      <h2 id="wallet-heading" className="text-lg font-semibold">
        Your cards
      </h2>
      <p className="supporting mt-1">
        Choose cards you already own. Only product names are saved; no card numbers.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="mt-4 space-y-3">
          <legend className="sr-only">Owned cards</legend>
          {catalog.cards.map((card) => (
            <label key={card.id} className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                className="mt-1"
                type="checkbox"
                checked={selected.includes(card.id)}
                onChange={() => toggle(card.id)}
              />
              <span>{card.name}</span>
            </label>
          ))}
          {unavailable.map((owned) => (
            <label key={owned.cardId} className="flex items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={selected.includes(owned.cardId)}
                onChange={() => toggle(owned.cardId)}
              />
              <span>Unavailable card: {owned.cardId}. Uncheck to remove it.</span>
            </label>
          ))}
        </fieldset>
        {selected.length > 1 && (
          <div className="mt-4">
            <label htmlFor="default-card" className="field-label">
              Preferred card when rewards tie
            </label>
            <select
              id="default-card"
              value={defaultId}
              disabled={busy}
              onChange={(e) => setDefaultId(e.target.value)}
              className="field-input"
            >
              {selected.map((id) => (
                <option key={id} value={id}>
                  {catalog.cards.find((card) => card.id === id)?.shortName ?? `Unavailable: ${id}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {catalog.cards
          .filter((card) => selected.includes(card.id))
          .flatMap((card) =>
            usageInputs(catalog, card.id).map(({ ruleId, label, needsSpend, needsActivation }) => {
              return (
                <div key={ruleId} className="mt-4">
                  {needsSpend && (
                    <>
                      <label htmlFor={`spend-${ruleId}`} className="field-label">
                        {card.shortName} {label} spend in {year}
                      </label>
                      <input
                        id={`spend-${ruleId}`}
                        inputMode="decimal"
                        type="text"
                        maxLength={14}
                        value={inputs[ruleId].spend}
                        disabled={busy}
                        onChange={(e) =>
                          setInputs({ ...inputs, [ruleId]: { ...inputs[ruleId], spend: e.target.value } })
                        }
                        className="field-input"
                        placeholder="Unknown"
                        aria-describedby={`spend-help-${ruleId}`}
                      />
                      <p id={`spend-help-${ruleId}`} className="supporting mt-2">
                        Optional USD, across your card account. Leave blank if unsure; 0 means none used.
                        Update before each purchase. Becomes unknown tomorrow.
                      </p>
                    </>
                  )}
                  {needsActivation && (
                    <>
                      <label htmlFor={`activation-${ruleId}`} className="field-label mt-3">
                        {card.shortName} {label} bonus activation
                      </label>
                      <select
                        id={`activation-${ruleId}`}
                        className="field-input"
                        disabled={busy}
                        value={inputs[ruleId].activation}
                        onChange={(e) =>
                          setInputs({
                            ...inputs,
                            [ruleId]: {
                              ...inputs[ruleId],
                              activation: e.target.value as RuleUsage['activation'],
                            },
                          })
                        }
                      >
                        <option value="unknown">I’m not sure</option>
                        <option value="active">I confirmed it is active</option>
                        <option value="inactive">Not active</option>
                      </select>
                    </>
                  )}
                </div>
              );
            }),
          )}
        {error && (
          <p role="alert" className="error-message mt-3">
            {error}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save cards'}
          </button>
          {onCancel && (
            <button className="btn-secondary" disabled={busy} type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
