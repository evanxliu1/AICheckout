// The badge inside its iframe: a compact pill that expands into a panel. Everything with card data
// renders here, in the extension's own origin; the merchant page only ever sees the frame.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertInline, Button, Field, Icon, Select, TextInput } from '@ai-checkout/ui';
import { formatUsd, parseUsd } from '../domain';
import type { PaymentPathV3 } from '../domain';
import { EstimateRow } from '../components/ComparisonResult';
import RatesResult from '../components/RatesResult';
import {
  CHECKING_TERMS_COPY,
  CHECKING_TERMS_TITLE,
  notAcceptedLines,
  PAYMENT_LABELS,
  pillReward,
  rankingNote,
  rateWording,
  rewardKind,
  rowEmphasis,
  unavailableCopy,
} from '../components/estimates';
import { merchantName, storeEvidence } from '../checkout/store-match';
import type { BadgeAction, BadgeView } from './contracts';
import { badgeRequest, postToHost } from './client';

const KIND_LABELS = { total: 'order total', 'estimated-total': 'estimated total', subtotal: 'subtotal' };

/** IntersectionObserver v2 (Chrome 74+): reports whether the element is visible and unobscured. */
function supportsVisibilityTracking() {
  return (
    typeof IntersectionObserverEntry !== 'undefined' && 'isVisible' in IntersectionObserverEntry.prototype
  );
}

