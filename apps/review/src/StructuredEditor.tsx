import { useEffect, useMemo, useState } from 'react';
import {
  CAP_PERIODS,
  PAYMENT_PATHS_V3,
  catalogSchema,
  type Catalog,
  type CatalogV2,
  type CatalogV3,
  type RewardRuleV2,
  type RewardRuleV3,
  type RuleCap,
} from '@ai-checkout/rewards-core';
import {
  AlertInline,
  Button,
  Checkbox,
  Disclosure,
  Field,
  Fieldset,
  Select,
  TextInput,
} from '@ai-checkout/ui';
import { catalogChanges } from './comparison';
import ChangesTable from './ChangesTable';
import LazyDisclosure from './LazyDisclosure';

type Editable = CatalogV2 | CatalogV3;
type Path = (string | number)[];
const key = (path: Path) => path.join('.');
const fieldId = (path: Path) => `edit-${key(path).replaceAll('.', '-')}`;
/** Digits only: "0x10", "1e3", "-1", "1.5" and whitespace are rejected rather than coerced. */
const WHOLE_NUMBER = /^\d+$/;
const NOT_A_NUMBER = 'Enter a whole number using digits only.';
const toNumber = (value: string) => (WHOLE_NUMBER.test(value) ? Number(value) : Number.NaN);
const show = (value: number) => (Number.isFinite(value) ? String(value) : '');
/** "a, b ,c" → ["a", "b", "c"]; IDs are checked by the catalog schema. */
const toList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const CARD_FIELDS = new Set(['name', 'shortName', 'issuer', 'programId', 'statedValueHundredthsOfCent']);
const RULE_FIELDS = new Set([
  'issuerWording',
  'rateBps',
  'paidOnPaymentBps',
  'cap',
  'activation',
  'limitedTime',
  'usMerchantsOnly',
  'brandIds',
  'excludedBrandIds',
  'sharedCapId',
  'choice',
  'requiredPaymentPaths',
]);
const SECTION_FIELDS: Record<string, Set<string>> = {
  programs: new Set(['name', 'unitName', 'valuation']),
  brands: new Set(['name']),
  gates: new Set(['question', 'options']),
};
/** Whether a schema issue at this path can be fixed with a field of the structured editor. */
function editableHere(path: Path) {
  if (path.length === 1) return ['version', 'verifiedAt', 'expiresAt'].includes(String(path[0]));
  const section = SECTION_FIELDS[String(path[0])];
  if (section) return path.length >= 3 && section.has(String(path[2]));
  if (path[0] !== 'cards') return false;
  if (path.length === 2) return true; // card-level rules (rates, caps) are fixed through its fields
  if (path.length === 3) return CARD_FIELDS.has(String(path[2]));
  if (path[2] !== 'rules') return false;
  return path.length === 4 || RULE_FIELDS.has(String(path[4]));
}
const isV3Rule = (rule: RewardRuleV2 | RewardRuleV3): rule is RewardRuleV3 => 'brandIds' in rule;

/** The edited catalog against the published one; computed only while the preview is open. */
function Preview({ published, working }: { published: Catalog | null; working: Catalog }) {
  const rows = useMemo(() => catalogChanges(published, working), [published, working]);
  return rows.length ? (
    <ChangesTable
      rows={rows}
      caption="Edited draft compared with the published catalog"
      idPrefix="preview-changes"
    />
  ) : (
    <p>No differences from the published catalog.</p>
  );
}

/**
 * Structured editor for catalog v2 and v3 drafts: per-card and per-rule fields (and, for v3,
 * programs, brands, questions, card programs and rule scope), validated live with the same Zod
 * schema the API and database mirror, with a preview of the result against the published catalog.
 * Cards are collapsed and searchable, so a 180-card catalog renders one card's fields at a time.
 * Saving creates a new draft revision, like the JSON editor.
 */
