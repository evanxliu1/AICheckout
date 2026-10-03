import { useEffect, useMemo, useState } from 'react';
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
  mergeSlices,
  parseCentsEach,
  pointPrograms,
} from './wallet-options';
import type { CardIndexEntry } from '../state/catalog-slice';

type Input = { spend: string; activation: RuleUsage['activation'] };
const EMPTY_INPUT: Input = { spend: '', activation: 'unknown' };
const key = (cardId: string, id: string) => `${cardId}/${id}`;
const issuerOf = (card: Catalog['cards'][number]) => ('issuer' in card ? card.issuer : 'Cards');
/** When the spend toward a bonus limit counts from, by the limit's period: the engine compares the
 * spend entered with the limit of the current period. v1 limits are per calendar year. */
function spendPeriod(card: Catalog['cards'][number], ruleId: string, year: number): string {
  const rule = (card.rules as { id: string; cap?: { kind: string; period?: string } }[]).find(
    (r) => r.id === ruleId,
  );
  const period = rule?.cap?.kind === 'spend' ? rule.cap.period : 'calendar-year';
  switch (period) {
    case 'quarter':
      return 'this quarter';
    case 'month':
      return 'this month';
    case 'billing-cycle':
      return 'this billing cycle';
    case 'cardmember-year':
      return 'this card-member year';
    case 'year-unspecified':
      return 'this year';
    default:
      return `in ${year}`;
  }
}
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
  catalog: initial,
  index,
  loadCards,
  busy,
  onSave,
  onCancel,
}: {
  wallet: Wallet;
  /** The catalog in effect, or a slice of it holding at least the owned cards. */
  catalog: Catalog;
  /** Every card to search; defaults to the cards of `catalog`. */
  index?: CardIndexEntry[];
  /** Fetches the full terms of these cards (a catalog slice) when one is added. */
  loadCards?: (cardIds: string[]) => Promise<Catalog>;
  busy: boolean;
  onSave: (wallet: Wallet) => Promise<void>;
  onCancel?: () => void;
}) {
  const [catalog, setCatalog] = useState(initial);
  const [loading, setLoading] = useState(0);
  const cards = useMemo(
    () =>
      index ??
      initial.cards.map((card) => ({
        id: card.id,
        name: card.name,
        shortName: card.shortName,
        issuer: issuerOf(card),
      })),
    [index, initial],
  );
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
  /** Where focus goes after the control that had it disappears or is disabled. */
  const [focusTo, setFocusTo] = useState<'search' | 'owned' | null>(null);
  useEffect(() => {
    if (!focusTo) return;
    const search = document.getElementById('add-card') as HTMLInputElement | null;
    if (focusTo === 'search' && search && !search.disabled) search.focus();
    else document.getElementById('owned-cards-heading')?.focus();
    setFocusTo(null);
  }, [focusTo]);

  const cardOf = (id: string) => catalog.cards.find((card) => card.id === id);
  const entryOf = (id: string) => cards.find((card) => card.id === id);
  // Selected cards in the order the catalog lists them, once their terms are here.
  const owned = catalog.cards.filter((card) => selected.includes(card.id));
  const unavailable = selected.filter((id) => !entryOf(id));
  const pending = selected.filter((id) => entryOf(id) && !cardOf(id));
  const options = useMemo(
    () =>
      cards
        .filter((card) => !selected.includes(card.id))
        .map((card) => ({ id: card.id, label: card.name, group: card.issuer, keywords: card.shortName }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
    [cards, selected],
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

  /** Loads the full terms of `ids` into the editor's catalog; null (with an error shown) on failure. */
  async function loadTerms(ids: string[]): Promise<Catalog | null> {
    if (!loadCards) return null;
    setError('');
    setLoading((n) => n + 1);
    try {
      const slice = await loadCards(ids);
      setCatalog((current) => mergeSlices(current, slice));
      return slice;
    } catch (err) {
      setError(`The card terms could not be loaded. ${err instanceof Error ? err.message : 'Try again.'}`);
      return null;
    } finally {
      setLoading((n) => n - 1);
    }
  }

  async function add(id: string) {
    if (selected.includes(id) || selected.length >= MAX_CARDS) return;
    const next = [...selected, id];
    const name = entryOf(id)?.name ?? id;
    setSelected(next);
    if (!next.includes(defaultId)) setDefaultId(next[0] ?? '');
    setAnnouncement(
      next.length >= MAX_CARDS
        ? `Added ${name}. ${next.length} of ${MAX_CARDS} cards, the most you can save.`
        : `Added ${name}. ${next.length} of ${MAX_CARDS} cards.`,
    );
    // The search field is disabled at the limit; keep focus on the list of cards.
    if (next.length >= MAX_CARDS) setFocusTo('owned');
    let terms = catalog;
    if (!cardOf(id) && loadCards) {
      const slice = await loadTerms(next);
      if (!slice) {
        // Without its terms the card cannot be shown or saved; take it back out.
        setSelected((current) => current.filter((c) => c !== id));
        setAnnouncement(`Could not add ${name}.`);
        setFocusTo('search');
        return;
      }
      terms = slice;
    }
    // Suggest the issuer's default categories for a card added now; the shopper can change them.
    const defaults = choiceQuestions(terms, id).filter((choice) => choice.defaultOptionIds.length > 0);
    if (!defaults.length) return;
    setChoices((current) => {
      const fresh = defaults.filter((c) => current[id]?.[c.id] === undefined);
      if (!fresh.length) return current;
      setPrefilled((marked) => new Set([...marked, ...fresh.map((c) => key(id, c.id))]));
      return {
        ...current,
        [id]: {
          ...current[id],
          ...Object.fromEntries(fresh.map((c) => [c.id, c.defaultOptionIds.slice(0, c.picks)])),
        },
      };
    });
  }
  function remove(id: string) {
    const next = selected.filter((c) => c !== id);
    setSelected(next);
    if (!next.includes(defaultId)) setDefaultId(next[0] ?? '');
    setAnnouncement(`Removed ${entryOf(id)?.name ?? 'the unavailable card'}.`);
    // The button is gone; return focus to the search field once it is enabled again.
    setFocusTo('search');
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
    if (pending.length) {
      setError('The terms of a card you added are still loading. Try again in a moment.');
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
      // Saved choices this form does not ask (an expired or older catalog in effect lacks them, or
      // no catalog merchant uses them) are kept, never dropped by saving.
      const before = wallet.cards.find((c) => c.cardId === card.id)?.choices;
      const asked = choiceQuestions(catalog, card.id);
      const kept = Object.entries(choices[card.id] ?? {}).flatMap(([choiceId, optionIds]) =>
        optionIds.length && !asked.some((q) => q.id === choiceId) ? [{ choiceId, optionIds }] : [],
      );
      if (catalog.schemaVersion !== 3) {
        cards.push(
          before === undefined ? { cardId: card.id, usage } : { cardId: card.id, usage, choices: kept },
        );
        continue;
      }
      const picked = asked.flatMap((choice) => {
        const optionIds = choices[card.id]?.[choice.id] ?? [];
        return optionIds.length ? [{ choiceId: choice.id, optionIds }] : [];
      });
      cards.push({ cardId: card.id, usage, choices: [...picked, ...kept].slice(0, 5) });
    }
    const next: Wallet = {
      ...wallet,
      defaultCardId: selected.length ? defaultId || selected[0] : null,
      cards,
    };
    if (catalog.schemaVersion === 3) {
      // As with choices: answers and values this form does not show are kept.
      next.gates = [
        ...questions.flatMap(({ gate }) =>
          gates[gate.id] ? [{ gateId: gate.id, optionId: gates[gate.id] }] : [],
        ),
        ...Object.entries(gates).flatMap(([gateId, optionId]) =>
          questions.some(({ gate }) => gate.id === gateId) ? [] : [{ gateId, optionId }],
        ),
      ].slice(0, 100);
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
      next.valueOverrides = [
        ...overrides,
        ...Object.entries(values).flatMap(([programId, text]) => {
          const value = parseCentsEach(text);
          return value === null || programs.some(({ program }) => program.id === programId)
            ? []
            : [{ programId, valueHundredthsOfCent: value }];
        }),
      ].slice(0, 100);
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
              : `Type part of the card or bank name, then pick it from the list (${cards.length} cards).`
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
              onSelect={(id) => void add(id)}
            />
          )}
        </Field>
        <p role="status" className="ac-visually-hidden">
          {announcement}
        </p>
        <section className="space-y-2" aria-labelledby="owned-cards-heading">
          <h3 id="owned-cards-heading" className="subsection-title" tabIndex={-1}>
            Cards you own ({selected.length})
          </h3>
          {selected.length === 0 ? (
            <p className="supporting">No cards yet. Add each card you might pay with.</p>
          ) : (
            <ul className="wallet-list">
              {selected.map((id) => {
                const card = entryOf(id);
                return (
                  <li key={id} className="wallet-list__item">
                    <div>
                      <p>{card ? card.name : `Unavailable card: ${id}`}</p>
                      <p className="supporting">
                        {!card
                          ? 'No longer in the card terms. Remove it to save.'
                          : pending.includes(id)
                            ? `${card.issuer} · loading its terms…`
                            : card.issuer}
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
                    {entryOf(id)?.shortName ?? `Unavailable: ${id}`}
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
                  helperText={`Check every category you picked (up to ${choice.picks}). Leave them all unchecked if you’re not sure.${suggested}`}
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
                    label={`${card.shortName} ${rule.label} spend ${spendPeriod(card, rule.ruleId, year)}`}
                    helperText={`Optional USD, across your card account, counted toward the limit ${spendPeriod(card, rule.ruleId, year).replace(/^in /, 'for ')}. Leave blank if unsure; 0 means none used. Update before each purchase. Becomes unknown tomorrow.`}
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
              // The engine uses a card's stated value before the program's value.
              const statedValues = new Set(stated.map((card) => card.statedValueHundredthsOfCent!));
              const programValue =
                valuation.basis === 'published-estimate' || valuation.basis === 'issuer-stated'
                  ? valuation.valueHundredthsOfCent
                  : null;
              const fallback =
                stated.length === cards.length && statedValues.size === 1
                  ? formatCentsEach(stated[0].statedValueHundredthsOfCent!)
                  : stated.length === 0
                    ? programValue === null
                      ? 'Not set'
                      : formatCentsEach(programValue)
                    : 'Per card';
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
                      helperText={`Optional, from 0.01 to 100. ${
                        fallback === 'Not set'
                          ? 'Leave blank if you don’t know.'
                          : fallback === 'Per card'
                            ? 'Leave blank to use each card’s value shown above.'
                            : 'Leave blank to use the value above.'
                      }${cards.length > 1 ? ' Your value replaces these for all cards in this program.' : ''}`}
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
        {pending.length > 0 && loading === 0 && loadCards && (
          <AlertInline
            color="warning"
            actions={
              <Button size="small" color="secondary" disabled={busy} onClick={() => void loadTerms(selected)}>
                Load card terms
              </Button>
            }
          >
            The terms of {pending.map((id) => entryOf(id)?.shortName ?? id).join(', ')} are not loaded yet.
          </AlertInline>
        )}
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        <div className="flex gap-2">
          <Button type="submit" isLoading={busy || loading > 0}>
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
