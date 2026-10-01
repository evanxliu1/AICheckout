import { useEffect, useMemo, useState } from 'react';
import {
  CAP_PERIODS,
  catalogSchema,
  type Catalog,
  type CatalogV2,
  type RewardRuleV2,
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

type Path = (string | number)[];
const key = (path: Path) => path.join('.');
const fieldId = (path: Path) => `edit-${key(path).replaceAll('.', '-')}`;
/** Digits only: "0x10", "1e3", "-1", "1.5" and whitespace are rejected rather than coerced. */
const WHOLE_NUMBER = /^\d+$/;
const NOT_A_NUMBER = 'Enter a whole number using digits only.';
const toNumber = (value: string) => (WHOLE_NUMBER.test(value) ? Number(value) : Number.NaN);
const show = (value: number) => (Number.isFinite(value) ? String(value) : '');
const CARD_FIELDS = new Set(['name', 'shortName', 'issuer']);
const RULE_FIELDS = new Set([
  'issuerWording',
  'rateBps',
  'paidOnPaymentBps',
  'cap',
  'activation',
  'limitedTime',
  'usMerchantsOnly',
]);
/** Whether a schema issue at this path can be fixed with a field of the structured editor. */
function editableHere(path: Path) {
  if (path.length === 1) return ['version', 'verifiedAt', 'expiresAt'].includes(String(path[0]));
  if (path[0] !== 'cards') return false;
  if (path.length === 2) return true; // card-level rules (rates, caps) are fixed through its fields
  if (path.length === 3) return CARD_FIELDS.has(String(path[2]));
  if (path[2] !== 'rules') return false;
  return path.length === 4 || RULE_FIELDS.has(String(path[4]));
}

/**
 * Structured editor for catalog v2 drafts: per-card and per-rule fields, validated live with the
 * same Zod schema the API and database mirror, with a preview of the result against the published
 * catalog. Saving creates a new draft revision, like the JSON editor.
 */
export default function StructuredEditor({
  catalog,
  published,
  busy,
  blockedReason,
  onDirty,
  onSave,
}: {
  catalog: CatalogV2;
  published: Catalog | null;
  busy: boolean;
  /** Why saving is not possible right now (another editor or capture has unsaved input). */
  blockedReason?: string;
  onDirty: (value: boolean) => void;
  onSave: (catalog: Catalog) => Promise<void>;
}) {
  const saved = useMemo(() => JSON.stringify(catalog), [catalog]);
  const [working, setWorking] = useState<CatalogV2>(() => structuredClone(catalog));
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  /** Raw text of numeric fields that are not a whole number, keyed by path. */
  const [rawNumbers, setRawNumbers] = useState<Record<string, string>>({});
  const [focusTarget, setFocusTarget] = useState<{ path: Path; card: string } | null>(null);
  const dirty = JSON.stringify(working) !== saved;
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
  /** Props for a whole-number field: shows what was typed, stores NaN until it is digits only. */
  const numeric = (path: Path, value: number, assign: (next: number) => void) => ({
    inputMode: 'numeric' as const,
    value: rawNumbers[key(path)] ?? show(value),
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      setRawNumbers((current) => {
        const next = { ...current };
        if (text === '' || WHOLE_NUMBER.test(text)) delete next[key(path)];
        else next[key(path)] = text;
        return next;
      });
      assign(toNumber(text));
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
  }, [focusTarget, openCards]);
  const update = (change: (draft: CatalogV2) => void) =>
    setWorking((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  const preview = useMemo(() => catalogChanges(published, working), [published, working]);
  const editedFields = useMemo(() => catalogChanges(catalog, working).length, [catalog, working]);

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
    setOpenCards((current) => new Set(current).add(cardId));
    setFocusTarget({ path, card: cardId });
  }
  /** "Citi Double Cash · rule citi-base · rateBps" for an issue path. */
  function describe(path: Path) {
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
  // No <form>: Enter in a field never saves a revision; only the Save button does.
  return (
    <div className="stack">
      <p>
        Edit cards and rules field by field. Rates are basis points (100 = 1%); money is in cents. Every
        change is checked against the catalog schema before it can be saved as a new revision.
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
      {working.cards.map((card, c) => (
        <Disclosure
          key={card.id}
          title={card.name}
          data-card={card.id}
          className="editor-card"
          open={openCards.has(card.id)}
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open;
            setOpenCards((current) => {
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
              </div>
              {card.rules.map((rule, r) => {
                const at: Path = ['cards', c, 'rules', r];
                const set = (change: (rule: RewardRuleV2) => void) =>
                  update((d) => change(d.cards[c].rules[r]));
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
                      <Field {...field([...at, 'paidOnPaymentBps'])} label="Paid when balance is paid (bps)">
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
                              set(
                                (x) =>
                                  void (x.limitedTime = e.target.value ? { endsOn: e.target.value } : null),
                              )
                            }
                          />
                        )}
                      </Field>
                    </div>
                    <Checkbox
                      label="U.S. merchants only"
                      checked={rule.usMerchantsOnly}
                      disabled={busy}
                      onChange={(e) => set((x) => void (x.usMerchantsOnly = e.target.checked))}
                    />
                  </Fieldset>
                );
              })}
            </div>
          )}
        </Disclosure>
      ))}
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
              return (
                <li key={i}>
                  {describe(path)}: {issue.message}
                  {fixable ? '' : ' (edit in JSON)'}
                  {fixable && card && !openCards.has(card.id) ? (
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
      <Disclosure
        title={`Preview against ${published ? published.version : 'an empty catalog'} (${preview.length} changed fields)`}
      >
        {preview.length ? (
          <div className="table-scroll">
            <ChangesTable rows={preview} caption="Edited draft compared with the published catalog" />
          </div>
        ) : (
          <p>No differences from the published catalog.</p>
        )}
      </Disclosure>
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
