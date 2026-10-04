import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ReviewSummary, SourceSummary } from '@ai-checkout/catalog-review';
import type { SourceDocument } from '@ai-checkout/catalog-review/curation';
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
  TextInput,
} from '@ai-checkout/ui';
import { catalogChanges, publicationIssues, ruleSummaries } from './comparison';
import ChangesTable from './ChangesTable';
import LazyDisclosure from './LazyDisclosure';
import StructuredEditor from './StructuredEditor';
import { manifestComparison, sha256 } from './manifest';

export type CaptureItem = { sourceKey: string; body: string };
/** Reads one attached capture's text; the draft summary lists sources without text. */
export type LoadSource = (sourceDocumentId: string, signal: AbortSignal) => Promise<SourceDocument>;
type Editor = 'json' | 'structured' | 'single' | 'multi';
const EDITOR_NAMES: Record<Editor, string> = {
  json: 'the JSON editor',
  structured: 'the Cards and rules editor',
  single: 'Capture source evidence',
  multi: 'Capture all missing sources',
};
/**
 * Each save or capture creates a revision from the saved draft and reloads it, which would discard
 * unsaved input elsewhere. So an action is blocked while another editor has unsaved input, and says
 * why.
 */
function blockedBy(dirty: Record<Editor, boolean>, self: Editor) {
  const others = (Object.keys(dirty) as Editor[]).filter((editor) => editor !== self && dirty[editor]);
  if (!others.length) return undefined;
  return `Save or discard the unsaved input in ${others.map((editor) => EDITOR_NAMES[editor]).join(' and ')} first; this action would discard it.`;
}
/** Files larger than this many bytes cannot hold an allowed capture (at most 4 bytes per character). */
const MAX_CAPTURE_FILE_BYTES = MAX_SOURCE_BODY_CHARS * 4;
/** Up to this many missing sources get a paste field each; more are loaded from files only. */
const PASTE_FIELD_LIMIT = 30;
/** Up to this many sources are listed without a search field. */
const SOURCE_SEARCH_THRESHOLD = 12;
/** "a, b, c and 4 more" for a note about skipped files. */
function names(values: string[], shown = 5) {
  return values.length > shown
    ? `${values.slice(0, shown).join(', ')} and ${values.length - shown} more`
    : values.join(', ');
}

