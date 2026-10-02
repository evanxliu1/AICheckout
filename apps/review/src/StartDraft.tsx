import { useMemo, useRef, useState } from 'react';
import { catalogSchema, type Catalog } from '@ai-checkout/rewards-core';
import { AlertInline, Badge, Button, Card, Checkbox, Field, Fieldset, Modal, Radio } from '@ai-checkout/ui';
import { bundledCatalogs } from './bundled';

/** Index of a bundled catalog, or pasted JSON. */
type Source = number | 'json';

/** Why a catalog cannot start a draft now: not valid yet or already expired. */
function catalogTimingIssue(catalog: Catalog, now: number) {
  if (Date.parse(catalog.verifiedAt) > now) return 'Its terms are not valid yet (verified in the future).';
  if (Date.parse(catalog.expiresAt) <= now)
    return 'Its terms have expired; rebuild it from reverified terms.';
  return undefined;
}
const date = (value: string) =>
  new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) +
  ' UTC';

/**
 * Starts a new draft from a catalog bundled in this app (the v3 catalog first once it is bundled,
 * then v2) or from pasted catalog JSON. The draft is created with no sources attached; "Capture all
 * missing sources" attaches them afterwards. Creating a draft publishes nothing.
 */
export default function StartDraft({
  bundled: bundledProp,
  head,
  busy,
  now,
  onCreate,
  onCancel,
  intro,
  queuedVersions = [],
}: {
  /** Catalogs offered, newest first; defaults to the ones `@ai-checkout/rewards-core` bundles. */
  bundled?: Catalog[];
  /** Versions of drafts already waiting for review; creating another of the same needs confirmation. */
  queuedVersions?: string[];
  /** Shown above the explanation, for example when no draft is waiting. */
  intro?: string;
  head: number | null;
  busy: boolean;
  now: number;
  onCreate: (catalog: Catalog) => Promise<void>;
  onCancel?: () => void;
}) {
  const bundled = useMemo(() => bundledProp ?? bundledCatalogs(), [bundledProp]);
  // The newest bundled catalog that can be used now, else the newest one, else pasted JSON.
  const [source, setSource] = useState<Source>(() => {
    if (!bundled.length) return 'json';
    const usable = bundled.findIndex((catalog) => !catalogTimingIssue(catalog, now));
    return usable === -1 ? 0 : usable;
  });
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Catalog | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const duplicate = pending !== null && queuedVersions.includes(pending.version);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const chosen = source === 'json' ? undefined : bundled[source];
  const bundledIssue = chosen && catalogTimingIssue(chosen, now);

  function review() {
    setError('');
    setDuplicateConfirmed(false);
    // Validity is checked when you choose Create draft, not when the page was drawn.
    const at = Date.now();
    let catalog: Catalog;
    if (chosen) {
      const issue = catalogTimingIssue(chosen, at);
      if (issue) return setError(`The bundled catalog cannot start a draft. ${issue}`);
      catalog = chosen;
    } else {
      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch {
        return setError('The catalog must be valid JSON. Check its syntax and try again.');
      }
      const parsed = catalogSchema.safeParse(value);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return setError(`${first.path.join('.') || 'Catalog'}: ${first.message}`);
      }
      const issue = catalogTimingIssue(parsed.data, at);
      if (issue) return setError(`This catalog cannot start a draft. ${issue}`);
      catalog = parsed.data;
    }
    setPending(catalog);
  }

  return (
    <section className="stack" aria-labelledby="start-draft-heading">
      <h1 id="start-draft-heading" tabIndex={-1}>
        Start a new draft
      </h1>
      {intro && <p className="lead">{intro}</p>}
      <p>
        A draft is a proposed catalog for review. Creating one publishes nothing: you attach source evidence,
        review every change and publish it as separate steps.
      </p>
      <Fieldset legend="Start from">
        {bundled.map((catalog, index) => (
          <Radio
            key={catalog.version}
            name="draft-source"
            label={
              bundled.length === 1
                ? 'The catalog bundled with this app'
                : `Bundled catalog ${catalog.version} (schema ${catalog.schemaVersion}, ${catalog.cards.length} cards)`
            }
            checked={source === index}
            disabled={busy}
            onChange={() => setSource(index)}
          />
        ))}
        <Radio
          name="draft-source"
          label="Catalog JSON I paste"
          checked={source === 'json'}
          disabled={busy}
          onChange={() => setSource('json')}
        />
      </Fieldset>
      {chosen ? (
        <Card hasBorder as="div">
          <dl className="catalog-facts">
            <div>
              <dt>Version</dt>
              <dd>{chosen.version}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{chosen.schemaVersion}</dd>
            </div>
            <div>
              <dt>Cards</dt>
              <dd>
                {chosen.cards.length} ({chosen.sources.length} sources to capture)
              </dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{date(chosen.verifiedAt)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{date(chosen.expiresAt)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge size="small" color={bundledIssue ? 'critical' : 'success'}>
                  {bundledIssue ? 'Cannot be used' : 'Valid now'}
                </Badge>
              </dd>
            </div>
          </dl>
          {bundledIssue && <p className="small muted">{bundledIssue}</p>}
        </Card>
      ) : (
        <Field
          id="start-draft-json"
          label="Catalog JSON"
          helperText="Validated against the catalog schema (version 1, 2 or 3) before the draft is created."
        >
          {(control) => (
            <textarea
              {...control}
              className="ac-form-text-input textarea code-input"
              rows={12}
              value={json}
              disabled={busy}
              onChange={(event) => setJson(event.target.value)}
            />
          )}
        </Field>
      )}
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      <p className="small muted">
        The draft will be reviewed against {head === null ? 'no published release' : `release ${head}`}.
      </p>
      <div className="row">
        <Button disabled={busy || (source === 'json' && !json.trim())} onClick={review}>
          Create draft
        </Button>
        {onCancel && (
          <Button color="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Modal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        tagline="Start a new draft"
        title={`Create a draft of ${pending?.version ?? ''}?`}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button
              disabled={duplicate && !duplicateConfirmed}
              onClick={() => {
                const catalog = pending;
                setPending(null);
                if (catalog) void onCreate(catalog);
              }}
            >
              Create the draft
            </Button>
            <Button ref={cancelRef} color="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {pending && (
          <div className="stack-tight">
            <p>
              {pending.cards.length} card{pending.cards.length === 1 ? '' : 's'} and {pending.sources.length}{' '}
              source{pending.sources.length === 1 ? '' : 's'}, with no captured evidence yet. Nothing is
              published.
            </p>
            {duplicate && (
              <>
                <AlertInline color="warning" role="none" title="A draft of this version is already waiting">
                  Open the pending {pending.version} draft from the queue instead, unless you mean to create a
                  second one.
                </AlertInline>
                <Checkbox
                  label={`Create another ${pending.version} draft anyway`}
                  checked={duplicateConfirmed}
                  onChange={(event) => setDuplicateConfirmed(event.target.checked)}
                />
              </>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
