import { useEffect, useRef, useState } from 'react';
import { draftIdSchema, type ReviewDetail, type StartExtractionInput } from '@ai-checkout/catalog-review';
import { applyExtractionInputSchema, type ApplyExtractionInput, type Extraction, type ExtractionList, type ExtractionReview } from '@ai-checkout/catalog-review/curation';
import { ReviewApiError, type ReviewApi } from './client';
import { catalogChanges } from './comparison';

type Perform = (label: string, action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
const outcomes: Record<string, string> = { evidence_valid: 'Evidence checks passed; human review required', needs_review: 'Unresolved facts or conditions',
  refused: 'Provider declined extraction', invalid_output: 'Invalid provider output', output_limit: 'Output exceeded a limit', provider_error: 'Provider failed',
  cancelled: 'Run cancelled', timeout: 'Run timed out', budget_blocked: 'Budget blocked this run', input_limit: 'Input exceeded a limit', invalid_input: 'Input rejected' };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
export default function ExtractionPanel({ api, detail, busy, dirty, perform, onApplied }: {
  api: ReviewApi; detail: ReviewDetail; busy: boolean; dirty: boolean; perform: Perform; onApplied: (signal: AbortSignal) => Promise<void>;
}) {
  const cards = detail.draft.catalog.cards.filter(card => ['capital-one-quicksilver', 'amex-blue-cash-everyday'].includes(card.id));
  const [cardId, setCardId] = useState(cards[0]?.id ?? ''), [runs, setRuns] = useState<ExtractionList['runs']>([]);
  const [review, setReview] = useState<ExtractionReview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState<StartExtractionInput | null>(null);
  const generation = useRef(0);
  const draftId = detail.draft.id;
  function remember(runId: string) { history.replaceState(null, '', `#draft=${draftId}&run=${runId}`); }
  useEffect(() => {
    const controller = new AbortController(), revision = ++generation.current;
    setLoading(true); setReview(null); setError('');
    void (async () => {
      try {
        const list = await api.extractions(draftId, controller.signal);
        const selected = draftIdSchema.safeParse(new URLSearchParams(location.hash.slice(1)).get('run'));
        const runId = selected.success ? selected.data : list.runs[0]?.id;
        const value = runId ? await api.extraction(draftId, runId, controller.signal) : null;
        if (!controller.signal.aborted && generation.current === revision) { setRuns(list.runs); setReview(value); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Saved extractions could not be loaded.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [api, draftId, detail.draft.revision]);
  async function inspect(runId: string, signal: AbortSignal) {
    const value = await api.extraction(draftId, runId, signal);
    if (!signal.aborted) { setReview(value); remember(runId); if (retry?.requestKey === value.run.request_key) setRetry(null); }
  }
  async function reload(signal: AbortSignal) {
    const list = await api.extractions(draftId, signal);
    if (signal.aborted) return;
    setRuns(list.runs); setError('');
    const runId = review?.run.id ?? list.runs[0]?.id;
    if (runId) await inspect(runId, signal);
  }
  function start(request?: StartExtractionInput) {
    const next = request ?? { cardId: cardId as StartExtractionInput['cardId'], expectedRevision: detail.draft.revision, requestKey: crypto.randomUUID() };
    if (busy || dirty || detail.draft.status !== 'draft') return;
    setRetry(next); setError('');
    void perform('Extracting captured terms…', async signal => {
      try {
        const result = await api.extract(draftId, next, signal);
        if (!signal.aborted) {
          remember(result.run.id); setRetry(null); await inspect(result.run.id, signal);
          const list = await api.extractions(draftId, signal); if (!signal.aborted) setRuns(list.runs);
        }
      } catch (failure) {
        if (!signal.aborted && failure instanceof ReviewApiError && failure.runId) { remember(failure.runId); await inspect(failure.runId, signal); }
        throw failure;
      }
    });
  }
  if (!cards.length) return null;
  return <section className="extraction" aria-labelledby="extraction-heading">
    <div className="section-top"><h2 id="extraction-heading">Extract from captured terms</h2><button className="quiet" disabled={busy || loading} onClick={() => void perform('Refreshing saved extractions…', reload)}>Refresh runs</button></div>
    <p className="small muted">Extract one card from this saved revision. Captured issuer text is sent to the configured provider when enabled. Check every fact and condition before applying a change; publication requires a separate review.</p>
    {detail.draft.status === 'draft' && <div className="extraction-controls"><div><label htmlFor="extraction-card">Card to extract</label>
      <select id="extraction-card" value={cardId} disabled={busy || !!retry} onChange={event => setCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></div>
      <button disabled={busy || dirty || !!retry || !cardId} onClick={() => start()}>Extract captured terms</button>
    </div>}
    {dirty && <p className="small muted">Save or discard your draft/source edits before extracting or applying a result.</p>}
    {retry && <div className="alert warning"><p>A request is awaiting confirmation. Refresh saved runs, or retry this same request identity to recover it without a duplicate call.</p>
      {retry.expectedRevision === detail.draft.revision ? <button disabled={busy || dirty} onClick={() => start(retry)}>Retry same extraction request</button> : <p>The draft changed. Recover the original run from the saved list before starting another.</p>}
      <code className="hash">Request: {retry.requestKey}</code>
    </div>}
    {loading && <p role="status" className="status">Loading saved extractions…</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {!loading && !runs.length && <p className="small muted">No saved extractions for this draft yet. Source capture and manual review are available below.</p>}
    {!!runs.length && <><label htmlFor="extraction-run">Saved extraction</label><select id="extraction-run" value={review?.run.id ?? ''} disabled={busy || loading}
      onChange={event => void perform('Loading extraction…', signal => inspect(event.target.value, signal))}>
      {!review && <option value="">Choose a run</option>}{runs.map(run => <option key={run.id} value={run.id}>{new Date(run.started_at).toLocaleString('en-US')} · revision {run.revision} · {run.outcome ? outcomes[run.outcome] ?? run.outcome : run.state}</option>)}
    </select><p className="small muted">Latest 20 runs. Refresh reads stored results; it does not invoke a model.</p></>}
    {review && <ExtractionResult key={`${review.run.id}:${detail.draft.revision}`} review={review} detail={detail} disabled={busy || dirty}
      onApply={input => perform('Applying reviewed extraction…', async signal => {
        await api.applyExtraction(draftId, review.run.id, input, signal); await onApplied(signal);
      })} />}
  </section>;
}

function Evidence({ evidence, documents }: { evidence: Extraction['conditions'][number]['evidence']; documents: ExtractionReview['documents'] }) {
  if (!evidence.length) return <p className="small muted">No cited evidence.</p>;
  return <div className="citations">{evidence.map((cite, i) => {
    const doc = documents.find(doc => doc.id === cite.documentId);
    const matches = doc?.content_hash === cite.contentHash && cite.end > cite.start && doc.body.slice(cite.start, cite.end) === cite.quote;
    return <div key={i}><blockquote>{cite.quote}</blockquote><p className="small muted">{doc?.source_key ?? 'Unknown source'} · {matches ? `Exact source span ${cite.start}–${cite.end}` : 'Citation does not match the saved source'}</p></div>;
  })}</div>;
}
export function ExtractionResult({ review, detail, disabled, onApply }: { review: ExtractionReview; detail: ReviewDetail; disabled: boolean;
  onApply: (input: ApplyExtractionInput) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false), [note, setNote] = useState('');
  const [decisions, setDecisions] = useState<Record<number, { coverage: string; ruleIds: string[]; note: string }>>({});
  const { run } = review, output = run.trace?.extraction;
  const usable = !!review.proposedCatalog && review.blockers.length === 0;
  const candidate = applyExtractionInputSchema.safeParse({ expectedRevision: detail.draft.revision, expectedHash: detail.draft.catalog_hash,
    reviewNote: note, conditionReviews: output?.conditions.map((_, index) => ({ index, ...decisions[index] })) ?? [] });
  const remaining: string[] = [];
  output?.conditions.forEach((_, index) => {
    const decision = decisions[index], label = `Condition ${index + 1}`;
    if (decision?.coverage !== 'existing-rules') remaining.push(decision?.coverage === 'unrepresentable' ?
      `${label} is not representable. Do not apply this extraction.` : `${label}: choose how it is covered.`);
    else {
      if (!decision.ruleIds.length) remaining.push(`${label}: select at least one covering rule.`);
      if (decision.note.trim().length < 10) remaining.push(`${label}: explain the coverage in at least 10 characters.`);
    }
  });
  if (note.trim().length < 10) remaining.push('Add an extraction review note of at least 10 characters.');
  if (!remaining.length && !confirmed) remaining.push('Confirm that you checked every fact, quote, and condition.');
  const changes = review.proposedCatalog ? catalogChanges(detail.draft.catalog, review.proposedCatalog) : [];
  function decide(index: number, change: Partial<{ coverage: string; ruleIds: string[]; note: string }>) {
    setDecisions(previous => ({ ...previous, [index]: { ...(previous[index] ?? { coverage: '', ruleIds: [], note: '' }), ...change } })); setConfirmed(false);
  }
  return <div className="extraction-result">
    <h3>{detail.draft.catalog.cards.find(card => card.id === run.card_id)?.name ?? run.card_id}</h3>
    <p className={`source-status${run.trace?.status === 'evidence_valid' ? '' : ' missing'}`}>{run.trace ? outcomes[run.trace.status] ?? run.trace.status : run.state === 'running' ? 'Run is recorded as running' : 'Run interrupted'}</p>
    {run.profile.mode === 'fixture' && <p className="alert warning">Scripted test result. No model was called.</p>}
    <p className="small muted">{run.profile.provider} · {run.profile.model} · {new Date(run.started_at).toLocaleString('en-US')}</p>
    <code className="hash">Run {run.id}</code>
    {!!review.blockers.length && <div className="alert warning"><ul>{review.blockers.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {run.state === 'running' && <p className="small">An overdue run needs operator recovery. Refreshing this page does not restart it or release its reservation.</p>}
    {review.application && <details className="full-data"><summary>Recorded application review</summary><p>Applied to revision {review.application.to_revision} on {new Date(review.application.applied_at).toLocaleString('en-US')}.</p>
      <p>{review.application.review_note}</p>{review.application.condition_reviews.map(value => <p key={value.index}>Condition {value.index + 1} → {value.ruleIds.join(', ')}: {value.note}</p>)}</details>}
    {output && <>
      {output.rules.map(rule => <article className="extracted-rule" key={rule.ruleId}><h3>{rule.ruleId}</h3>
        <dl className="extracted-facts">{(['rateBps', 'category', 'activation', 'cap'] as const).map(field => {
          const claim = rule[field], label = { rateBps: 'Reward rate', category: 'Purchase category', activation: 'Activation', cap: 'Spend cap' }[field];
          const value = claim.state !== 'known' ? claim.state === 'conflicting' ? 'Conflicting terms' : 'Unknown' : field === 'cap' ?
            rule.cap.kind === 'none' ? 'No annual spending cap' : `${money(rule.cap.amountCents!)} per calendar year` : field === 'rateBps' ? `${rule.rateBps.value! / 100}%` :
              field === 'activation' ? rule.activation.value ? 'Required' : 'Not required' : rule.category.value === 'all-eligible' ? 'All eligible purchases' : 'US online retail';
          return <div key={field}><dt>{label}</dt><dd><strong>{value}</strong><Evidence evidence={claim.evidence} documents={review.documents} /></dd></div>;
        })}</dl>
      </article>)}
      {output.issues.length > 0 && <section><h3>Issues requiring correction</h3>{output.issues.map((issue, i) => <article key={i}><p><strong>{issue.code} · {issue.field}</strong></p><p>{issue.detail}</p><Evidence evidence={issue.evidence} documents={review.documents} /></article>)}</section>}
      <section className="condition-review"><h3>Conditions and exclusions</h3><p className="small">Keep every condition in view. If a condition needs behavior the current rules cannot express, leave it unresolved and correct the source or maintain the draft manually.</p>
        {!output.conditions.length && <p>No conditions were extracted. Check the complete sources for omissions.</p>}
        {output.conditions.map((condition, index) => <article key={index}><h3>Condition {index + 1} · {condition.kind}</h3><p>{condition.text}</p><Evidence evidence={condition.evidence} documents={review.documents} />
          {usable && <><label htmlFor={`condition-${index}`}>How is condition {index + 1} covered?</label><select id={`condition-${index}`} disabled={disabled} value={decisions[index]?.coverage ?? ''} onChange={event => decide(index, { coverage: event.target.value })}>
            <option value="">Choose after reviewing the source</option><option value="existing-rules">Covered by existing rules</option><option value="unrepresentable">Not representable — do not apply</option>
          </select>{decisions[index]?.coverage === 'existing-rules' && <><fieldset disabled={disabled}><legend>Rules covering condition {index + 1}</legend>{output.rules.map(rule => <label className="check" key={rule.ruleId}><input type="checkbox" checked={decisions[index]?.ruleIds.includes(rule.ruleId) ?? false}
            onChange={event => decide(index, { ruleIds: event.target.checked ? [...decisions[index].ruleIds, rule.ruleId] : decisions[index].ruleIds.filter(id => id !== rule.ruleId) })} /><span>{rule.ruleId}</span></label>)}</fieldset>
            <label htmlFor={`condition-note-${index}`}>Why these rules cover condition {index + 1}</label><textarea id={`condition-note-${index}`} aria-describedby={`condition-help-${index}`} disabled={disabled} rows={2} minLength={10} maxLength={1200} value={decisions[index]?.note ?? ''} onChange={event => decide(index, { note: event.target.value })} />
            <p id={`condition-help-${index}`} className="small muted">Required: at least 10 characters explaining how the selected rules cover this condition.</p></>}
          </>}
        </article>)}
      </section>
    </>}
    {!!run.trace?.findings.length && <details className="full-data"><summary>Validation findings ({run.trace.findings.length})</summary><ul>{run.trace.findings.map((finding, i) => <li key={i}>{finding.code} · {finding.path}</li>)}</ul></details>}
    <details className="full-data"><summary>Full sources used by this run</summary>{review.documents.map(doc => <article key={doc.id}><h3>{doc.source_key}</h3><p className="small">Captured date {doc.checked_on} · <a href={doc.url} target="_blank" rel="noreferrer noopener">Open source URL</a></p><pre className="source-text">{doc.body}</pre></article>)}</details>
    <details className="full-data"><summary>Run provenance and accounting</summary><pre>{JSON.stringify({ id: run.id, profile: run.profile, contextHash: run.context.hash, versions: run.context.versions,
      reservedMicrousd: run.reserved_microusd, accountedMicrousd: run.trace?.accountedMicrousd, durationMs: run.trace?.durationMs,
      attempts: run.trace?.attempts.map(attempt => ({ number: attempt.number, outcome: attempt.outcome, usage: attempt.usage, durationMs: attempt.durationMs,
        accountedMicrousd: attempt.accountedMicrousd, providerResponse: attempt.providerResponse })) }, null, 2)}</pre><p className="small muted">Recorded token/cost values are accounting, not independently verified provider billing. Exact citations do not establish semantic correctness.</p></details>
    {usable && <form className="apply-extraction" onSubmit={event => { event.preventDefault(); if (!disabled && confirmed && candidate.success) { setConfirmed(false); void onApply(candidate.data); } }}>
      <h3>Proposed draft change</h3>{changes.length ? <table><caption className="sr-only">Current draft and extracted proposal</caption><thead><tr><th>Field</th><th>Current draft</th><th>After applying</th></tr></thead><tbody>{changes.map(change => <tr key={change.key}><th scope="row">{change.label}</th><td>{change.before}</td><td className="proposed">{change.after}</td></tr>)}</tbody></table> : <p>The extracted fields match the draft. Applying records this review as a new revision.</p>}
      {remaining.length > 0 && <div className="alert warning" id="apply-requirements"><h3>Before you apply</h3><ul>{remaining.map(value => <li key={value}>{value}</li>)}</ul></div>}
      <label className="check"><input type="checkbox" aria-describedby={remaining.length ? 'apply-requirements' : undefined} checked={confirmed} disabled={disabled || !candidate.success} onChange={event => setConfirmed(event.target.checked)} /><span>I checked every extracted fact and source quote, and the selected rules fully cover every condition.</span></label>
      <label htmlFor="extraction-note">Extraction review note</label><textarea id="extraction-note" aria-describedby="extraction-note-help" disabled={disabled} rows={3} minLength={10} maxLength={2000} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} />
      <p id="extraction-note-help" className="small muted">Required: at least 10 characters recording what you checked in the facts and sources.</p>
      <p className="small muted">Applying creates a new draft revision and records these decisions. Review that revision separately before publishing. Dates, catalog scope, and other cards stay as recorded in this draft.</p>
      <button aria-describedby={remaining.length ? 'apply-requirements' : undefined} disabled={disabled || !confirmed || !candidate.success}>Apply reviewed extraction to draft</button>
    </form>}
  </div>;
}