function sourceMatches(detail: ReviewSummary, sourceId: string) {
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
 * saved capture files (named `<source id>.txt`) one by one or as a whole folder, or paste text, then
 * capture them all and attach them in a single draft revision. Loaded files are checked against the
 * SHA-256 in the corpus manifests (real, merchant, expansion and pipeline batches); a file whose hash
 * matches none of its source's known captures is not loaded. Pasted text that differs is only flagged.
 */
function CaptureMissingSources({
  detail,
  busy,
  blockedReason,
  onCaptureMany,
  onDirty,
}: {
  detail: ReviewSummary;
  busy: boolean;
  blockedReason?: string;
  onCaptureMany: (items: CaptureItem[]) => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const missing = detail.draft.catalog.sources.filter((source) => !sourceMatches(detail, source.id));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [hashes, setHashes] = useState<Record<string, string | undefined>>({});
  const [loadNote, setLoadNote] = useState('');
  /** Text per source as last set, for discarding stale hash results. */
  const latest = useRef<Record<string, string>>({});
  const paste = missing.length <= PASTE_FIELD_LIMIT;
  const filled = missing.filter((source) => (texts[source.id] ?? '').trim());
  const tooLong = missing.filter((source) => (texts[source.id] ?? '').length > MAX_SOURCE_BODY_CHARS);
  useEffect(() => onDirty(Object.values(texts).some((text) => text.length > 0)), [texts, onDirty]);
  if (!missing.length) return <p className="muted small">Every source has matching captured evidence.</p>;

  function setText(id: string, text: string) {
    setTexts((current) => ({ ...current, [id]: text }));
    latest.current[id] = text;
    void (text ? sha256(text) : Promise.resolve(undefined)).then((hash) => {
      // Only if the text is still the one hashed.
      if (latest.current[id] === text) setHashes((known) => ({ ...known, [id]: hash }));
    });
  }
  async function load(list: FileList | null, input: HTMLInputElement) {
    const files = [...(list ?? [])];
    const next = { ...texts },
      nextHashes = { ...hashes };
    const matched: string[] = [],
      ignored: string[] = [],
      oversized: string[] = [],
      differs: string[] = [];
    let other = 0,
      inManifest = 0;
    for (const file of files) {
      if (!/\.txt$/i.test(file.name)) {
        other++;
        continue;
      }
      const id = file.name.replace(/\.txt$/i, '');
      if (!missing.some((source) => source.id === id)) ignored.push(file.name);
      else if (file.size > MAX_CAPTURE_FILE_BYTES) oversized.push(file.name);
      else {
        const text = await file.text(),
          hash = await sha256(text);
        const comparison = manifestComparison(id, hash);
        if (comparison === 'differs') differs.push(file.name);
        else {
          next[id] = text;
          nextHashes[id] = hash;
          matched.push(id);
          if (comparison === 'matches') inManifest++;
        }
      }
    }
    setTexts(next);
    setHashes(nextHashes);
    latest.current = { ...next };
    setLoadNote(
      `Loaded ${matched.length} file${matched.length === 1 ? '' : 's'}${
        ignored.length ? `; ignored ${ignored.length} that match no missing source (${names(ignored)})` : ''
      }${oversized.length ? `; skipped ${oversized.length} too large to be a capture (${names(oversized)})` : ''}${
        other ? `; skipped ${other} that are not .txt files` : ''
      }.${
        differs.length
          ? ` Refused ${differs.length} whose SHA-256 differs from the corpus manifest (${names(differs)}): check that ${differs.length === 1 ? 'it is' : 'they are'} the right file${differs.length === 1 ? '' : 's'}.`
          : ''
      }${
        matched.length
          ? ` ${inManifest} of ${matched.length} match${inManifest === 1 ? 'es' : ''} a corpus manifest${
              matched.length - inManifest ? `; ${matched.length - inManifest} are not in one` : ''
            }.`
          : ''
      }`,
    );
    input.value = '';
  }
  const stillMissing = missing.filter((source) => !(texts[source.id] ?? '').trim());
  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (busy || blockedReason || !filled.length || tooLong.length) return;
        void onCaptureMany(filled.map((source) => ({ sourceKey: source.id, body: texts[source.id] })));
      }}
    >
      <p>
        {missing.length} source{missing.length === 1 ? ' needs' : 's need'} captured evidence before
        publication. Load the saved capture files (named <code>&lt;source id&gt;.txt</code>), or the folder
        that holds them{paste ? ', or paste each source’s text' : ''}. All loaded sources are captured and
        attached in one new draft revision.
      </p>
      <div className="editor-grid">
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
              onChange={(event) => void load(event.target.files, event.target)}
            />
          )}
        </Field>
        <Field
          id="capture-folder"
          label="Load a capture folder"
          helperText="Every <source id>.txt in the folder; other files are skipped."
        >
          {(control) => (
            <input
              {...control}
              // Not in React's input types; the browser picks a folder and lists its files.
              ref={(element) => element?.setAttribute('webkitdirectory', '')}
              className="ac-form-text-input"
              type="file"
              multiple
              disabled={busy}
              onChange={(event) => void load(event.target.files, event.target)}
            />
          )}
        </Field>
      </div>
      {loadNote && (
        <AlertInline role="status" color="neutral">
          {loadNote}
        </AlertInline>
      )}
      {paste ? (
        missing.map((source) => {
          const text = texts[source.id] ?? '';
          const hash = text ? hashes[source.id] : undefined;
          const comparison = manifestComparison(source.id, hash);
          return (
            <Field
              key={source.id}
              id={`capture-${source.id}`}
              label={`${source.title} (${source.id})`}
              helperText={`Checked ${source.checkedOn}. ${text.length.toLocaleString('en-US')} characters.${
                hash ? ` SHA-256 ${hash.slice(0, 12)}…` : ''
              }${
                comparison === 'matches'
                  ? ' Matches the corpus manifest capture.'
                  : comparison === 'differs'
                    ? ' Differs from the corpus manifest capture: check that this is the right file.'
                    : ''
              }`}
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
                  onChange={(event) => setText(source.id, event.target.value)}
                />
              )}
            </Field>
          );
        })
      ) : (
        <>
          <p className="small">
            {filled.length.toLocaleString('en-US')} of {missing.length.toLocaleString('en-US')} missing
            sources have text loaded.
          </p>
          {stillMissing.length > 0 && filled.length > 0 && (
            <Disclosure title={`Sources still without text (${stillMissing.length})`}>
              <ul className="source-ids">
                {stillMissing.map((source) => (
                  <li key={source.id}>
                    <code>{source.id}</code> · {source.title}
                  </li>
                ))}
              </ul>
              <p className="small muted">Load their files, or capture one at a time below.</p>
            </Disclosure>
          )}
        </>
      )}
      <div className="row">
        <Button
          type="submit"
          icon="check-circle"
          disabled={busy || !!blockedReason || !filled.length || tooLong.length > 0}
          aria-describedby={blockedReason ? 'capture-many-blocked' : undefined}
        >
          {`Capture ${filled.length} of ${missing.length} missing sources and attach`}
        </Button>
        {!paste && filled.length > 0 && (
          <Button
            color="secondary"
            disabled={busy}
            onClick={() => {
              setTexts({});
              setHashes({});
              latest.current = {};
              setLoadNote('');
            }}
          >
            Clear loaded files
          </Button>
        )}
      </div>
      {blockedReason && (
        <p id="capture-many-blocked" className="small muted">
          {blockedReason}
        </p>
      )}
    </form>
  );
}

