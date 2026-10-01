import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ReviewDetail } from '@ai-checkout/catalog-review';
import { MAX_SOURCE_BODY_CHARS } from '@ai-checkout/catalog-review';
import { catalogSchema, type Catalog } from '@ai-checkout/rewards-core';
import {
  AlertInline,
  Badge,
  Button,
  Card,
  Checkbox,
  Disclosure,
  Field,
  Link,
  Modal,
  Select,
  Tabs,
} from '@ai-checkout/ui';
import { catalogChanges, publicationIssues, ruleSummaries } from './comparison';
import ChangesTable from './ChangesTable';
import StructuredEditor from './StructuredEditor';

export type CaptureItem = { sourceKey: string; body: string };

function sourceMatches(detail: ReviewDetail, sourceId: string) {
  const source = detail.draft.catalog.sources.find((s) => s.id === sourceId)!;
  const doc = detail.sources.find((value) => value.source_key === source.id);
  return !!(
    doc &&
    doc.title === source.title &&
    doc.url === source.url &&
    doc.checked_on === source.checkedOn
  );
}

/**
 * One step to attach evidence for every source the draft cites but has not captured yet: load the
 * saved capture files (named `<source-id>.txt`) or paste text, then capture them all and attach
 * them in a single draft revision.
 */
function CaptureMissingSources({
  detail,
  busy,
  onCaptureMany,
  onDirty,
}: {
  detail: ReviewDetail;
  busy: boolean;
  onCaptureMany: (items: CaptureItem[]) => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const missing = detail.draft.catalog.sources.filter((source) => !sourceMatches(detail, source.id));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [loadNote, setLoadNote] = useState('');
  const filled = missing.filter((source) => (texts[source.id] ?? '').trim());
  const tooLong = missing.filter((source) => (texts[source.id] ?? '').length > MAX_SOURCE_BODY_CHARS);
  useEffect(() => onDirty(Object.values(texts).some((text) => text.length > 0)), [texts, onDirty]);
  if (!missing.length) return <p className="muted small">Every source has matching captured evidence.</p>;

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    const next = { ...texts };
    const matched: string[] = [],
      ignored: string[] = [];
    for (const file of files) {
      const id = file.name.replace(/\.txt$/i, '');
      if (missing.some((source) => source.id === id)) {
        next[id] = await file.text();
        matched.push(id);
      } else ignored.push(file.name);
    }
    setTexts(next);
    setLoadNote(
      `Loaded ${matched.length} file${matched.length === 1 ? '' : 's'}${
        ignored.length
          ? `; ignored ${ignored.length} that match no missing source (${ignored.join(', ')})`
          : ''
      }.`,
    );
    event.target.value = '';
  }
  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (busy || !filled.length || tooLong.length) return;
        void onCaptureMany(filled.map((source) => ({ sourceKey: source.id, body: texts[source.id] })));
      }}
    >
      <p>
        {missing.length} source{missing.length === 1 ? ' needs' : 's need'} captured evidence before
        publication. Load the saved capture files (named <code>&lt;source id&gt;.txt</code>) or paste each
        source’s text. All filled sources are captured and attached in one new draft revision.
      </p>
      <Field
        id="capture-files"
        label="Load capture files"
        helperText="Text files only; nothing is uploaded until you capture."
      >
        {(control) => (
          <input
            {...control}
            className="ac-form-text-input"
            type="file"
            accept=".txt,text/plain"
            multiple
            disabled={busy}
            onChange={(event) => void load(event)}
          />
        )}
      </Field>
      {loadNote && (
        <AlertInline role="status" color="neutral">
          {loadNote}
        </AlertInline>
      )}
      {missing.map((source) => {
        const text = texts[source.id] ?? '';
        return (
          <Field
            key={source.id}
            id={`capture-${source.id}`}
            label={`${source.title} (${source.id})`}
            helperText={`Checked ${source.checkedOn}. ${text.length.toLocaleString('en-US')} characters.`}
            error={
              text.length > MAX_SOURCE_BODY_CHARS
                ? `Too long: at most ${MAX_SOURCE_BODY_CHARS.toLocaleString('en-US')} characters.`
                : undefined
            }
          >
            {(control) => (
              <textarea
                {...control}
                className="ac-form-text-input textarea"
                rows={3}
                value={text}
                disabled={busy}
                onChange={(event) => setTexts({ ...texts, [source.id]: event.target.value })}
              />
            )}
          </Field>
        );
      })}
      <Button type="submit" icon="check-circle" disabled={busy || !filled.length || tooLong.length > 0}>
        {`Capture ${filled.length} of ${missing.length} missing sources and attach`}
      </Button>
    </form>
  );
}