export default function StructuredEditor({
  catalog,
  published,
  busy,
  blockedReason,
  onDirty,
  onSave,
}: {
  catalog: Editable;
  published: Catalog | null;
  busy: boolean;
  /** Why saving is not possible right now (another editor or capture has unsaved input). */
  blockedReason?: string;
  onDirty: (value: boolean) => void;
  onSave: (catalog: Catalog) => Promise<void>;
}) {
  const saved = useMemo(() => JSON.stringify(catalog), [catalog]);
  const [working, setWorking] = useState<Editable>(() => structuredClone(catalog));
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  /** Raw text of numeric fields that are not a whole number, keyed by path. */
  const [rawNumbers, setRawNumbers] = useState<Record<string, string>>({});
  /** Raw text of comma-separated ID lists while they are edited, keyed by path. */
  const [rawLists, setRawLists] = useState<Record<string, string>>({});
  const [focusTarget, setFocusTarget] = useState<{ path: Path; card: string } | null>(null);
  const dirty = useMemo(() => JSON.stringify(working) !== saved, [working, saved]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const parsed = useMemo(() => catalogSchema.safeParse(working), [working]);
  const errors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const at = key(issue.path as Path);
        map.set(at, [...(map.get(at) ?? []), issue.message]);
      }
    return map;
  }, [parsed]);
  /** Errors at this path or below it (e.g. a cap object's fields). */
  const errorAt = (path: Path) => {
    const prefix = key(path);
    if (prefix in rawNumbers) return [NOT_A_NUMBER];
    const found = [...errors]
      .filter(([at]) => at === prefix || at.startsWith(`${prefix}.`))
      .flatMap(([, m]) => m);
    return found.length ? found : undefined;
  };
  const field = (path: Path) => ({ id: fieldId(path), error: errorAt(path) });
  /** Props for a whole-number field: shows what was typed, stores NaN until it is digits only.
   * With `cleared`, a blank field stores null instead. */
  const numeric = (
    path: Path,
    value: number | null,
    assign: (next: number) => void,
    cleared?: () => void,
  ) => ({
    inputMode: 'numeric' as const,
    value: rawNumbers[key(path)] ?? (value === null ? '' : show(value)),
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      setRawNumbers((current) => {
        const next = { ...current };
        if (text === '' || WHOLE_NUMBER.test(text)) delete next[key(path)];
        else next[key(path)] = text;
        return next;
      });
      if (text === '' && cleared) cleared();
      else assign(toNumber(text));
    },
  });
  /** Props for a comma-separated ID list: keeps what was typed, stores the parsed list. */
  const idList = (path: Path, value: string[], assign: (next: string[]) => void) => ({
    value: rawLists[key(path)] ?? value.join(', '),
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      setRawLists((current) => ({ ...current, [key(path)]: text }));
      assign(toList(text));
    },
  });
  // Opening a card from the problem summary moves focus to the field (or the card) with the issue.
  useEffect(() => {
    if (!focusTarget) return;
    for (let length = focusTarget.path.length; length >= 2; length--) {
      const element = document.getElementById(fieldId(focusTarget.path.slice(0, length)));
      if (element) {
        element.focus();
        setFocusTarget(null);
        return;
      }
    }
    document.querySelector<HTMLElement>(`[data-card="${focusTarget.card}"] > summary`)?.focus();
    setFocusTarget(null);
  }, [focusTarget, openCards, query]);
  const update = (change: (draft: Editable) => void) =>
    setWorking((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  const updateV3 = (change: (draft: CatalogV3) => void) =>
    update((draft) => {
      if (draft.schemaVersion === 3) change(draft);
    });
  const editedFields = useMemo(
    () => (dirty ? catalogChanges(catalog, working).length : 0),
    [catalog, working, dirty],
  );

  /** A new spend cap starts blank (invalid) so the reviewer must enter the issuer's real values. */
  function capFor(kind: RuleCap['kind'], current: RuleCap): RuleCap {
    if (kind === 'spend')
      return current.kind === 'spend'
        ? current
        : {
            kind: 'spend',
            amountCents: Number.NaN,
            period: '' as unknown as (typeof CAP_PERIODS)[number],
            rateAfterCapBps: Number.NaN,
          };
    return { kind };
  }
  function openCard(cardId: string, path: Path) {
    setQuery('');
    setOpenCards((current) => new Set(current).add(cardId));
    setFocusTarget({ path, card: cardId });
  }
  /** "Citi Double Cash · rule citi-base · rateBps" for an issue path. */
  function describe(path: Path) {
    if (path[0] === 'programs' && working.schemaVersion === 3 && typeof path[1] === 'number') {
      const program = working.programs[path[1]];
      if (program) return [`Program ${program.name}`, path.slice(2).join('.')].filter(Boolean).join(' · ');
    }
    if (path[0] !== 'cards' || typeof path[1] !== 'number') return path.join('.') || 'Catalog';
    const card = working.cards[path[1]];
    if (!card) return path.join('.');
    const rule = path[2] === 'rules' && typeof path[3] === 'number' ? card.rules[path[3]] : undefined;
    const rest = path.slice(rule ? 4 : 2).join('.');
    return [card.name, rule ? `rule ${rule.id}` : '', rest].filter(Boolean).join(' · ');
  }

  const issues = parsed.success ? [] : parsed.error.issues;
  const invalidNumbers = Object.keys(rawNumbers).length;
  const canSave = !busy && !blockedReason && dirty && parsed.success && !invalidNumbers;
  const needle = query.trim().toLowerCase();
  const cards = working.cards
    .map((card, index) => ({ card, index }))
    .filter(
      ({ card }) =>
        !needle ||
        [card.name, card.shortName, card.id, card.issuer].some((value) =>
          value.toLowerCase().includes(needle),
        ),
    );
  const v3 = working.schemaVersion === 3 ? working : null;
  // No <form>: Enter in a field never saves a revision; only the Save button does.
  return (
    <div className="stack">
      <p>
        Edit cards and rules field by field. Rates are basis points (100 = 1%); money is in cents. Every
        change is checked against the catalog schema before it can be saved as a new revision.
        {v3
          ? ' Point values are in hundredths of a cent (125 = 1.25¢). Choices, the answers a rule requires and new IDs are edited in JSON.'
          : ''}
      </p>
      <div className="editor-grid">
        <Field {...field(['version'])} label="Catalog version">
          {(control) => (
            <TextInput
              {...control}
              value={working.version}
              disabled={busy}
              onChange={(e) => update((d) => void (d.version = e.target.value))}
            />
          )}
        </Field>
        <Field {...field(['verifiedAt'])} label="Verified at (UTC)">
          {(control) => (
            <TextInput
              {...control}
              value={working.verifiedAt}
              disabled={busy}
              onChange={(e) => update((d) => void (d.verifiedAt = e.target.value))}
            />
          )}
        </Field>
        <Field {...field(['expiresAt'])} label="Expires at (UTC)">
          {(control) => (
            <TextInput
              {...control}
              value={working.expiresAt}
              disabled={busy}
              onChange={(e) => update((d) => void (d.expiresAt = e.target.value))}
            />
          )}
        </Field>
      </div>
      {v3 && (
        <>
          <LazyDisclosure title={`Reward programs and point values (${v3.programs.length})`}>
            {() => (
              <div className="stack">
                <p className="small muted">
                  Published estimates are opinions: keep the publisher, page and date they were read.
                </p>
                {v3.programs.map((program, p) => {
                  const at: Path = ['programs', p];
                  const valuation = program.valuation;
                  return (
                    <Fieldset
                      key={program.id}
                      className="editor-rule"
                      legend={`${program.id} · ${program.currency === 'cash-back' ? 'cash back' : 'points'} · ${valuation.basis}`}
                      error={errors.get(key(at))}
                    >
                      <div className="editor-grid">
                        <Field {...field([...at, 'name'])} label="Program name">
                          {(control) => (
                            <TextInput
                              {...control}
                              value={program.name}
                              disabled={busy}
                              onChange={(e) => updateV3((d) => void (d.programs[p].name = e.target.value))}
                            />
                          )}
                        </Field>
                        <Field {...field([...at, 'unitName'])} label="Unit name">
                          {(control) => (
                            <TextInput
                              {...control}
                              value={program.unitName}
                              disabled={busy}
                              onChange={(e) =>
                                updateV3((d) => void (d.programs[p].unitName = e.target.value))
                              }
                            />
                          )}
                        </Field>
                        {(valuation.basis === 'published-estimate' ||
                          valuation.basis === 'issuer-stated') && (
                          <Field
                            {...field([...at, 'valuation', 'valueHundredthsOfCent'])}
                            label="Value per unit (hundredths of a cent)"
                          >
                            {(control) => (
                              <TextInput
                                {...control}
                                {...numeric(
                                  [...at, 'valuation', 'valueHundredthsOfCent'],
                                  valuation.valueHundredthsOfCent,
                                  (n) =>
                                    updateV3((d) => {
                                      const value = d.programs[p].valuation;
                                      if (
                                        value.basis === 'published-estimate' ||
                                        value.basis === 'issuer-stated'
                                      )
                                        value.valueHundredthsOfCent = n;
                                    }),
                                )}
                                disabled={busy}
                              />
                            )}
                          </Field>
                        )}
                        {valuation.basis === 'published-estimate' && (
                          <>
                            <Field {...field([...at, 'valuation', 'publisher'])} label="Publisher">
                              {(control) => (
                                <TextInput
                                  {...control}
                                  value={valuation.publisher}
                                  disabled={busy}
                                  onChange={(e) =>
                                    updateV3((d) => {
                                      const value = d.programs[p].valuation;
                                      if (value.basis === 'published-estimate')
                                        value.publisher = e.target.value;
                                    })
                                  }
                                />
                              )}
                            </Field>
                            <Field {...field([...at, 'valuation', 'url'])} label="Estimate page (HTTPS)">
                              {(control) => (
                                <TextInput
                                  {...control}
                                  value={valuation.url}
                                  disabled={busy}
                                  onChange={(e) =>
                                    updateV3((d) => {
                                      const value = d.programs[p].valuation;
                                      if (value.basis === 'published-estimate') value.url = e.target.value;
                                    })
                                  }
                                />
                              )}
                            </Field>
                            <Field
                              {...field([...at, 'valuation', 'retrievedOn'])}
                              label="Read on (YYYY-MM-DD)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  value={valuation.retrievedOn}
                                  disabled={busy}
                                  onChange={(e) =>
                                    updateV3((d) => {
                                      const value = d.programs[p].valuation;
                                      if (value.basis === 'published-estimate')
                                        value.retrievedOn = e.target.value;
                                    })
                                  }
                                />
                              )}
                            </Field>
                          </>
                        )}
                      </div>
                      {valuation.basis === 'issuer-stated' && (
                        <p className="small muted">Stated in {valuation.sourceIds.join(', ')}.</p>
                      )}
                      {valuation.basis === 'none' && (
                        <p className="small muted">No published or stated value: cards show units only.</p>
                      )}
                      {program.redemptionBrandIds.length > 0 && (
                        <p className="small muted">
                          Redeemable only at {program.redemptionBrandIds.join(', ')}.
                        </p>
                      )}
                    </Fieldset>
                  );
                })}
              </div>
            )}
          </LazyDisclosure>
          <LazyDisclosure title={`Brands (${v3.brands.length})`}>
            {() => (
              <div className="editor-grid">
                {v3.brands.map((brand, b) => (
                  <Field key={brand.id} {...field(['brands', b, 'name'])} label={`Brand ${brand.id}`}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={brand.name}
                        disabled={busy}
                        onChange={(e) => updateV3((d) => void (d.brands[b].name = e.target.value))}
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </LazyDisclosure>
          <LazyDisclosure title={`Membership and tier questions (${v3.gates.length})`}>
            {() => (
              <div className="stack">
                {v3.gates.map((gate, g) => (
                  <Fieldset key={gate.id} className="editor-rule" legend={`Question ${gate.id}`}>
                    <Field {...field(['gates', g, 'question'])} label="Question">
                      {(control) => (
                        <TextInput
                          {...control}
                          value={gate.question}
                          disabled={busy}
                          onChange={(e) => updateV3((d) => void (d.gates[g].question = e.target.value))}
                        />
                      )}
                    </Field>
                    <div className="editor-grid">
                      {gate.options.map((option, o) => (
                        <Field
                          key={option.id}
                          {...field(['gates', g, 'options', o, 'label'])}
                          label={`Answer ${option.id}`}
                        >
                          {(control) => (
                            <TextInput
                              {...control}
                              value={option.label}
                              disabled={busy}
                              onChange={(e) =>
                                updateV3((d) => void (d.gates[g].options[o].label = e.target.value))
                              }
                            />
                          )}
                        </Field>
                      ))}
                    </div>
                  </Fieldset>
                ))}
              </div>
            )}
          </LazyDisclosure>
        </>
      )}
      <Field
        id="editor-card-search"
        label="Find a card"
        helperText={`${working.cards.length} cards. Search by name, ID or issuer; open a card to edit it.`}
      >
        {(control) => (
          <TextInput {...control} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </Field>
      <p className="small muted" role="status">
        {needle ? `${cards.length} of ${working.cards.length} cards match.` : ''}
      </p>
      <div className="editor-cards">
        {cards.map(({ card, index: c }) => (
          <Disclosure
            key={card.id}
            title={card.name}
            data-card={card.id}
            className="editor-card"
            open={openCards.has(card.id)}
            onToggle={(event) => {
              const isOpen = (event.currentTarget as HTMLDetailsElement).open;
              setOpenCards((current) => {
                if (current.has(card.id) === isOpen) return current;
                const next = new Set(current);
                if (isOpen) next.add(card.id);
                else next.delete(card.id);
                return next;
              });
            }}
          >
            {/* Fields render only while the card is open, keeping the page light. */}
            {openCards.has(card.id) && (
              <div className="stack">
                <div className="editor-grid">
                  <Field {...field(['cards', c, 'name'])} label="Card name">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={card.name}
                        disabled={busy}
                        onChange={(e) => update((d) => void (d.cards[c].name = e.target.value))}
                      />
                    )}
                  </Field>
                  <Field {...field(['cards', c, 'shortName'])} label="Short name">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={card.shortName}
                        disabled={busy}
                        onChange={(e) => update((d) => void (d.cards[c].shortName = e.target.value))}
                      />
                    )}
                  </Field>
                  <Field {...field(['cards', c, 'issuer'])} label="Issuer">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={card.issuer}
                        disabled={busy}
                        onChange={(e) => update((d) => void (d.cards[c].issuer = e.target.value))}
                      />
                    )}
                  </Field>
                  {v3 && 'programId' in card && (
                    <>
                      <Field {...field(['cards', c, 'programId'])} label="Reward program">
                        {(control) => (
                          <Select
                            {...control}
                            value={card.programId}
                            disabled={busy}
                            onChange={(e) => updateV3((d) => void (d.cards[c].programId = e.target.value))}
                          >
                            {v3.programs.map((program) => (
                              <option key={program.id} value={program.id}>
                                {program.name} ({program.id})
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field
                        {...field(['cards', c, 'statedValueHundredthsOfCent'])}
                        label="Issuer-stated value per point (hundredths of a cent; blank: none)"
                      >
                        {(control) => (
                          <TextInput
                            {...control}
                            {...numeric(
                              ['cards', c, 'statedValueHundredthsOfCent'],
                              card.statedValueHundredthsOfCent,
                              (n) => updateV3((d) => void (d.cards[c].statedValueHundredthsOfCent = n)),
                              () => updateV3((d) => void (d.cards[c].statedValueHundredthsOfCent = null)),
                            )}
                            disabled={busy}
                          />
                        )}
                      </Field>
                    </>
                  )}
                </div>
                {'acceptance' in card && (
                  <div className="small stack-tight">
                    <p>
                      {card.acceptance.kind === 'open-loop'
                        ? 'Accepted at any merchant (open loop).'
                        : `Accepted only at ${card.acceptance.brandIds.join(', ')} (closed loop).`}
                    </p>
                    {card.choices.map((choice) => (
                      <p key={choice.id}>
                        Choice {choice.id}: “{choice.label}”,{' '}
                        {choice.kind === 'chosen' ? 'cardholder picks' : 'issuer picks by spend'}{' '}
                        {choice.picks} of {choice.options.map((option) => option.label).join(', ')}
                        {choice.defaultOptionIds.length
                          ? `; default ${choice.defaultOptionIds.join(', ')}`
                          : ''}
                        .
                      </p>
                    ))}
                  </div>
                )}
                {card.rules.map((rule, r) => {
                  const at: Path = ['cards', c, 'rules', r];
                  const set = (change: (rule: RewardRuleV2 | RewardRuleV3) => void) =>
                    update((d) => change(d.cards[c].rules[r]));
                  const setV3 = (change: (rule: RewardRuleV3) => void) =>
                    set((x) => {
                      if (isV3Rule(x)) change(x);
                    });
                  const choices = 'choices' in card ? card.choices : [];
                  return (
                    <Fieldset
                      key={rule.id}
                      className="editor-rule"
                      legend={`${rule.id} · ${rule.category}`}
                      error={errors.get(key(at))}
                    >
                      <Field {...field([...at, 'issuerWording'])} label="Issuer wording">
                        {(control) => (
                          <TextInput
                            {...control}
                            value={rule.issuerWording}
                            disabled={busy}
                            onChange={(e) => set((x) => void (x.issuerWording = e.target.value))}
                          />
                        )}
                      </Field>
                      <div className="editor-grid">
                        <Field {...field([...at, 'rateBps'])} label="Rate (bps)">
                          {(control) => (
                            <TextInput
                              {...control}
                              {...numeric([...at, 'rateBps'], rule.rateBps, (n) =>
                                set((x) => void (x.rateBps = n)),
                              )}
                              disabled={busy}
                            />
                          )}
                        </Field>
                        <Field
                          {...field([...at, 'paidOnPaymentBps'])}
                          label="Paid when balance is paid (bps)"
                        >
                          {(control) => (
                            <TextInput
                              {...control}
                              {...numeric([...at, 'paidOnPaymentBps'], rule.paidOnPaymentBps, (n) =>
                                set((x) => void (x.paidOnPaymentBps = n)),
                              )}
                              disabled={busy}
                            />
                          )}
                        </Field>
                        <Field {...field([...at, 'cap'])} label="Spend cap">
                          {(control) => (
                            <Select
                              {...control}
                              value={rule.cap.kind}
                              disabled={busy}
                              onChange={(e) => {
                                setRawNumbers((current) =>
                                  Object.fromEntries(
                                    Object.entries(current).filter(
                                      ([path]) => !path.startsWith(`${key([...at, 'cap'])}.`),
                                    ),
                                  ),
                                );
                                set((x) => void (x.cap = capFor(e.target.value as RuleCap['kind'], x.cap)));
                              }}
                            >
                              <option value="none">No cap</option>
                              <option value="spend">Spend cap</option>
                              <option value="unstated">Not stated by the issuer</option>
                            </Select>
                          )}
                        </Field>
                        {rule.cap.kind === 'spend' && (
                          <>
                            <Field {...field([...at, 'cap', 'amountCents'])} label="Cap amount (cents)">
                              {(control) => (
                                <TextInput
                                  {...control}
                                  {...numeric(
                                    [...at, 'cap', 'amountCents'],
                                    rule.cap.kind === 'spend' ? rule.cap.amountCents : Number.NaN,
                                    (n) =>
                                      set((x) => {
                                        if (x.cap.kind === 'spend') x.cap.amountCents = n;
                                      }),
                                  )}
                                  disabled={busy}
                                />
                              )}
                            </Field>
                            <Field {...field([...at, 'cap', 'period'])} label="Cap period">
                              {(control) => (
                                <Select
                                  {...control}
                                  value={rule.cap.kind === 'spend' ? rule.cap.period : ''}
                                  disabled={busy}
                                  onChange={(e) =>
                                    set((x) => {
                                      if (x.cap.kind === 'spend')
                                        x.cap.period = e.target.value as (typeof CAP_PERIODS)[number];
                                    })
                                  }
                                >
                                  <option value="" disabled>
                                    Choose a period
                                  </option>
                                  {CAP_PERIODS.map((period) => (
                                    <option key={period} value={period}>
                                      {period}
                                    </option>
                                  ))}
                                </Select>
                              )}
                            </Field>
                            <Field {...field([...at, 'cap', 'rateAfterCapBps'])} label="Rate after cap (bps)">
                              {(control) => (
                                <TextInput
                                  {...control}
                                  {...numeric(
                                    [...at, 'cap', 'rateAfterCapBps'],
                                    rule.cap.kind === 'spend' ? rule.cap.rateAfterCapBps : Number.NaN,
                                    (n) =>
                                      set((x) => {
                                        if (x.cap.kind === 'spend') x.cap.rateAfterCapBps = n;
                                      }),
                                  )}
                                  disabled={busy}
                                />
                              )}
                            </Field>
                          </>
                        )}
                        <Field {...field([...at, 'activation'])} label="Activation">
                          {(control) => (
                            <Select
                              {...control}
                              value={rule.activation}
                              disabled={busy}
                              onChange={(e) =>
                                set((x) => void (x.activation = e.target.value as RewardRuleV2['activation']))
                              }
                            >
                              <option value="none">None</option>
                              <option value="enroll-once">Enroll once</option>
                              <option value="recurring">Activate each period</option>
                              <option value="unstated">Not mentioned by the issuer</option>
                            </Select>
                          )}
                        </Field>
                        {!isV3Rule(rule) && (
                          <Field
                            {...field([...at, 'limitedTime'])}
                            label="Promotion ends on (blank: not limited)"
                          >
                            {(control) => (
                              <TextInput
                                {...control}
                                placeholder="YYYY-MM-DD"
                                value={rule.limitedTime?.endsOn ?? ''}
                                disabled={busy}
                                onChange={(e) =>
                                  set((x) => {
                                    if (!isV3Rule(x))
                                      x.limitedTime = e.target.value ? { endsOn: e.target.value } : null;
                                  })
                                }
                              />
                            )}
                          </Field>
                        )}
                        {isV3Rule(rule) && rule.limitedTime && (
                          <>
                            <Field
                              {...field([...at, 'limitedTime', 'startsOn'])}
                              label="Starts on (blank: not stated)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  placeholder="YYYY-MM-DD"
                                  value={rule.limitedTime?.startsOn ?? ''}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setV3((x) => {
                                      if (x.limitedTime) x.limitedTime.startsOn = e.target.value || null;
                                    })
                                  }
                                />
                              )}
                            </Field>
                            <Field
                              {...field([...at, 'limitedTime', 'endsOn'])}
                              label="Ends on (blank: not stated)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  placeholder="YYYY-MM-DD"
                                  value={rule.limitedTime?.endsOn ?? ''}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setV3((x) => {
                                      if (x.limitedTime) x.limitedTime.endsOn = e.target.value || null;
                                    })
                                  }
                                />
                              )}
                            </Field>
                          </>
                        )}
                        {isV3Rule(rule) && (
                          <>
                            <Field
                              {...field([...at, 'brandIds'])}
                              label="Only at brands (IDs, comma-separated; blank: any merchant)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  {...idList([...at, 'brandIds'], rule.brandIds, (ids) =>
                                    setV3((x) => void (x.brandIds = ids)),
                                  )}
                                  disabled={busy}
                                />
                              )}
                            </Field>
                            <Field
                              {...field([...at, 'excludedBrandIds'])}
                              label="Never at brands (IDs, comma-separated)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  {...idList([...at, 'excludedBrandIds'], rule.excludedBrandIds, (ids) =>
                                    setV3((x) => void (x.excludedBrandIds = ids)),
                                  )}
                                  disabled={busy}
                                />
                              )}
                            </Field>
                            <Field
                              {...field([...at, 'sharedCapId'])}
                              label="Shared spend cap ID (blank: not shared)"
                            >
                              {(control) => (
                                <TextInput
                                  {...control}
                                  value={rule.sharedCapId ?? ''}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setV3((x) => void (x.sharedCapId = e.target.value.trim() || null))
                                  }
                                />
                              )}
                            </Field>
                            <Field {...field([...at, 'choice'])} label="Chosen category">
                              {(control) => (
                                <Select
                                  {...control}
                                  value={rule.choice ? `${rule.choice.choiceId}/${rule.choice.optionId}` : ''}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setV3((x) => {
                                      const [choiceId, optionId] = e.target.value.split('/');
                                      x.choice = e.target.value ? { choiceId, optionId } : null;
                                    })
                                  }
                                >
                                  <option value="">Not tied to a choice</option>
                                  {choices.flatMap((choice) =>
                                    choice.options.map((option) => (
                                      <option
                                        key={`${choice.id}/${option.id}`}
                                        value={`${choice.id}/${option.id}`}
                                      >
                                        {choice.label}: {option.label}
                                      </option>
                                    )),
                                  )}
                                </Select>
                              )}
                            </Field>
                          </>
                        )}
                      </div>
                      <Checkbox
                        label="U.S. merchants only"
                        checked={rule.usMerchantsOnly}
                        disabled={busy}
                        onChange={(e) => set((x) => void (x.usMerchantsOnly = e.target.checked))}
                      />
                      {isV3Rule(rule) && (
                        <>
                          <Checkbox
                            label="Limited-time or rotating rule"
                            checked={rule.limitedTime !== null}
                            disabled={busy}
                            onChange={(e) =>
                              setV3(
                                (x) =>
                                  void (x.limitedTime = e.target.checked
                                    ? { startsOn: null, endsOn: null }
                                    : null),
                              )
                            }
                          />
                          <Fieldset
                            legend="Only when paying with (none checked: any payment path)"
                            error={errorAt([...at, 'requiredPaymentPaths'])}
                          >
                            <div className="row">
                              {PAYMENT_PATHS_V3.map((path) => (
                                <Checkbox
                                  key={path}
                                  label={path}
                                  checked={rule.requiredPaymentPaths.includes(path)}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setV3(
                                      (x) =>
                                        void (x.requiredPaymentPaths = e.target.checked
                                          ? [...x.requiredPaymentPaths, path]
                                          : x.requiredPaymentPaths.filter((value) => value !== path)),
                                    )
                                  }
                                />
                              ))}
                            </div>
                          </Fieldset>
                          <p className="small muted">
                            {rule.requires.length
                              ? `Requires ${rule.requires
                                  .map((item) => `${item.gateId} is ${item.optionIds.join(' or ')}`)
                                  .join('; ')} (edit in JSON).`
                              : 'Requires no membership or tier answer.'}
                          </p>
                        </>
                      )}
                    </Fieldset>
                  );
                })}
              </div>
            )}
          </Disclosure>
        ))}
      </div>
      {issues.length > 0 && (
        // Not a live region: field errors are announced politely where they occur, and the summary
        // would otherwise be read out on every keystroke.
        <AlertInline
          color="critical"
          role="none"
          title={`${issues.length} problem${issues.length === 1 ? '' : 's'} to fix`}
        >
          <ul className="issue-list">
            {issues.slice(0, 8).map((issue, i) => {
              const path = issue.path as Path;
              const card =
                path[0] === 'cards' && typeof path[1] === 'number' ? working.cards[path[1]] : undefined;
              const fixable = editableHere(path);
              const hidden = card && (!openCards.has(card.id) || !cards.some((shown) => shown.card === card));
              return (
                <li key={i}>
                  {describe(path)}: {issue.message}
                  {fixable ? '' : ' (edit in JSON)'}
                  {fixable && card && hidden ? (
                    <>
                      {' '}
                      <Button size="small" color="tertiary" onClick={() => openCard(card.id, path)}>
                        {`Open ${card.name}`}
                      </Button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </AlertInline>
      )}
      <LazyDisclosure title={`Preview against ${published ? published.version : 'an empty catalog'}`}>
        {() => <Preview published={published} working={working} />}
      </LazyDisclosure>
      <div className="row">
        <Button
          disabled={!canSave}
          aria-describedby={blockedReason ? 'structured-blocked' : undefined}
          onClick={() => {
            if (canSave && parsed.success) void onSave(parsed.data);
          }}
        >
          Save structured edits
        </Button>
        <Button
          color="secondary"
          disabled={busy || (!dirty && !invalidNumbers)}
          onClick={() => {
            setWorking(structuredClone(catalog));
            setRawNumbers({});
            setRawLists({});
          }}
        >
          Discard structured edits
        </Button>
        <p className="small muted">
          {dirty || invalidNumbers
            ? `${editedFields} field${editedFields === 1 ? '' : 's'} edited since the saved revision.`
            : 'No unsaved edits.'}
        </p>
      </div>
      {blockedReason && dirty ? (
        <p id="structured-blocked" className="small muted">
          {blockedReason}
        </p>
      ) : null}
    </div>
  );
}