/** One captured text, read from the API when its disclosure is first opened. */
function CapturedText({ doc, loadSource }: { doc: SourceSummary; loadSource: LoadSource }) {
  const [state, setState] = useState<{ body?: string; error?: string }>({});
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return (
    <LazyDisclosure
      title={`Captured text (${doc.body_chars.toLocaleString('en-US')} characters)`}
      onOpen={() => {
        if (state.body !== undefined || active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setState({});
        loadSource(doc.id, controller.signal).then(
          (source) => {
            active.current = null;
            if (!controller.signal.aborted) setState({ body: source.body });
          },
          (failure: unknown) => {
            active.current = null;
            if (!controller.signal.aborted)
              setState({
                error: failure instanceof Error ? failure.message : 'The capture could not be loaded.',
              });
          },
        );
      }}
    >
      {() => (
        <>
          {state.body !== undefined ? (
            <pre className="source-text">{state.body}</pre>
          ) : state.error ? (
            <AlertInline color="critical" role="alert">
              {state.error} Close and open this section to try again.
            </AlertInline>
          ) : (
            <p className="small muted" role="status">
              Loading the captured text…
            </p>
          )}
          <p className="small muted">Captured {new Date(doc.created_at).toLocaleString('en-US')}</p>
        </>
      )}
    </LazyDisclosure>
  );
}

/** Every source the draft cites, with its capture status; searchable when the list is long. Memoized
 * so typing elsewhere in the panel does not redraw hundreds of source cards. */
const SourceEvidence = memo(function SourceEvidence({
  detail,
  loadSource,
}: {
  detail: ReviewSummary;
  loadSource: LoadSource;
}) {
  const [query, setQuery] = useState('');
  const sources = detail.draft.catalog.sources;
  const matching = sources.filter((source) => sourceMatches(detail, source.id)).length;
  const inManifest = detail.sources.filter(
    (doc) => manifestComparison(doc.source_key, doc.content_hash) === 'matches',
  ).length;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sources.filter((source) =>
        [source.id, source.title, source.url].some((value) => value.toLowerCase().includes(needle)),
      )
    : sources;
  return (
    <>
      <p className="small">
        {matching} of {sources.length} source{sources.length === 1 ? ' has' : 's have'} matching captured
        evidence{inManifest ? `; ${inManifest} match${inManifest === 1 ? 'es' : ''} a corpus manifest` : ''}.
      </p>
      {sources.length > SOURCE_SEARCH_THRESHOLD && (
        <>
          <Field id="source-search" label="Find a source" helperText="Search by source ID, title or URL.">
            {(control) => (
              <TextInput
                {...control}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </Field>
          <p className="small muted" role="status">
            {needle ? `${shown.length} of ${sources.length} sources match.` : ''}
          </p>
        </>
      )}
      {shown.map((source) => {
        const doc = detail.sources.find((value) => value.source_key === source.id);
        const matches = sourceMatches(detail, source.id);
        const comparison = doc ? manifestComparison(source.id, doc.content_hash) : undefined;
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
                <p className="small muted">
                  Captured SHA-256 <code className="hash">{doc.content_hash.slice(0, 12)}…</code>
                  {comparison === 'matches'
                    ? ' · matches the corpus manifest'
                    : comparison === 'differs'
                      ? ' · differs from the corpus manifest'
                      : ''}
                </p>
              )}
              {doc && <CapturedText doc={doc} loadSource={loadSource} />}
            </div>
          </Card>
        );
      })}
    </>
  );
});

