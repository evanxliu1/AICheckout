import { useRef, useState } from 'react';
import { CATALOG_V2, catalogSchema, type Catalog } from '@ai-checkout/rewards-core';
import { AlertInline, Badge, Button, Card, Field, Fieldset, Modal, Radio } from '@ai-checkout/ui';

type Source = 'bundled' | 'json';

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
 * Starts a new draft from the catalog bundled in this app or from pasted catalog JSON. The draft is
 * created with no sources attached; "Capture all missing sources" attaches them afterwards. Creating
 * a draft publishes nothing.
 */
export default function StartDraft({
  head,
  busy,
  now,
  onCreate,
  onCancel,
  intro,
}: {
  /** Shown above the explanation, for example when no draft is waiting. */
  intro?: string;
  head: number | null;
  busy: boolean;
  now: number;
  onCreate: (catalog: Catalog) => Promise<void>;
  onCancel?: () => void;
}) {
  const [source, setSource] = useState<Source>('bundled');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Catalog | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const bundledIssue = catalogTimingIssue(CATALOG_V2, now);

  function review() {
    setError('');
    let catalog: Catalog;
    if (source === 'bundled') {
      if (bundledIssue) return setError(`The bundled catalog cannot start a draft. ${bundledIssue}`);
      catalog = CATALOG_V2;
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
      const issue = catalogTimingIssue(parsed.data, now);
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
        <Radio
          name="draft-source"
          label="The catalog bundled with this app"
          checked={source === 'bundled'}
          disabled={busy}
          onChange={() => setSource('bundled')}
        />
        <Radio
          name="draft-source"
          label="Catalog JSON I paste"
          checked={source === 'json'}
          disabled={busy}
          onChange={() => setSource('json')}
        />
      </Fieldset>
      {source === 'bundled' ? (
        <Card hasBorder as="div">
          <dl className="catalog-facts">
            <div>
              <dt>Version</dt>
              <dd>{CATALOG_V2.version}</dd>
            </div>
            <div>
              <dt>Cards</dt>
              <dd>
                {CATALOG_V2.cards.length} ({CATALOG_V2.sources.length} sources to capture)
              </dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{date(CATALOG_V2.verifiedAt)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{date(CATALOG_V2.expiresAt)}</dd>
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
          helperText="Validated against the catalog schema (version 1 or 2) before the draft is created."
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
          <p>
            {pending.cards.length} card{pending.cards.length === 1 ? '' : 's'} and {pending.sources.length}{' '}
            source{pending.sources.length === 1 ? '' : 's'}, with no captured evidence yet. Nothing is
            published.
          </p>
        )}
      </Modal>
    </section>
  );
}
