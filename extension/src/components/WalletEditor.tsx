import { useState } from 'react';
import { AlertInline, Button, Card, Checkbox, Field, Fieldset, Select, TextInput } from '@ai-checkout/ui';
import { parseUsd, usageInputs } from '../domain';
import type { Catalog, RuleUsage, Wallet } from '../domain';
import { localDate, MAX_WALLET_CARDS } from '../state/keys';

type Input = { spend: string; activation: RuleUsage['activation'] };

/** Cards grouped by issuer, in catalog order (a v1 catalog has no issuer field). */
function byIssuer(catalog: Catalog) {
  const groups = new Map<string, Catalog['cards']>();
  for (const card of catalog.cards) {
    const issuer = 'issuer' in card ? card.issuer : 'Cards';
    groups.set(issuer, [...(groups.get(issuer) ?? []), card] as Catalog['cards']);
  }
  return [...groups];
}

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
  const [inputs, setInputs] = useState<Record<string, Input>>(() =>
    Object.fromEntries(
      catalog.cards.flatMap((card) =>
        usageInputs(catalog, card.id).map(({ ruleId }) => {
          const saved = wallet.cards
            .find((c) => c.cardId === card.id)
            ?.usage.find(
              (u) => u.ruleId === ruleId && u.recordedOn === recordedOn && u.calendarYear === year,
            );
          return [
            ruleId,
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
  const shortName = (id: string) => catalog.cards.find((card) => card.id === id)?.shortName;
  const update = (ruleId: string, change: Partial<Input>) =>
    setInputs((current) => ({ ...current, [ruleId]: { ...current[ruleId], ...change } }));

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
    if (selected.length > MAX_WALLET_CARDS) {
      setError(`Choose up to ${MAX_WALLET_CARDS} cards. You have ${selected.length} selected.`);
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
        const spentCents = rule.needsSpend && input.spend.trim() ? parseUsd(input.spend) : null;
        if (rule.needsSpend && input.spend.trim() && spentCents === null) {
          setError(
            `Enter a dollar amount up to $100,000 for ${card.shortName}, or leave its ${rule.label} spend blank.`,
          );
          return;
        }
        const activation = rule.needsActivation ? input.activation : 'unknown';
        if (spentCents !== null || activation !== 'unknown')
          usage.push({ ruleId: rule.ruleId, calendarYear: year, recordedOn, spentCents, activation });
      }
      // Catalog v3 card options have no editor yet (Stage 2 M7); keep what the wallet has.
      const choices = wallet.cards.find((owned) => owned.cardId === card.id)?.choices;
      cards.push(choices ? { cardId: card.id, usage, choices } : { cardId: card.id, usage });
    }
    try {
      await onSave({ ...wallet, defaultCardId: selected.length ? defaultId || selected[0] : null, cards });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your cards could not be saved. Try again.');
    }
  }

  const limits = catalog.cards
    .filter((card) => selected.includes(card.id))
    .flatMap((card) => usageInputs(catalog, card.id).map((rule) => ({ card, rule })));
  return (
    <Card as="section" hasBorder aria-labelledby="wallet-heading">
      <form
        className="card-body space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <h2 id="wallet-heading" className="section-title">
            Your cards
          </h2>
          <p className="supporting mt-1">
            Choose cards you already own. Only product names are saved; no card numbers.
          </p>
        </div>
        {byIssuer(catalog).map(([issuer, cards]) => (
          <Fieldset key={issuer} legend={issuer} disabled={busy}>
            {cards.map((card) => (
              <Checkbox
                key={card.id}
                label={card.name}
                checked={selected.includes(card.id)}
                onChange={() => toggle(card.id)}
              />
            ))}
          </Fieldset>
        ))}
        {unavailable.length > 0 && (
          <Fieldset legend="No longer in the card terms" disabled={busy}>
            {unavailable.map((owned) => (
              <Checkbox
                key={owned.cardId}
                label={`Unavailable card: ${owned.cardId}. Uncheck to remove it.`}
                checked={selected.includes(owned.cardId)}
                onChange={() => toggle(owned.cardId)}
              />
            ))}
          </Fieldset>
        )}
        {selected.length > 1 && (
          <Field
            id="default-card"
            label="Default card"
            helperText="The card you would use anyway. It breaks ties and is the baseline for your all-time extra cash back."
          >
            {(control) => (
              <Select
                {...control}
                value={defaultId}
                disabled={busy}
                onChange={(e) => setDefaultId(e.target.value)}
              >
                {selected.map((id) => (
                  <option key={id} value={id}>
                    {shortName(id) ?? `Unavailable: ${id}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {limits.length > 0 && (
          <div className="space-y-4">
            <h3 className="section-title">Bonus limits</h3>
            {limits.map(({ card, rule }) => (
              <div key={rule.ruleId} className="space-y-3">
                {rule.needsSpend && (
                  <Field
                    id={`spend-${rule.ruleId}`}
                    label={`${card.shortName} ${rule.label} spend in ${year}`}
                    helperText="Optional USD, across your card account. Leave blank if unsure; 0 means none used. Update before each purchase. Becomes unknown tomorrow."
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        inputMode="decimal"
                        maxLength={14}
                        value={inputs[rule.ruleId].spend}
                        disabled={busy}
                        placeholder="Unknown"
                        onChange={(e) => update(rule.ruleId, { spend: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                {rule.needsActivation && (
                  <Field
                    id={`activation-${rule.ruleId}`}
                    label={`${card.shortName} ${rule.label} bonus activation`}
                  >
                    {(control) => (
                      <Select
                        {...control}
                        disabled={busy}
                        value={inputs[rule.ruleId].activation}
                        onChange={(e) =>
                          update(rule.ruleId, { activation: e.target.value as RuleUsage['activation'] })
                        }
                      >
                        <option value="unknown">I’m not sure</option>
                        <option value="active">I confirmed it is active</option>
                        <option value="inactive">Not active</option>
                      </Select>
                    )}
                  </Field>
                )}
              </div>
            ))}
          </div>
        )}
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        <div className="flex gap-2">
          <Button type="submit" isLoading={busy}>
            Save cards
          </Button>
          {onCancel && (
            <Button color="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