export function DraftPanel({
  detail,
  busy,
  onDirty,
  onUpdate,
  onCapture,
  onCaptureMany,
  onPublish,
  onLoadSource,
}: {
  detail: ReviewSummary;
  busy: boolean;
  onDirty: (value: boolean) => void;
  onUpdate: (catalog: Catalog, baseSequence: number | null) => Promise<void>;
  onCapture: (sourceKey: string, body: string) => Promise<void>;
  onCaptureMany?: (items: CaptureItem[]) => Promise<void>;
  onPublish: (note: string) => Promise<void>;
  onLoadSource: LoadSource;
}) {
  const original = useMemo(() => JSON.stringify(detail.draft.catalog, null, 2), [detail.draft.catalog]);
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
  const editors: Record<Editor, boolean> = {
    json: edited !== original,
    structured: structuredDirty,
    single: body.length > 0,
    multi: captureDirty,
  };
  const dirty = Object.values(editors).some(Boolean),
    editable = detail.draft.status === 'draft';
  const blocked = (self: Editor) => blockedBy(editors, self);
  const issues = publicationIssues(detail, now);
  const changes = useMemo(
    () => catalogChanges(detail.published?.catalog ?? null, detail.draft.catalog),
    [detail.published, detail.draft.catalog],
  );
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
    setInputError('');
    setConfirmed(false);
  }
  function discardSource() {
    setBody('');
    setConfirmed(false);
  }
  const jsonEditor = (
    <form
      className="stack"
      onSubmit={(event) => {
        if (blocked('json')) return void event.preventDefault();
        void save(event);
      }}
    >
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
        <Button
          type="submit"
          disabled={busy || edited === original || !!blocked('json')}
          aria-describedby={blocked('json') ? 'json-blocked' : undefined}
        >
          Save draft revision
        </Button>
        <Button color="secondary" disabled={busy || edited === original} onClick={discard}>
          Discard edits
        </Button>
      </div>
      {blocked('json') && (
        <p id="json-blocked" className="small muted">
          {blocked('json')}
        </p>
      )}
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
            <ChangesTable rows={changes} caption="Published and proposed catalog changes" />
          ) : (
            <p>No differences from the current published catalog.</p>
          )}
          <LazyDisclosure title={`All proposed card rules (${detail.draft.catalog.cards.length} cards)`}>
            {() => (
              <>
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
              </>
            )}
          </LazyDisclosure>
          <Disclosure title="Full draft data and approval identity">
            <p className="small">
              Revision {detail.draft.revision}; reviewed against release {detail.head ?? 'none'}. Approval is
              bound to the complete payload, shown when you open it below.
            </p>
            <code className="hash">{detail.draft.catalog_hash}</code>
            <LazyDisclosure title="Show the complete draft JSON">
              {() => <pre className="code-block">{original}</pre>}
            </LazyDisclosure>
          </Disclosure>
        </section>
        <section className="stack" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading">Source evidence</h2>
          <p className="muted small">
            A capture records the source. Check the full issuer terms to confirm rates, eligibility, caps, and
            exclusions.
          </p>
          {editable && onCaptureMany && (
            <Disclosure title="Capture all missing sources">
              <CaptureMissingSources
                detail={detail}
                busy={busy}
                blockedReason={blocked('multi')}
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
                  if (blocked('single')) return;
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
                  <Button
                    type="submit"
                    disabled={busy || !body.trim() || !!blocked('single')}
                    aria-describedby={blocked('single') ? 'capture-blocked' : undefined}
                  >
                    Capture and attach evidence
                  </Button>
                  {body && (
                    <Button color="secondary" disabled={busy} onClick={discardSource}>
                      Discard unsaved source text
                    </Button>
                  )}
                </div>
                {blocked('single') && (
                  <p id="capture-blocked" className="small muted">
                    {blocked('single')}
                  </p>
                )}
              </form>
            </Disclosure>
          )}
          <SourceEvidence detail={detail} loadSource={onLoadSource} />
        </section>
      </div>
      {editable && (
        <>
          <Disclosure title="Correct draft data">
            {detail.draft.catalog.schemaVersion !== 1 ? (
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
                        busy={busy || edited !== original}
                        blockedReason={blocked('structured')}
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
              <p>
                Terms expire{' '}
                {new Date(detail.draft.catalog.expiresAt).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                })}{' '}
                UTC.
              </p>
              <p className="small muted">Review note: {note.trim()}</p>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
