// The badge inside its iframe: a compact pill that expands into a panel. Everything with card data
// renders here, in the extension's own origin; the merchant page only ever sees the frame.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertInline, Button, Field, Icon, Select, TextInput } from '@ai-checkout/ui';
import { formatUsd, parseUsd } from '../domain';
import type { PaymentPath } from '../domain';
import { EstimateRow } from '../components/ComparisonResult';
import { amount, unavailableCopy } from '../components/estimates';
import { merchantName } from '../checkout/merchants';
import type { BadgeRequest, BadgeView } from './contracts';
import { badgeRequest, postToHost } from './client';

const PAYMENT_LABELS: Record<PaymentPath, string> = {
  card: 'Card entered at checkout',
  paypal: 'PayPal or another payment account',
  'digital-wallet': 'Digital wallet (Apple Pay, Google Pay)',
  bnpl: 'Buy now, pay later (Affirm, Klarna)',
};
const KIND_LABELS = { total: 'order total', 'estimated-total': 'estimated total', subtotal: 'subtotal' };

export default function BadgeApp() {
  const [view, setView] = useState<BadgeView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const apply = useCallback((request: BadgeRequest) => {
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

  // An order question and a just-recorded order open as a panel; nothing else opens by itself.
  const kind = view?.kind;
  useEffect(() => {
    if (kind === 'order' || kind === 'recorded') setExpanded(true);
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
  if (view.kind === 'ready') {
    const best = view.result.estimates.find((e) => e.cardId === view.result.preferredCardId)!;
    const name = view.catalog.cards.find((c) => c.id === best.cardId)?.shortName ?? best.cardId;
    pillText = `Use ${name} · ${amount(best)} back`;
    pillLabel = `AI Checkout: use ${name}, ${amount(best)} back on this cart. Show details`;
    pillAction = expand;
  } else if (view.kind === 'locked') {
    pillText = view.order ? 'Unlock to record this order' : 'Unlock to see your best card';
    pillLabel = `AI Checkout: ${pillText}. Opens AI Checkout`;
    pillAction = () => open('popup');
  } else if (view.kind === 'no-cards') {
    pillText = 'Pick your cards to see your best card';
    pillLabel = `AI Checkout: ${pillText}. Opens setup`;
    pillAction = () => open('onboarding');
  } else if (view.kind === 'damaged') {
    pillText = 'Open AI Checkout to fix saved data';
    pillLabel = `AI Checkout: ${pillText}`;
    pillAction = () => open('popup');
  } else if (view.kind === 'unreadable') {
    pillText = 'Can’t read this cart — enter the amount';
    pillLabel = `AI Checkout: ${pillText}. Show details`;
    pillAction = expand;
  } else if (view.kind === 'unavailable') {
    pillText = 'Card terms need attention';
    pillLabel = `AI Checkout: ${pillText}. Show details`;
    pillAction = expand;
  } else {
    pillText = 'Did you pay with your recommended card?';
    pillLabel = `AI Checkout: ${pillText} Show question`;
    pillAction = expand;
  }

  return (
    <div ref={root} className={expanded ? 'badge-root badge-root--panel' : 'badge-root'}>
      {expanded ? (
        <section className="badge-panel" aria-labelledby="badge-heading">
          <div className="badge-panel__header">
            <Icon name="shopping-cart" size={16} className="text-action" />
            <h2 id="badge-heading" ref={heading} tabIndex={-1} className="section-title">
              {view.kind === 'order'
                ? `Did you pay with ${view.cards.find((c) => c.id === view.recommendedCardId)?.name ?? 'the recommended card'}?`
                : view.kind === 'recorded'
                  ? 'Order recorded'
                  : 'Best card for this cart'}
            </h2>
            <Button
              size="small"
              color="tertiary"
              icon="x"
              isIconOnly
              onClick={view.kind === 'recorded' ? () => postToHost({ type: 'hide' }) : collapse}
            >
              {view.kind === 'recorded' ? 'Close' : 'Collapse'}
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
          {view.kind !== 'recorded' && (
            <div className="badge-panel__footer">
              <Button size="small" color="secondary" disabled={busy} onClick={() => close('badge:dismiss')}>
                Dismiss for this tab
              </Button>
              <Button
                size="small"
                color="tertiary"
                disabled={busy}
                onClick={() => close('badge:disable-site')}
              >
                Not on this site
              </Button>
            </div>
          )}
        </section>
      ) : (
        <button
          ref={pill}
          type="button"
          className="badge-pill"
          aria-label={pillLabel}
          aria-expanded={
            ['ready', 'unreadable', 'unavailable', 'order'].includes(view.kind) ? false : undefined
          }
          onClick={pillAction}
        >
          <Icon name={view.kind === 'locked' ? 'lock' : 'credit-card'} size={16} />
          <span>{pillText}</span>
        </button>
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
  apply: (request: BadgeRequest) => Promise<unknown>;
  open: (target: 'popup' | 'onboarding') => void;
}) {
  if (view.kind === 'ready' || view.kind === 'unreadable')
    return <ReadyBody view={view} busy={busy} apply={apply} />;
  if (view.kind === 'unavailable')
    return (
      <>
        <p>{unavailableCopy[view.result.reason]}</p>
        <Button size="small" onClick={() => open('popup')}>
          Open AI Checkout
        </Button>
      </>
    );
  if (view.kind === 'order') return <OrderBody view={view} busy={busy} apply={apply} />;
  if (view.kind === 'recorded')
    return (
      <p role="status">
        {view.extraCents !== null && view.baselineCardName
          ? `About ${formatUsd(Math.abs(view.extraCents))} ${view.extraCents >= 0 ? 'more' : 'less'} cash back than ${view.baselineCardName}, your default card (estimated). See all-time savings in AI Checkout.`
          : 'Saved to your order history in AI Checkout.'}
      </p>
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
  view: Extract<BadgeView, { kind: 'ready' | 'unreadable' }>;
  busy: boolean;
  apply: (request: BadgeRequest) => Promise<unknown>;
}) {
  const ready = view.kind === 'ready' ? view : null;
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
  return (
    <>
      <p className="supporting">
        {ready && ready.cartAmountCents !== null && !ready.amountEdited
          ? `Based on ${formatUsd(ready.cartAmountCents)} cart ${KIND_LABELS[ready.amountKind!]} at ${merchantName(view.merchantId)}.`
          : ready
            ? `Based on ${formatUsd(ready.amountCents)} you entered, at ${merchantName(view.merchantId)}.`
            : `This ${merchantName(view.merchantId)} cart can’t be read right now. Enter the amount to compare.`}
        {ready?.amountKind === 'subtotal' && !ready.amountEdited && ' Tax and shipping are not included.'}
      </p>
      <form
        className="badge-amount"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field id="badge-amount" label="Amount (USD)" error={inputError || undefined}>
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
      {ready && (
        <>
          <Field id="badge-payment" label="Payment method">
            {(control) => (
              <Select
                {...control}
                value={ready.paymentPath}
                disabled={busy}
                onChange={(event) =>
                  void apply({ type: 'badge:set-payment', paymentPath: event.target.value as PaymentPath })
                }
              >
                {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {ready.result.rankingMayChange && (
            <p className="supporting">
              Ranked by the cash back each card is sure to earn; another card may earn more once its
              conditions are confirmed.
            </p>
          )}
          <ol className="estimate-list badge-ranking" aria-label="Your cards, best first">
            {ready.result.estimates.map((estimate) => (
              <EstimateRow
                key={estimate.cardId}
                catalog={ready.catalog}
                estimate={estimate}
                amountCents={ready.amountCents}
              />
            ))}
          </ol>
          <p className="supporting">
            Estimates from the card terms in AI Checkout; statement rewards may differ. Nothing about this
            cart leaves your device.
          </p>
        </>
      )}
    </>
  );
}

function OrderBody({
  view,
  busy,
  apply,
}: {
  view: Extract<BadgeView, { kind: 'order' }>;
  busy: boolean;
  apply: (request: BadgeRequest) => Promise<unknown>;
}) {
  const [choosing, setChoosing] = useState(false);
  const others = view.cards.filter((card) => card.id !== view.recommendedCardId);
  const [cardId, setCardId] = useState(others[0]?.id ?? '');
  const answer = (choice: 'yes' | 'other' | 'unsure', card: string | null = null) =>
    void apply({ type: 'badge:answer-order', answer: choice, cardId: card });
  return (
    <>
      <p className="supporting">
        Your answer adds an estimate to your all-time cash back in AI Checkout. Only this page’s address was
        checked; nothing on it was read.
      </p>
      {choosing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (cardId) answer('other', cardId);
          }}
        >
          <Field id="badge-used-card" label="Card you paid with">
            {(control) => (
              <Select
                {...control}
                value={cardId}
                disabled={busy}
                onChange={(event) => setCardId(event.target.value)}
              >
                {others.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="badge-amount__actions">
            <Button type="submit" size="small" disabled={busy || !cardId}>
              Save
            </Button>
            <Button size="small" color="tertiary" disabled={busy} onClick={() => setChoosing(false)}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        <div className="badge-answers">
          <Button size="small" disabled={busy} onClick={() => answer('yes')}>
            Yes
          </Button>
          {others.length > 0 && (
            <Button size="small" color="secondary" disabled={busy} onClick={() => setChoosing(true)}>
              Another card
            </Button>
          )}
          <Button size="small" color="tertiary" disabled={busy} onClick={() => answer('unsure')}>
            Not sure
          </Button>
        </div>
      )}
    </>
  );
}
