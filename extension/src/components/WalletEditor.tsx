import { useMemo, useState } from 'react';
import {
  AlertInline,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  Field,
  Fieldset,
  Radio,
  Select,
  TextInput,
} from '@ai-checkout/ui';
import { parseUsd, usageInputs } from '../domain';
import type { Catalog, CardProductV3, RuleUsage, Wallet } from '../domain';
import { localDate, MAX_WALLET_CARDS as MAX_CARDS } from '../state/keys';
import { centsEach } from './estimates';
import {
  choiceQuestions,
  formatCentsEach,
  gateQuestions,
  parseCentsEach,
  pointPrograms,
} from './wallet-options';

type Input = { spend: string; activation: RuleUsage['activation'] };
const EMPTY_INPUT: Input = { spend: '', activation: 'unknown' };
const key = (cardId: string, id: string) => `${cardId}/${id}`;
const issuerOf = (card: Catalog['cards'][number]) => ('issuer' in card ? card.issuer : 'Cards');
const dateCopy = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });

/**
 * Picks the cards the shopper owns and the facts that change their rewards: a search box over the
 * whole catalog (grouped by issuer), each owned card's chosen categories, wallet-level questions
 * about memberships and tiers (asked once), spend toward bonus limits, activation, and the value of
 * each points program. Catalog v3 questions appear only for cards that have them.
 */
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
      wallet.cards.flatMap((owned) =>
        owned.usage
          .filter((u) => u.recordedOn === recordedOn && u.calendarYear === year)
          .map((u) => [
            key(owned.cardId, u.ruleId),
            { spend: u.spentCents != null ? (u.spentCents / 100).toFixed(2) : '', activation: u.activation },
          ]),
      ),
    ),
  );
  /** Chosen categories per card and choice; an empty list is "not sure". */
  const [choices, setChoices] = useState<Record<string, Record<string, string[]>>>(() =>
    Object.fromEntries(
      wallet.cards.map((owned) => [
        owned.cardId,
        Object.fromEntries((owned.choices ?? []).map((c) => [c.choiceId, c.optionIds])),
      ]),
    ),
  );
  /** Choices filled in with the card's defaults when it was added, until the shopper changes them. */
  const [prefilled, setPrefilled] = useState<Set<string>>(() => new Set());
  /** Gate answers; a missing entry is "not sure". */
  const [gates, setGates] = useState<Record<string, string>>(() =>
    Object.fromEntries((wallet.gates ?? []).map((g) => [g.gateId, g.optionId])),
  );
  /** Point values as typed, in cents per unit; blank uses the default. */
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (wallet.valueOverrides ?? []).map((o) => [o.programId, formatCentsEach(o.valueHundredthsOfCent)]),
    ),
  );
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');

  const cardOf = (id: string) => catalog.cards.find((card) => card.id === id);
  const owned = catalog.cards.filter((card) => selected.includes(card.id));
  const unavailable = selected.filter((id) => !cardOf(id));
  const options = useMemo(
    () =>
      catalog.cards
        .filter((card) => !selected.includes(card.id))
        .map((card) => ({ id: card.id, label: card.name, group: issuerOf(card), keywords: card.shortName }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
    [catalog, selected],
  );
  const input = (cardId: string, ruleId: string) => inputs[key(cardId, ruleId)] ?? EMPTY_INPUT;
  const update = (cardId: string, ruleId: string, change: Partial<Input>) =>
    setInputs((current) => ({
      ...current,
      [key(cardId, ruleId)]: { ...(current[key(cardId, ruleId)] ?? EMPTY_INPUT), ...change },
    }));
  const choose = (cardId: string, choiceId: string, optionIds: string[]) => {
    setChoices((current) => ({ ...current, [cardId]: { ...current[cardId], [choiceId]: optionIds } }));
    setPrefilled((current) => {
      const next = new Set(current);
      next.delete(key(cardId, choiceId));
      return next;
    });
  };

  function add(id: string) {
    if (selected.includes(id) || selected.length >= MAX_CARDS) return;
    const next = [...selected, id];
    setSelected(next);
    if (!next.includes(defaultId)) setDefaultId(next[0] ?? '');
    // Suggest the issuer's default categories for a card added now; the shopper can change them.
    const defaults = choiceQuestions(catalog, id).filter(
      (choice) => choice.defaultOptionIds.length > 0 && choices[id]?.[choice.id] === undefined,
    );
    if (defaults.length) {
      setChoices((current) => ({
        ...current,
        [id]: {
          ...current[id],
          ...Object.fromEntries(defaults.map((c) => [c.id, c.defaultOptionIds.slice(0, c.picks)])),
        },
      }));
      setPrefilled((current) => new Set([...current, ...defaults.map((c) => key(id, c.id))]));
    }
    setAnnouncement(`Added ${cardOf(id)?.name ?? id}. ${next.length} of ${MAX_CARDS} cards.`);
  }
  function remove(id: string) {
    const next = selected.filter((c) => c !== id);
    setSelected(next);
    if (!next.includes(defaultId)) setDefaultId(next[0] ?? '');
    setAnnouncement(`Removed ${cardOf(id)?.name ?? 'the unavailable card'}.`);
    // The button is gone; return focus to the search field.
    document.getElementById('add-card')?.focus();
  }

  /** Usage inputs that can matter. A rule tied to a category the shopper did not choose cannot earn,
   * so its activation is not asked; its spend field stays when it holds a shared cap that a chosen
   * category of the group still uses. */
  const limits = owned.flatMap((card) => {
    const usable = (ruleId: string) => {
      if (catalog.schemaVersion !== 3) return true;
      const choice = (card as CardProductV3).rules.find((r) => r.id === ruleId)?.choice;
      const picked = choice ? choices[card.id]?.[choice.choiceId] : undefined;
      return !choice || !picked?.length || picked.includes(choice.optionId);
    };
    const shared = (ruleId: string) => {
      if (catalog.schemaVersion !== 3) return [ruleId];
      const rules = (card as CardProductV3).rules;
      const capId = rules.find((r) => r.id === ruleId)?.sharedCapId;
      return capId ? rules.filter((r) => r.sharedCapId === capId).map((r) => r.id) : [ruleId];
    };
    return usageInputs(catalog, card.id).flatMap((rule) => {
      const needsActivation = rule.needsActivation && usable(rule.ruleId);
      const needsSpend = rule.needsSpend && shared(rule.ruleId).some(usable);
      return needsActivation || needsSpend ? [{ card, rule: { ...rule, needsActivation, needsSpend } }] : [];
    });
  });
  const cardChoices = owned.flatMap((card) =>
    choiceQuestions(catalog, card.id).map((choice) => ({ card, choice })),
  );
  const questions = gateQuestions(catalog, selected);
  const programs = pointPrograms(catalog, selected);

  async function save() {
    setError('');
    if (recordedOn !== localDate(Date.now())) {
      setError('The date changed. Close and reopen the card editor before entering today’s reward limits.');
      return;
    }
    if (unavailable.length) {
      setError('Remove unavailable cards before saving. They cannot be compared with these terms.');
      return;
    }
    const cards: Wallet['cards'] = [];
    for (const card of owned) {
      const usage: RuleUsage[] = [];
      for (const rule of usageInputs(catalog, card.id)) {
        const entry = input(card.id, rule.ruleId);
        const spentCents = rule.needsSpend && entry.spend.trim() ? parseUsd(entry.spend) : null;
        if (rule.needsSpend && entry.spend.trim() && spentCents === null) {
          setError(
            `Enter a dollar amount up to $100,000 for ${card.shortName}, or leave its ${rule.label} spend blank.`,
          );
          return;
        }
        const activation = rule.needsActivation ? entry.activation : 'unknown';
        if (spentCents !== null || activation !== 'unknown')
          usage.push({ ruleId: rule.ruleId, calendarYear: year, recordedOn, spentCents, activation });
      }
      if (catalog.schemaVersion !== 3) {
        cards.push({ cardId: card.id, usage });
        continue;
      }
      const picked = choiceQuestions(catalog, card.id).flatMap((choice) => {
        const optionIds = choices[card.id]?.[choice.id] ?? [];
        return optionIds.length ? [{ choiceId: choice.id, optionIds }] : [];
      });
      cards.push({ cardId: card.id, usage, choices: picked });
    }
    const next: Wallet = {
      ...wallet,
      defaultCardId: selected.length ? defaultId || selected[0] : null,
      cards,
    };
    if (catalog.schemaVersion === 3) {
      next.gates = questions.flatMap(({ gate }) =>
        gates[gate.id] ? [{ gateId: gate.id, optionId: gates[gate.id] }] : [],
      );
      const overrides: NonNullable<Wallet['valueOverrides']> = [];
      for (const { program } of programs) {
        const text = values[program.id]?.trim();
        if (!text) continue;
        const value = parseCentsEach(text);
        if (value === null) {
          setError(
            `Enter a value for ${program.name} from 0.01 to 100 cents, with up to two decimals, or leave it blank.`,
          );
          return;
        }
        overrides.push({ programId: program.id, valueHundredthsOfCent: value });
      }
      next.valueOverrides = overrides;
    }
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your cards could not be saved. Try again.');
    }
  }

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
        <Field
          id="add-card"
          label="Add a card"
          helperText={
            selected.length >= MAX_CARDS
              ? `You can save up to ${MAX_CARDS} cards. Remove one to add another.`
              : `Type part of the card or bank name, then pick it from the list (${catalog.cards.length} cards).`
          }
        >
          {(control) => (
            <Combobox
              {...control}
              disabled={busy || selected.length >= MAX_CARDS}
              placeholder="For example: cash, Chase"
              listLabel="Matching cards"
              emptyText="No cards match. Try fewer letters or the bank’s name."
              countText={(n) => `${n} ${n === 1 ? 'card matches' : 'cards match'}`}
              options={options}
              onSelect={add}
            />
          )}
        </Field>
        <p role="status" className="ac-visually-hidden">
          {announcement}
        </p>
        <section className="space-y-2" aria-labelledby="owned-cards-heading">
          <h3 id="owned-cards-heading" className="subsection-title">
            Cards you own ({selected.length})
          </h3>
          {selected.length === 0 ? (
            <p className="supporting">No cards yet. Add each card you might pay with.</p>
          ) : (
            <ul className="wallet-list">
              {selected.map((id) => {
                const card = cardOf(id);
                return (
                  <li key={id} className="wallet-list__item">
                    <div>
                      <p>{card ? card.name : `Unavailable card: ${id}`}</p>
                      <p className="supporting">
                        {card ? issuerOf(card) : 'No longer in the card terms. Remove it to save.'}
                      </p>
                    </div>
                    <Button
                      size="small"
                      color="tertiary"
                      disabled={busy}
                      aria-label={`Remove ${card ? card.name : `unavailable card ${id}`}`}
                      onClick={() => remove(id)}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
                    {cardOf(id)?.shortName ?? `Unavailable: ${id}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {cardChoices.length > 0 && (
          <section className="space-y-3" aria-labelledby="card-options-heading">
            <div>
              <h3 id="card-options-heading" className="subsection-title">
                Card options
              </h3>
              <p className="supporting">
                Categories you picked with your bank. “Not sure” shows a range instead of one amount.
              </p>
            </div>
            {cardChoices.map(({ card, choice }) => {
              const picked = choices[card.id]?.[choice.id] ?? [];
              const suggested = prefilled.has(key(card.id, choice.id))
                ? ' Filled in with the card’s default; change it if you picked another.'
                : '';
              const name = `choice-${card.id}-${choice.id}`;
              return choice.picks === 1 ? (
                <Fieldset
                  key={name}
                  legend={`${card.shortName}: ${choice.label}`}
                  helperText={`Which one did you pick?${suggested}`}
                  disabled={busy}
                >
                  {choice.options.map((option) => (
                    <Radio
                      key={option.id}
                      name={name}
                      label={option.label}
                      checked={picked[0] === option.id}
                      onChange={() => choose(card.id, choice.id, [option.id])}
                    />
                  ))}
                  <Radio
                    name={name}
                    label="Not sure"
                    checked={picked.length === 0}
                    onChange={() => choose(card.id, choice.id, [])}
                  />
                </Fieldset>
              ) : (
                <Fieldset
                  key={name}
                  legend={`${card.shortName}: ${choice.label}`}
                  helperText={`Pick up to ${choice.picks}. Leave them all unchecked if you’re not sure.${suggested}`}
                  disabled={busy}
                >
                  {choice.options.map((option) => {
                    const checked = picked.includes(option.id);
                    return (
                      <Checkbox
                        key={option.id}
                        label={option.label}
                        checked={checked}
                        disabled={!checked && picked.length >= choice.picks}
                        onChange={() =>
                          choose(
                            card.id,
                            choice.id,
                            checked ? picked.filter((id) => id !== option.id) : [...picked, option.id],
                          )
                        }
                      />
                    );
                  })}
                </Fieldset>
              );
            })}
          </section>
        )}
        {questions.length > 0 && (
          <section className="space-y-3" aria-labelledby="about-you-heading">
            <div>
              <h3 id="about-you-heading" className="subsection-title">
                About you
              </h3>
              <p className="supporting">
                Some rates depend on a membership, a status or how long you have had the card. Each question
                is asked once for all your cards. “Not sure” leaves it open and shows a range.
              </p>
            </div>
            {questions.map(({ gate, cards }) => {
              const name = `gate-${gate.id}`;
              return (
                <Fieldset
                  key={gate.id}
                  legend={gate.question}
                  helperText={`Affects ${cards.map((c) => c.shortName).join(', ')}.`}
                  disabled={busy}
                >
                  {gate.options.map((option) => (
                    <Radio
                      key={option.id}
                      name={name}
                      label={option.label}
                      checked={gates[gate.id] === option.id}
                      onChange={() => setGates((current) => ({ ...current, [gate.id]: option.id }))}
                    />
                  ))}
                  <Radio
                    name={name}
                    label="Not sure"
                    checked={!gates[gate.id]}
                    onChange={() =>
                      setGates((current) => {
                        const next = { ...current };
                        delete next[gate.id];
                        return next;
                      })
                    }
                  />
                </Fieldset>
              );
            })}
          </section>
        )}
        {limits.length > 0 && (
          <section className="space-y-4" aria-labelledby="bonus-limits-heading">
            <h3 id="bonus-limits-heading" className="subsection-title">
              Bonus limits
            </h3>
            {limits.map(({ card, rule }) => (
              <div key={key(card.id, rule.ruleId)} className="space-y-3">
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
                        value={input(card.id, rule.ruleId).spend}
                        disabled={busy}
                        placeholder="Unknown"
                        onChange={(e) => update(card.id, rule.ruleId, { spend: e.target.value })}
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
                        value={input(card.id, rule.ruleId).activation}
                        onChange={(e) =>
                          update(card.id, rule.ruleId, {
                            activation: e.target.value as RuleUsage['activation'],
                          })
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
          </section>
        )}
        {programs.length > 0 && (
          <section className="space-y-4" aria-labelledby="point-values-heading">
            <div>
              <h3 id="point-values-heading" className="subsection-title">
                Point values
              </h3>
              <p className="supporting">
                What one point or mile is worth to you, in cents. Points are compared with cash back at this
                value. Published values are estimates; a value you enter replaces them.
              </p>
            </div>
            {programs.map(({ program, cards }) => {
              const valuation = program.valuation;
              const stated = cards.filter((card) => card.statedValueHundredthsOfCent !== null);
              const id = `value-${program.id}`;
              const typed = values[program.id] ?? '';
              const fallback =
                valuation.basis === 'published-estimate' || valuation.basis === 'issuer-stated'
                  ? formatCentsEach(valuation.valueHundredthsOfCent)
                  : stated.length === cards.length
                    ? formatCentsEach(stated[0].statedValueHundredthsOfCent!)
                    : 'Not set';
              return (
                <div key={program.id} className="space-y-2">
                  <p>
                    <span className="font-semibold">{program.name}</span>
                    <span className="supporting"> · {cards.map((c) => c.shortName).join(', ')}</span>
                  </p>
                  {valuation.basis === 'published-estimate' && (
                    <p className="supporting">
                      <Badge size="small">Estimate</Badge> {centsEach(valuation.valueHundredthsOfCent)} each,
                      estimated by {valuation.publisher} (read {dateCopy(valuation.retrievedOn)}).
                    </p>
                  )}
                  {valuation.basis === 'issuer-stated' && (
                    <p className="supporting">
                      <Badge size="small">Issuer-stated</Badge> {centsEach(valuation.valueHundredthsOfCent)}{' '}
                      each, stated by the issuer.
                    </p>
                  )}
                  {stated.map((card) => (
                    <p key={card.id} className="supporting">
                      <Badge size="small">Issuer-stated</Badge> {centsEach(card.statedValueHundredthsOfCent!)}{' '}
                      each with {card.shortName}, stated by the issuer.
                    </p>
                  ))}
                  {valuation.basis === 'none' && stated.length < cards.length && !typed.trim() && (
                    <p className="supporting">
                      <Badge size="small" color="warning">
                        No published value
                      </Badge>{' '}
                      Set one to compare these {program.unitName} with cash back. Until then they are shown in{' '}
                      {program.unitName} and listed last.
                    </p>
                  )}
                  <div className="value-field">
                    <Field
                      id={id}
                      label={`Your value for ${program.name}, in cents each`}
                      helperText={`Optional, from 0.01 to 100. ${fallback === 'Not set' ? 'Leave blank if you don’t know.' : 'Leave blank to use the value above.'}`}
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          inputMode="decimal"
                          maxLength={6}
                          value={typed}
                          disabled={busy}
                          placeholder={fallback}
                          onChange={(e) =>
                            setValues((current) => ({ ...current, [program.id]: e.target.value }))
                          }
                        />
                      )}
                    </Field>
                    <Button
                      size="small"
                      color="tertiary"
                      disabled={busy || !typed}
                      aria-label={`Reset to default: ${program.name}`}
                      onClick={() => {
                        setValues((current) => ({ ...current, [program.id]: '' }));
                        document.getElementById(id)?.focus();
                      }}
                    >
                      Reset to default
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>
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