export function DraftPanel({
  detail,
  busy,
  onDirty,
  onUpdate,
  onCapture,
  onCaptureMany,
  onPublish,
}: {
  detail: ReviewDetail;
  busy: boolean;
  onDirty: (value: boolean) => void;
  onUpdate: (catalog: Catalog, baseSequence: number | null) => Promise<void>;
  onCapture: (sourceKey: string, body: string) => Promise<void>;
  onCaptureMany?: (items: CaptureItem[]) => Promise<void>;
  onPublish: (note: string) => Promise<void>;
}) {
  const original = JSON.stringify(detail.draft.catalog, null, 2);
  const [edited, setEdited] = useState(original),
    [body, setBody] = useState('');
  const [sourceKey, setSourceKey] = useState(detail.draft.catalog.sources[0]?.id ?? '');
  const [confirmed, setConfirmed] = useState(false),
    [note, setNote] = useState(''),
    [inputError, setInputError] = useState('');
  const [structuredDirty, setStructuredDirty] = useState(false),
    [captureDirty, setCaptureDirty] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  const dirty = edited !== original || body.length > 0 || structuredDirty || captureDirty,
    editable = detail.draft.status === 'draft';
  const issues = publicationIssues(detail, now),
    changes = catalogChanges(detail.published?.catalog ?? null, detail.draft.catalog);
  if (dirty) issues.push('Save or discard your edits before approving this revision.');
  const canPublish = !busy && confirmed && issues.length === 0 && note.trim().length >= 10;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setInputError('');
    setConfirmed(false);
    try {
      const parsed = catalogSchema.safeParse(JSON.parse(edited));
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        setInputError(`${first.path.join('.') || 'Catalog'}: ${first.message}`);
        return;
      }
      await onUpdate(parsed.data, detail.draft.base_sequence);
    } catch {
      setInputError('The draft must be valid JSON. Check its syntax and try again.');
    }
  }
  function discard() {
    setEdited(original);
    setBody('');
    setInputError('');
    setConfirmed(false);
  }
  const jsonEditor = (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <p>
        Update the proposed catalog, then save a new revision. Keep only supported rules and exact source
        references. Dates must reflect a real review of the terms.
      </p>
      <Field id="catalog-json" label="Catalog JSON" error={inputError || undefined}>
        {(control) => (
          <textarea
            {...control}
            className="ac-form-text-input textarea code-input"
            rows={16}
            value={edited}
            disabled={busy || structuredDirty}
            onChange={(event) => {
              setEdited(event.target.value);
              setConfirmed(false);
            }}
          />
        )}
      </Field>
      <div className="row">
        <Button type="submit" disabled={busy || edited === original || !!body || structuredDirty}>
          Save draft revision
        </Button>
        <Button color="secondary" disabled={busy || edited === original} onClick={discard}>
          Discard edits
        </Button>
      </div>
    </form>
  );
  return (
    <div className="stack">
      {editable && issues.length > 0 && (
        <AlertInline
          color="warning"
          role="none"
          title="Before you publish"
          titleTag="h2"
          actions={
            detail.draft.base_sequence !== detail.head ? (
              <Button
                size="small"
                color="secondary"
                disabled={busy || dirty}
                onClick={() => {
                  setConfirmed(false);
                  void onUpdate(detail.draft.catalog, detail.head);
                }}
              >
                Rebase draft for review
              </Button>
            ) : undefined
          }
        >
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </AlertInline>
      )}
      <div className="review-columns">
        <section className="stack" aria-labelledby="changes-heading">
          <h2 id="changes-heading">What changes</h2>
          <p className="muted small">
            {detail.published
              ? `Compared with ${detail.published.version}.`
              : 'This is the first published catalog; every field is new.'}{' '}
            Review all conditions, including fields that stay the same.
          </p>
          {detail.published && Date.parse(detail.published.catalog.expiresAt) <= now && (
            <AlertInline color="warning" role="none">
              The published terms expired. They are shown here for comparison only.
            </AlertInline>
          )}
          {changes.length ? (
            <div className="table-scroll">
              <ChangesTable rows={changes} caption="Published and proposed catalog changes" />
            </div>
          ) : (
            <p>No differences from the current published catalog.</p>
          )}
          <Disclosure title="All proposed card rules">
            <p className="small muted">
              Includes unchanged conditions. Rates apply only to eligible purchases; the catalog does not
              establish a shopper’s eligibility.
            </p>
            {detail.draft.catalog.cards.map((card) => (
              <article className="rule-summary" key={card.id}>
                <h3>{card.name}</h3>
                <ul>
                  {ruleSummaries(card.rules).map(({ rule, title, conditions }) => (
                    <li key={rule.id}>
                      <strong>{title}</strong>
                      <p>{conditions}</p>
                      <p className="small muted">
                        Rule: {rule.id} · Sources: {rule.sourceIds.join(', ')}
                      </p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </Disclosure>
          <Disclosure title="Full draft data and approval identity">
            <p className="small">
              Revision {detail.draft.revision}; reviewed against release {detail.head ?? 'none'}. Approval is
              bound to the complete payload shown below.
            </p>
            <code className="hash">{detail.draft.catalog_hash}</code>
            <pre className="code-block">{original}</pre>
          </Disclosure>
        </section>
        <section className="stack" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading">Source evidence</h2>
          <p className="muted small">
            A capture records the source. Check the full issuer terms to confirm rates, eligibility, caps, and
            exclusions.
          </p>
          {detail.draft.catalog.sources.map((source, index) => {
            const doc = detail.sources.find((value) => value.source_key === source.id);
            const matches = sourceMatches(detail, source.id);
            return (
              <Card as="article" hasBorder key={source.id}>
                <div className="source-card stack-tight">
                  <h3>{source.title}</h3>
                  <Link href={source.url} isExternal>
                    Read source terms
                  </Link>
                  <p className="small muted">
                    Checked {source.checkedOn} · {source.id}
                  </p>
                  <Badge
                    size="small"
                    color={matches ? 'success' : 'warning'}
                    icon={matches ? 'check-circle' : 'alert-triangle'}
                  >
                    {matches ? 'Matching evidence captured' : 'Matching evidence needed'}
                  </Badge>
                  {doc && (
                    <Disclosure title="Captured text" open={index === 0}>
                      <pre className="source-text">{doc.body}</pre>
                      <p className="small muted">
                        Captured {new Date(doc.created_at).toLocaleString('en-US')}
                      </p>
                    </Disclosure>
                  )}
                </div>
              </Card>
            );
          })}
          {editable && onCaptureMany && (
            <Disclosure title="Capture all missing sources">
              <CaptureMissingSources
                detail={detail}
                busy={busy}
                onCaptureMany={onCaptureMany}
                onDirty={setCaptureDirty}
              />
            </Disclosure>
          )}
          {editable && (
            <Disclosure title="Capture source evidence">
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  setConfirmed(false);
                  void onCapture(sourceKey, body);
                }}
              >
                <Field id="source-choice" label="Source to capture">
                  {(control) => (
                    <Select
                      {...control}
                      value={sourceKey}
                      disabled={busy}
                      onChange={(event) => {
                        if (body && !window.confirm('Discard the pasted text and choose another source?'))
                          return;
                        setSourceKey(event.target.value);
                        setBody('');
                        setConfirmed(false);
                      }}
                    >
                      {detail.draft.catalog.sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  id="source-body"
                  label="Text from the source"
                  helperText={`Paste the terms you checked on the date recorded above. Capture preserves that date; it does not refresh expired terms. Maximum ${MAX_SOURCE_BODY_CHARS.toLocaleString('en-US')} characters.`}
                >
                  {(control) => (
                    <textarea
                      {...control}
                      className="ac-form-text-input textarea"
                      rows={9}
                      required
                      maxLength={MAX_SOURCE_BODY_CHARS}
                      value={body}
                      disabled={busy}
                      onChange={(event) => {
                        setBody(event.target.value);
                        setConfirmed(false);
                      }}
                    />
                  )}
                </Field>
                <div className="row">
                  <Button type="submit" disabled={busy || !body.trim() || edited !== original}>
                    Capture and attach evidence
                  </Button>
                  {body && (
                    <Button color="secondary" disabled={busy} onClick={discard}>
                      Discard unsaved source text
                    </Button>
                  )}
                </div>
              </form>
            </Disclosure>
          )}
        </section>
      </div>
      {editable && (
        <>
          <Disclosure title="Correct draft data">
            {detail.draft.catalog.schemaVersion === 2 ? (
              <Tabs
                label="Draft editors"
                tabs={[
                  {
                    id: 'structured',
                    label: 'Cards and rules',
                    content: (
                      <StructuredEditor
                        catalog={detail.draft.catalog}
                        published={detail.published?.catalog ?? null}
                        busy={busy || edited !== original || !!body}
                        onDirty={setStructuredDirty}
                        onSave={(catalog) => {
                          setConfirmed(false);
                          return onUpdate(catalog, detail.draft.base_sequence);
                        }}
                      />
                    ),
                  },
                  { id: 'json', label: 'JSON', content: jsonEditor },
                ]}
              />
            ) : (
              jsonEditor
            )}
          </Disclosure>
          <Card as="section" hasBorder aria-labelledby="approval-heading">
            <form
              className="approval stack"
              onSubmit={(event) => {
                event.preventDefault();
                if (canPublish) setReviewing(true);
              }}
            >
              <h2 id="approval-heading">Approve this revision</h2>
              <p>
                Publishing makes these rules available to every extension using this catalog. Confirm the
                complete draft and its sources before continuing.
              </p>
              <Checkbox
                label="I checked the full source terms and all proposed rules and conditions."
                checked={confirmed}
                disabled={busy || issues.length > 0}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <Field id="review-note" label="Review note">
                {(control) => (
                  <textarea
                    {...control}
                    className="ac-form-text-input textarea"
                    rows={3}
                    minLength={10}
                    maxLength={2000}
                    required
                    value={note}
                    disabled={busy}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Record what you checked and any deliberate limitations."
                  />
                )}
              </Field>
              <div className="row">
                <p className="small muted">
                  Approving {detail.draft.catalog.version}, revision {detail.draft.revision}.
                </p>
                <Button type="submit" disabled={!canPublish}>
                  Publish reviewed terms
                </Button>
              </div>
            </form>
          </Card>
          <Modal
            isOpen={reviewing}
            onClose={() => setReviewing(false)}
            color="warning"
            icon="alert-triangle"
            tagline="Publish a catalog release"
            title={`Publish ${detail.draft.catalog.version}?`}
            initialFocusRef={cancelRef}
            footer={
              <>
                <Button
                  disabled={!canPublish}
                  onClick={() => {
                    setReviewing(false);
                    setConfirmed(false);
                    void onPublish(note.trim());
                  }}
                >
                  Publish release
                </Button>
                <Button ref={cancelRef} color="secondary" onClick={() => setReviewing(false)}>
                  Cancel
                </Button>
              </>
            }
          >
            <div className="stack-tight">
              <p>
                Every extension that checks for updated terms will receive revision {detail.draft.revision} of{' '}
                {detail.draft.catalog.version}: {detail.draft.catalog.cards.length} card
                {detail.draft.catalog.cards.length === 1 ? '' : 's'} and {detail.draft.catalog.sources.length}{' '}
                source{detail.draft.catalog.sources.length === 1 ? '' : 's'}, {changes.length} changed field
                {changes.length === 1 ? '' : 's'} compared with{' '}
                {detail.published ? detail.published.version : 'no published release'}.
              </p>
              <p>Terms expire {new Date(detail.draft.catalog.expiresAt).toLocaleString('en-US')}.</p>
              <p className="small muted">Review note: {note.trim()}</p>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