export default function BadgeApp() {
  const [view, setView] = useState<BadgeView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** A click was ignored by the clickjacking guard; say so briefly. */
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!covered) return;
    const timer = window.setTimeout(() => setCovered(false), 4000);
    return () => window.clearTimeout(timer);
  }, [covered]);
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const apply = useCallback((request: BadgeAction) => {
    setBusy(true);
    return badgeRequest(request)
      .then((reply) => {
        if (reply.ok) {
          setError('');
          setView(reply.view);
        } else setError(reply.error);
        return reply;
      })
      .finally(() => setBusy(false));
  }, []);
  const load = useCallback(() => void apply({ type: 'badge:get' }), [apply]);

  useEffect(() => {
    load();
    const onMessage = (message: unknown) => {
      if ((message as { type?: unknown } | null)?.type === 'badge:changed') load();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Nothing opens the panel by itself; a hidden view hides the frame.
  const kind = view?.kind;
  useEffect(() => {
    if (kind === 'hidden') postToHost({ type: 'hide' });
  }, [kind]);

  // Tell the host page how big the frame should be (size only).
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const post = () => {
      const box = node.getBoundingClientRect();
      // Report the panel's natural height (its scrolling body at full length), not the height it
      // was clamped to, so the host can size the frame up to the window.
      const body = node.querySelector<HTMLElement>('.badge-panel__body');
      const height = body ? box.height - body.clientHeight + body.scrollHeight : box.height;
      postToHost({ type: 'size', width: box.width, height, expanded });
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(node);
    // Content inside the scrolling body (e.g. an opened disclosure) changes its natural height.
    const changes = new MutationObserver(post);
    changes.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, [expanded, view]);

  // Clickjacking guard (IntersectionObserver v2): pointer clicks count only while Chrome reports the
  // frame fully visible, unobscured and untransformed. Keyboard activation is unaffected.
  const unobscured = useRef<boolean>(!supportsVisibilityTracking());
  useEffect(() => {
    // The body is the frame's whole viewport: page elements over the frame, opacity or transforms
    // on it make it "not visible"; the panel scrolling inside does not.
    const node = document.body;
    if (!supportsVisibilityTracking()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1] as IntersectionObserverEntry & { isVisible?: boolean };
        unobscured.current = entry.isVisible === true;
      },
      { threshold: [0], trackVisibility: true, delay: 100 } as IntersectionObserverInit,
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [view?.kind, expanded]);
  const guard = (event: React.MouseEvent) => {
    // Collapse and close only hide the badge, so a covered frame (for example a site's floating chat
    // button over a tall panel) must not swallow them.
    if (event.target instanceof Element && event.target.closest('.badge-panel__close')) return;
    if (event.detail > 0 && !unobscured.current) {
      event.preventDefault();
      event.stopPropagation();
      setCovered(true);
    }
  };

  const collapse = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => pill.current?.focus());
  }, []);
  const expand = () => {
    setExpanded(true);
    requestAnimationFrame(() => heading.current?.focus());
  };
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, collapse]);

  if (!view || view.kind === 'hidden') return <div ref={root} className="badge-root" />;
  const close = (type: 'badge:dismiss' | 'badge:disable-site') =>
    void apply({ type }).then((reply) => reply.ok && postToHost({ type: 'hide' }));
  const open = (target: 'popup' | 'onboarding') => void apply({ type: 'badge:open', target });

  // Pill: always a button with the whole message in its accessible name.
  let pillText: string, pillLabel: string, pillAction: () => void;
  // The reward part of a ready pill, shown in the accent colour.
  let pillAmount: string | undefined;
  if (view.kind === 'ready') {
    const best = view.result.estimates.find((e) => e.cardId === view.result.preferredCardId)!;
    const name = view.catalog.cards.find((c) => c.id === best.cardId)?.shortName ?? best.cardId;
    pillAmount = pillReward(best, view.catalog);
    pillText = `Use ${name} · ${pillAmount}`;
    const basis = rewardKind(best, view.catalog) === 'points' ? best.unitValue?.basis : undefined;
    // The pill says "est." for a published estimate; the label spells it out.
    const valued =
      basis === 'override'
        ? ', at your value,'
        : basis && basis !== 'published-estimate'
          ? ', at the issuer’s value,'
          : '';
    pillLabel = `${pillText.replace(' · est. ', ' · estimated ')}${valued} on this cart (AI Checkout). Show details`;
    pillAction = expand;
  } else if (view.kind === 'locked') {
    pillText = 'Unlock to see your best card';
    pillLabel = `${pillText} (AI Checkout). Opens AI Checkout`;
    pillAction = () => open('popup');
  } else if (view.kind === 'no-cards') {
    pillText = 'Pick your cards to see your best card';
    pillLabel = `${pillText} (AI Checkout). Opens setup`;
    pillAction = () => open('onboarding');
  } else if (view.kind === 'damaged') {
    pillText = 'Open AI Checkout to fix saved data';
    pillLabel = `${pillText} (AI Checkout)`;
    pillAction = () => open('popup');
  } else if (view.kind === 'checking') {
    // Expired bundled terms with the first refresh in flight (Phase 15.4); `badge:changed` ends it.
    pillText = CHECKING_TERMS_TITLE;
    pillLabel = `${pillText} (AI Checkout). Show details`;
    pillAction = expand;
  } else if (view.kind === 'rates') {
    // The amount was not read: the best card and its rate, never a prompt (Phase 13c).
    const best = view.result.estimates.find((e) => e.cardId === view.result.preferredCardId)!;
    const name = view.catalog.cards.find((c) => c.id === best.cardId)?.shortName ?? best.cardId;
    pillAmount = rateWording(best, view.catalog);
    pillText = `Use ${name} · ${pillAmount}`;
    pillLabel = `${pillText.replace(' (est. ', ' (estimated ')} at this store (AI Checkout). The cart amount was not read. Show details`;
    pillAction = expand;
  } else {
    pillText = 'Card terms need attention';
    pillLabel = `${pillText} (AI Checkout). Show details`;
    pillAction = expand;
  }

  return (
    <div
      ref={root}
      className={expanded ? 'badge-root badge-root--panel' : 'badge-root'}
      onClickCapture={guard}
    >
      {/* Always present, so screen readers announce the text when it appears. */}
      <p className={covered ? 'badge-covered' : 'ac-visually-hidden'} role="status">
        {covered ? 'Click ignored: the badge was covered or hidden. Try again when it is fully visible.' : ''}
      </p>
      {expanded ? (
        <section className="badge-panel" aria-labelledby="badge-heading">
          <div className="badge-panel__header">
            <Icon name="shopping-cart" size={16} className="text-action" />
            <h2 id="badge-heading" ref={heading} tabIndex={-1} className="section-title">
              Best card for this cart
            </h2>
            <Button
              size="small"
              color="tertiary"
              icon="x"
              isIconOnly
              className="badge-panel__close"
              onClick={collapse}
            >
              Collapse
            </Button>
          </div>
          <div className="badge-panel__body space-y-3">
            {error && (
              <AlertInline color="critical" role="alert">
                {error}
              </AlertInline>
            )}
            <PanelBody view={view} busy={busy} apply={apply} open={open} />
          </div>
          <div className="badge-panel__footer">
            <Button size="small" color="secondary" disabled={busy} onClick={() => close('badge:dismiss')}>
              Dismiss for this tab
            </Button>
            <Button size="small" color="tertiary" disabled={busy} onClick={() => close('badge:disable-site')}>
              Not on this site
            </Button>
          </div>
        </section>
      ) : (
        <div className="badge-pill-row">
          <button
            ref={pill}
            type="button"
            className="badge-pill"
            aria-label={pillLabel}
            aria-expanded={
              ['ready', 'rates', 'unavailable', 'checking'].includes(view.kind) ? false : undefined
            }
            onClick={pillAction}
          >
            <Icon name={view.kind === 'locked' ? 'lock' : 'credit-card'} size={16} />
            <span>
              {pillAmount ? (
                <>
                  {pillText.slice(0, -pillAmount.length)}
                  <span className="badge-pill__amount">{pillAmount}</span>
                </>
              ) : (
                pillText
              )}
            </span>
          </button>
          {/* Phase 15.4: the no-cards pill shows at every https cart and expands nothing, so its per-tab
              dismiss sits beside it (comparisons have theirs in the panel footer). */}
          {view.kind === 'no-cards' && (
            <button
              type="button"
              className="badge-pill__dismiss"
              aria-label="Dismiss for this tab (AI Checkout)"
              disabled={busy}
              onClick={() => close('badge:dismiss')}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PanelBody({
  view,
  busy,
  apply,
  open,
}: {
  view: Exclude<BadgeView, { kind: 'hidden' }>;
  busy: boolean;
  apply: (request: BadgeAction) => Promise<unknown>;
  open: (target: 'popup' | 'onboarding') => void;
}) {
  if (view.kind === 'ready' || view.kind === 'rates')
    return <ReadyBody view={view} busy={busy} apply={apply} />;
  if (view.kind === 'unavailable' || view.kind === 'checking')
    return (
      <>
        <p>{view.kind === 'checking' ? CHECKING_TERMS_COPY : unavailableCopy[view.result.reason]}</p>
        <Button size="small" onClick={() => open('popup')}>
          Open AI Checkout
        </Button>
      </>
    );
  // locked / no-cards / damaged open the popup or setup from the pill; nothing to expand.
  return (
    <Button size="small" onClick={() => open(view.kind === 'no-cards' ? 'onboarding' : 'popup')}>
      Open AI Checkout
    </Button>
  );
}

function ReadyBody({
  view,
  busy,
  apply,
}: {
  view: Extract<BadgeView, { kind: 'ready' | 'rates' }>;
  busy: boolean;
  apply: (request: BadgeAction) => Promise<unknown>;
}) {
  const ready = view.kind === 'ready' ? view : null;
  const rates = view.kind === 'rates' ? view : null;
  const [draft, setDraft] = useState(ready ? (ready.amountCents / 100).toFixed(2) : '');
  const [inputError, setInputError] = useState('');
  useEffect(() => {
    if (ready) setDraft((ready.amountCents / 100).toFixed(2));
  }, [ready?.amountCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    const cents = parseUsd(draft);
    if (cents === null || cents <= 0) return setInputError('Enter an amount such as 49.99.');
    setInputError('');
    void apply({ type: 'badge:set-amount', amountCents: cents });
  };
  const evidence = storeEvidence(view.merchantId);
  return (
    <>
      {ready ? (
        <p className="supporting">
          {ready.cartAmountCents !== null && !ready.amountEdited
            ? `Based on ${formatUsd(ready.cartAmountCents)} cart ${KIND_LABELS[ready.amountKind!]} at ${merchantName(view.merchantId)}.`
            : `Based on ${formatUsd(ready.amountCents)} you entered, at ${merchantName(view.merchantId)}.`}
          {ready.amountKind === 'subtotal' && !ready.amountEdited && ' Tax and shipping are not included.'}
          {evidence && ` ${evidence}`}
        </p>
      ) : (
        <RatesResult catalog={rates!.catalog} result={rates!.result} merchantId={view.merchantId} />
      )}
      <form
        className="badge-amount"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          id="badge-amount"
          label={ready ? 'Amount (USD)' : 'Amount (USD, optional)'}
          helperText={ready ? undefined : 'Enter an amount only if you want a dollar estimate.'}
          error={inputError || undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              inputMode="decimal"
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </Field>
        <div className="badge-amount__actions">
          <Button type="submit" size="small" color="secondary" disabled={busy}>
            Update
          </Button>
          {ready?.amountEdited && ready.cartAmountCents !== null && (
            <Button
              size="small"
              color="tertiary"
              disabled={busy}
              onClick={() => void apply({ type: 'badge:set-amount', amountCents: null })}
            >
              Use cart amount
            </Button>
          )}
        </div>
      </form>
      <Field id="badge-payment" label="Payment method">
        {(control) => (
          <Select
            {...control}
            value={view.paymentPath}
            disabled={busy}
            onChange={(event) =>
              void apply({ type: 'badge:set-payment', paymentPath: event.target.value as PaymentPathV3 })
            }
          >
            {Object.entries(PAYMENT_LABELS)
              .filter(([value]) => value !== 'venmo' || view.catalog.schemaVersion === 3)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </Select>
        )}
      </Field>
      {ready && (
        <>
          {ready.result.rankingMayChange && (
            <p className="supporting">{rankingNote(ready.result, ready.catalog)}</p>
          )}
          <ol className="estimate-list badge-ranking" aria-label="Your cards, best first">
            {ready.result.estimates.map((estimate, i) => (
              <EstimateRow
                key={estimate.cardId}
                catalog={ready.catalog}
                estimate={estimate}
                amountCents={ready.amountCents}
                {...rowEmphasis(ready.result, i)}
              />
            ))}
          </ol>
          {notAcceptedLines(ready.result, ready.catalog).map((line) => (
            <p key={line} className="supporting">
              {line}
            </p>
          ))}
          <p className="supporting">
            Estimates from the card terms in AI Checkout; statement rewards may differ. Nothing about this
            cart leaves your device.
          </p>
        </>
      )}
    </>
  );
}
