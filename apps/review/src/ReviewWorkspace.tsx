import { useCallback, useEffect, useRef, useState } from 'react';
import { draftIdSchema, type ReviewDetail, type ReviewQueue } from '@ai-checkout/catalog-review';
import { catalogSchema, type Catalog } from '@ai-checkout/rewards-core';
import type { ReviewApi } from './client';
import { catalogChanges, publicationIssues } from './comparison';
import ExtractionPanel from './ExtractionPanel';
import { ruleSummaries } from './comparison';

export default function ReviewWorkspace({ api }: { api: ReviewApi }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null),
    [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [pending, setPending] = useState('Loading drafts…'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0),
    [dirty, setDirty] = useState(false);
  const controller = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const busy = !!pending;
  const showDetail = useCallback((value: ReviewDetail | null) => {
    setDetail(value);
    setGeneration((previous) => previous + 1);
    setDirty(false);
    if (value && new URLSearchParams(location.hash.slice(1)).get('draft') !== value.draft.id)
      history.replaceState(null, '', `#${value.draft.id}`);
  }, []);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void (async () => {
      try {
        const next = await api.queue(active.signal);
        const parsed = draftIdSchema.safeParse(
          new URLSearchParams(location.hash.slice(1)).get('draft') ?? location.hash.slice(1),
        );
        const selected = parsed.success ? parsed.data : next.drafts[0]?.id;
        const selectedDetail = selected ? await api.detail(selected, active.signal) : null;
        if (!active.signal.aborted) {
          setQueue(next);
          showDetail(selectedDetail);
        }
      } catch (failure) {
        if (!active.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Drafts could not be loaded. Try again.');
      } finally {
        if (!active.signal.aborted) setPending('');
      }
    })();
    return () => active.abort();
  }, [api, showDetail]);
  useEffect(() => {
    if (detail) heading.current?.focus({ preventScroll: true });
  }, [detail]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function perform(label: string, action: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setPending(label);
    setError('');
    setNotice('');
    try {
      await action(signal);
    } catch (failure) {
      if (!signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'The action could not finish. Reload the draft.',
        );
    } finally {
      if (!signal.aborted) setPending('');
    }
  }
  async function refresh(id: string | undefined, signal: AbortSignal) {
    const nextQueue = await api.queue(signal);
    const selected = id ?? nextQueue.drafts[0]?.id;
    const nextDetail = selected ? await api.detail(selected, signal) : null;
    if (!signal.aborted) {
      setQueue(nextQueue);
      showDetail(nextDetail);
    }
  }
  function load(id?: string) {
    if (dirty && !window.confirm('Discard unsaved draft or source edits and load the latest version?'))
      return;
    void perform('Loading draft…', (signal) => refresh(id, signal));
  }
  async function update(catalog: Catalog, baseSequence: number | null) {
    if (!detail) return;
    await perform('Saving draft…', async (signal) => {
      await api.update(
        detail.draft.id,
        {
          catalog,
          baseSequence,
          sourceDocumentIds: detail.draft.source_document_ids,
          expectedRevision: detail.draft.revision,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted) setNotice('Draft saved. Review this new revision before publishing.');
    });
  }
  async function capture(sourceKey: string, body: string) {
    if (!detail) return;
    const source = detail.draft.catalog.sources.find((value) => value.id === sourceKey);
    if (!source) return;
    await perform('Capturing evidence…', async (signal) => {
      const doc = await api.capture(
        { sourceKey, title: source.title, url: source.url, checkedOn: source.checkedOn, body },
        signal,
      );
      const sourceDocumentIds = [
        ...detail.sources.filter((value) => value.source_key !== sourceKey).map((value) => value.id),
        doc.id,
      ];
      await api.update(
        detail.draft.id,
        {
          catalog: detail.draft.catalog,
          baseSequence: detail.draft.base_sequence,
          sourceDocumentIds,
          expectedRevision: detail.draft.revision,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted) setNotice('Evidence captured and attached to a new draft revision.');
    });
  }
  async function publish(note: string) {
    if (!detail) return;
    await perform('Publishing reviewed terms…', async (signal) => {
      const release = await api.publish(
        detail.draft.id,
        {
          expectedRevision: detail.draft.revision,
          expectedHash: detail.draft.catalog_hash,
          expectedHead: detail.head,
          reviewNote: note,
        },
        signal,
      );
      await refresh(detail.draft.id, signal);
      if (!signal.aborted)
        setNotice(
          `Published ${release.version} as release ${release.sequence}. Extensions can now request these reviewed terms.`,
        );
    });
  }

  return (
    <main id="main" className="workspace" aria-busy={busy}>
      <aside className="queue">
        <div className="section-top">
          <h2>Pending drafts</h2>
          <button className="quiet" onClick={() => load(detail?.draft.id)} disabled={busy}>
            Reload
          </button>
        </div>
        {queue && (
          <p className="muted small">
            {queue.drafts.length} awaiting review ·{' '}
            {queue.head === null ? 'No published release' : `Published release ${queue.head}`}
          </p>
        )}
        <nav aria-label="Pending drafts">
          <ul>
            {queue?.drafts.map((draft) => (
              <li key={draft.id}>
                <button
                  disabled={busy}
                  aria-current={detail?.draft.id === draft.id ? 'page' : undefined}
                  onClick={() => load(draft.id)}
                >
                  <strong>{draft.version}</strong>
                  <span>Revision {draft.revision}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {queue?.drafts.length === 0 && (
          <p>No pending drafts. New candidates appear here when they are saved for review.</p>
        )}
        <p className="muted small queue-note">
          Only the latest 30 pending drafts are shown. Opening a draft does not approve it.
        </p>
      </aside>
      <section className="review-content" aria-label="Selected draft">
        {pending && (
          <p className="status" role="status">
            {pending}
          </p>
        )}
        {error && (
          <div className="alert error" role="alert">
            <p>{error}</p>
            <button disabled={busy} onClick={() => load(detail?.draft.id)}>
              Reload latest draft
            </button>
          </div>
        )}
        {notice && (
          <p className="alert success" role="status">
            {notice}
          </p>
        )}
        {detail ? (
          <>
            <div className="draft-heading">
              <h1 ref={heading} tabIndex={-1}>
                {detail.draft.catalog.version}
              </h1>
              <span className="status-label">
                {detail.draft.status === 'draft' ? 'Awaiting approval' : 'Published'}
              </span>
            </div>
            <p className="muted">
              Revision {detail.draft.revision} · {detail.draft.catalog.cards.length} card{' '}
              {detail.draft.catalog.cards.length === 1 ? 'product' : 'products'} ·{' '}
              {detail.draft.catalog.sources.length}{' '}
              {detail.draft.catalog.sources.length === 1 ? 'source' : 'sources'}
            </p>
            {detail.draft.catalog.schemaVersion === 2 ? (
              <p className="muted">
                This draft uses catalog schema 2. The v1 extraction panel applies only to schema 1 drafts.
              </p>
            ) : (
              <ExtractionPanel
                key={detail.draft.id}
                api={api}
                detail={detail}
                busy={busy}
                dirty={dirty}
                perform={perform}
                onApplied={async (signal) => {
                  await refresh(detail.draft.id, signal);
                  if (!signal.aborted)
                    setNotice(
                      'Extraction review recorded in a new draft revision. Review the complete draft and give fresh approval before publishing.',
                    );
                }}
              />
            )}
            <DraftPanel
              key={`${detail.draft.id}:${generation}`}
              detail={detail}
              busy={busy}
              onDirty={setDirty}
              onUpdate={update}
              onCapture={capture}
              onPublish={publish}
            />
          </>
        ) : (
          !busy && (
            <div className="empty">
              <h1>Select a draft to review.</h1>
              <p>
                Compare its changes with the published catalog and inspect the captured issuer text before
                approving.
              </p>
            </div>
          )
        )}
      </section>
    </main>
  );
}

export function DraftPanel({
  detail,
  busy,
  onDirty,
  onUpdate,
  onCapture,
  onPublish,
}: {
  detail: ReviewDetail;
  busy: boolean;
  onDirty: (value: boolean) => void;
  onUpdate: (catalog: Catalog, baseSequence: number | null) => Promise<void>;
  onCapture: (sourceKey: string, body: string) => Promise<void>;
  onPublish: (note: string) => Promise<void>;
}) {
  const original = JSON.stringify(detail.draft.catalog, null, 2);
  const [edited, setEdited] = useState(original),
    [body, setBody] = useState('');
  const [sourceKey, setSourceKey] = useState(detail.draft.catalog.sources[0]?.id ?? '');
  const [confirmed, setConfirmed] = useState(false),
    [note, setNote] = useState(''),
    [inputError, setInputError] = useState('');
  const [now, setNow] = useState(Date.now);
  const dirty = edited !== original || body.length > 0,
    editable = detail.draft.status === 'draft';
  const issues = publicationIssues(detail, now),
    changes = catalogChanges(detail.published?.catalog ?? null, detail.draft.catalog);
  if (dirty) issues.push('Save or discard your edits before approving this revision.');
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  async function save(event: React.FormEvent) {
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
  return (
    <>
      {detail.draft.status === 'draft' && issues.length > 0 && (
        <div className="alert warning">
          <h2>Before you publish</h2>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {detail.draft.base_sequence !== detail.head && (
            <button
              disabled={busy || dirty}
              onClick={() => {
                setConfirmed(false);
                void onUpdate(detail.draft.catalog, detail.head);
              }}
            >
              Rebase draft for review
            </button>
          )}
        </div>
      )}
      <div className="review-columns">
        <section className="changes">
          <h2>What changes</h2>
          <p className="muted small">
            {detail.published
              ? `Compared with ${detail.published.version}.`
              : 'This is the first published catalog; every field is new.'}{' '}
            Review all conditions, including fields that stay the same.
          </p>
          {detail.published && Date.parse(detail.published.catalog.expiresAt) <= now && (
            <p className="alert warning">
              The published terms expired. They are shown here for comparison only.
            </p>
          )}
          {changes.length ? (
            <table>
              <caption className="sr-only">Published and proposed catalog changes</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Published</th>
                  <th scope="col">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.before}</td>
                    <td className="proposed">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No differences from the current published catalog.</p>
          )}
          <details className="full-data">
            <summary>All proposed card rules</summary>
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
          </details>
          <details className="full-data">
            <summary>Full draft data and approval identity</summary>
            <p className="small">
              Revision {detail.draft.revision}; reviewed against release {detail.head ?? 'none'}. Approval is
              bound to the complete payload shown below.
            </p>
            <code className="hash">{detail.draft.catalog_hash}</code>
            <pre>{original}</pre>
          </details>
        </section>
        <section className="evidence">
          <h2>Source evidence</h2>
          <p className="muted small">
            A capture records the source. Check the full issuer terms to confirm rates, eligibility, caps, and
            exclusions.
          </p>
          {detail.draft.catalog.sources.map((source, index) => {
            const doc = detail.sources.find((value) => value.source_key === source.id);
            const matches =
              doc &&
              doc.title === source.title &&
              doc.url === source.url &&
              doc.checked_on === source.checkedOn;
            return (
              <article className="source" key={source.id}>
                <h3>{source.title}</h3>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  Read source terms
                </a>
                <p className="small muted">
                  Checked {source.checkedOn} · {source.id}
                </p>
                <p className={matches ? 'source-status' : 'source-status missing'}>
                  {matches ? 'Matching evidence captured' : 'Matching evidence needed'}
                </p>
                {doc && (
                  <details open={index === 0}>
                    <summary>Captured text</summary>
                    <pre className="source-text">{doc.body}</pre>
                    <p className="small muted">Captured {new Date(doc.created_at).toLocaleString('en-US')}</p>
                  </details>
                )}
              </article>
            );
          })}
          {editable && (
            <details className="capture">
              <summary>Capture source evidence</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setConfirmed(false);
                  void onCapture(sourceKey, body);
                }}
              >
                <label htmlFor="source-choice">Source to capture</label>
                <select
                  id="source-choice"
                  value={sourceKey}
                  disabled={busy}
                  onChange={(event) => {
                    if (body && !window.confirm('Discard the pasted text and choose another source?')) return;
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
                </select>
                <label htmlFor="source-body">Text from the source</label>
                <textarea
                  id="source-body"
                  rows={9}
                  required
                  maxLength={60000}
                  value={body}
                  disabled={busy}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setConfirmed(false);
                  }}
                  aria-describedby="source-help"
                />
                <p id="source-help" className="muted small">
                  Paste the terms you checked on the date recorded above. Capture preserves that date; it does
                  not refresh expired terms. Maximum 60,000 characters.
                </p>
                <button disabled={busy || !body.trim() || edited !== original}>
                  Capture and attach evidence
                </button>
              </form>
            </details>
          )}
        </section>
      </div>
      {editable && (
        <>
          <details className="editor">
            <summary>Correct draft data</summary>
            <p>
              Update the proposed catalog, then save a new revision. Keep only supported rules and exact
              source references. Dates must reflect a real review of the terms.
            </p>
            <form onSubmit={(event) => void save(event)}>
              <label htmlFor="catalog-json">Catalog JSON</label>
              <textarea
                id="catalog-json"
                className="code-input"
                rows={16}
                value={edited}
                disabled={busy}
                onChange={(event) => {
                  setEdited(event.target.value);
                  setConfirmed(false);
                }}
              />
              {inputError && (
                <p className="alert error" role="alert">
                  {inputError}
                </p>
              )}
              <div className="actions">
                <button disabled={busy || edited === original || !!body}>Save draft revision</button>
                <button type="button" className="quiet" disabled={busy || !dirty} onClick={discard}>
                  Discard edits
                </button>
              </div>
            </form>
          </details>
          {body && (
            <button className="quiet" disabled={busy} onClick={discard}>
              Discard unsaved source text
            </button>
          )}
          <section className="approval">
            <h2>Approve this revision</h2>
            <p>
              Publishing makes these rules available to every extension using this catalog. Confirm the
              complete draft and its sources before continuing.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !confirmed || issues.length > 0 || note.trim().length < 10) return;
                setConfirmed(false);
                void onPublish(note.trim());
              }}
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || issues.length > 0}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>I checked the full source terms and all proposed rules and conditions.</span>
              </label>
              <label htmlFor="review-note">Review note</label>
              <textarea
                id="review-note"
                rows={3}
                minLength={10}
                maxLength={2000}
                required
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Record what you checked and any deliberate limitations."
              />
              <div className="approval-bottom">
                <p className="small muted">
                  Approving {detail.draft.catalog.version}, revision {detail.draft.revision}.
                </p>
                <button
                  className="primary"
                  disabled={busy || !confirmed || issues.length > 0 || note.trim().length < 10}
                >
                  Publish reviewed terms
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
