import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import WalletEditor from '../components/WalletEditor';
import ComparisonResult from '../components/ComparisonResult';
import RatesResult from '../components/RatesResult';
import DataProtectionDetails from '../components/DataProtectionDetails';
import DeleteSavedData, { ReportsNotDeleted } from '../components/DeleteSavedData';
import type { DeleteOptions } from '../components/DeleteSavedData';
import BadgeSettings from '../components/BadgeSettings';
import ProtectionSettings from '../components/ProtectionSettings';
import TelemetrySettings from '../components/TelemetrySettings';
import SuggestStore from '../components/SuggestStore';
import ReportProblem from '../components/ReportProblem';
import { telemetryRequest } from '../state/telemetry-client';
import { REPORTS_NOT_DELETED_MESSAGE } from '../state/telemetry-contracts';
import type { PopupReadOutcome } from '../state/telemetry-contracts';
import {
  Disclosure,
  AlertInline,
  ApplicationState,
  Button,
  Card,
  Checkbox,
  Field,
  Link,
  Select,
  TextInput,
} from '@ai-checkout/ui';
import PopupHeader from '../components/PopupHeader';
import { CHECKING_TERMS_TITLE, PAYMENT_LABELS } from '../components/estimates';
import { unvaluedPrograms } from '../components/wallet-options';
import { GENERIC_MERCHANT_ID, catalogMerchantIds, formatUsd, parseUsd, usageInputs } from '../domain';
import type { Comparison, Eligibility, PaymentPathV3, Wallet } from '../domain';
import { RATES_READ_MESSAGES, READ_COPY } from '../checkout/read-copy';
import { checkoutRequest } from '../state/client';
import type { CheckoutResponse } from '../state/contracts';
import {
  localDate,
  CART_MAX_AGE_MS,
  CREDITS_URL,
  RESULT_MAX_AGE_MS,
  STATE_KEY,
  TELEMETRY_ENABLED,
} from '../state/keys';
import { emptyState } from '../state/contracts';
import {
  merchantName,
  releaseRecord,
  storeEvidence,
  storeForTab,
  storeProfile,
} from '../checkout/store-match';
import type { TabStore } from '../checkout/store-match';

type View = Extract<CheckoutResponse, { ok: true }>;
/** The store the popup always offers: any other U.S. online store. The tab's matched store (a merchant
 * release record) is offered by name while it is selected (since Phase 15.1 the only other option). */
const STORE_IDS: string[] = [GENERIC_MERCHANT_ID];

/** The store of the tab the popup was opened on (its URL is granted by `activeTab`), or null for a non-web
 * page, and whether the tab is an https page the popup reads on open (Phase 13c). A payment processor's
 * page (Phase 14.2) has no store: the popup keeps the saved one and says it cannot compare there. */
async function activeTabMerchant(): Promise<{
  store: TabStore | null;
  https: boolean;
  tabId: number | null;
}> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return {
      store: storeForTab(tab?.url),
      https: !!tab?.url && tab.url.startsWith('https://'),
      tabId: tab?.id ?? null,
    };
  } catch {
    return { store: null, https: false, tabId: null };
  }
}
/** Online retail eligibility for a newly chosen store: the generic store and a release record sell
 * physical goods online (their profiles, as the badge derives them); any other saved id asks the shopper. */
const storeOnlineRetail = (id: string): Eligibility =>
  id === GENERIC_MERCHANT_ID || releaseRecord(id) ? 'eligible' : 'unknown';
/** The dictionary's `popup_opened.read_outcome` for a read on open that did not fill an amount (Phase 15.3). */
const READ_OUTCOMES: Record<string, PopupReadOutcome> = {
  [READ_COPY.withheld]: 'withheld',
  [READ_COPY['not-a-cart']]: 'not-a-cart',
  [READ_COPY['empty-cart']]: 'empty',
  [READ_COPY['unsupported-currency']]: 'non-usd',
  [READ_COPY['unsupported-page']]: 'non-web',
  [READ_COPY['payment-page']]: 'payment-page',
};

export default function Popup({
  onLock,
  onDelete,
  vaultError,
  protection = 'off',
}: {
  onLock?: () => void;
  onDelete?: (options?: DeleteOptions) => void;
  vaultError?: string;
  /** Optional passphrase protection (off by default). */
  protection?: 'off' | 'on';
} = {}) {
  const [view, setView] = useState<View | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<'load' | 'read' | 'save' | 'compare' | 'delete' | 'catalog' | null>(
    null,
  );
  const busy = pending !== null;
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [merchantId, setMerchantId] = useState<string>(GENERIC_MERCHANT_ID);
  const [eligible, setEligible] = useState(false);
  const [onlineRetail, setOnlineRetail] = useState<Eligibility>('unknown');
  const [paymentPath, setPaymentPath] = useState<PaymentPathV3>('card');
  const [dirty, setDirty] = useState(false);
  const [cartId, setCartId] = useState<string | null>(null);
  /** The rates view: the cards ranked by rate when the read found a cart but no certain amount. */
  const [rates, setRates] = useState<{ merchantId: string; result: Comparison } | null>(null);
  /** The popup was opened on a payment processor's page (Phase 14.2): nothing is read or compared there. */
  const [paymentPage, setPaymentPage] = useState<string | null>(null);
  /** The tab the popup opened on (Phase 15.3): its id and store kind, for Suggest this store and Report a
   * problem; the worker resolves the tab's address itself from the id. */
  const [tab, setTab] = useState<{ id: number; kind: TabStore['kind'] } | null>(null);
  const resultAnchor = useRef<HTMLDivElement>(null);
  // The catalog in effect comes from the worker with every response; pages bundle none.
  const catalog = view?.catalog;
  // Spend-capped bonuses the shopper can report, derived from the catalog rules.
  const limitNotes = (view?.state.wallet.cards ?? []).flatMap((owned) => {
    const card = catalog?.cards.find((c) => c.id === owned.cardId);
    if (!catalog || !card) return [];
    return usageInputs(catalog, card.id)
      .filter((rule) => rule.needsSpend)
      .map((rule) => {
        const usage = owned.usage.find(
          (u) => u.ruleId === rule.ruleId && u.recordedOn === localDate(Date.now()),
        );
        return {
          key: rule.ruleId,
          text: `${card.shortName} ${rule.label} spend: ${
            usage?.spentCents != null
              ? `${formatUsd(usage.spentCents)} reported today. Edit if it changed.`
              : 'unknown. You can add it in Edit cards.'
          }`,
        };
      });
  });

  // Move to a result only right after the shopper compares, not when a saved result is restored.
  const justCompared = useRef(false);
  useEffect(() => {
    if (justCompared.current && !dirty && !editing && view?.comparison) {
      justCompared.current = false;
      resultAnchor.current?.focus({ preventScroll: true });
      resultAnchor.current?.scrollIntoView({ block: 'start' });
    }
  }, [dirty, editing, view?.comparison]);

  // The store of the tab the popup opened on, then the shopper's own pick from the select. Every
  // restore keeps it: it replaces the saved store unless a read cart is waiting to be compared.
  const store = useRef<string | null>(null);
  const restore = useCallback((next: View) => {
    const tabMerchant = store.current;
    setView(next);
    const cart = next.state.cart;
    const hasPendingCart = !!cart && !next.state.comparison;
    const saved = hasPendingCart
      ? cart.merchantId
      : (next.state.purchase?.merchantId ?? cart?.merchantId ?? GENERIC_MERCHANT_ID);
    const changed = !hasPendingCart && tabMerchant !== null && tabMerchant !== saved;
    setAmount(
      changed
        ? ''
        : hasPendingCart
          ? (cart.amountCents / 100).toFixed(2)
          : next.state.purchase
            ? (next.state.purchase.amountCents / 100).toFixed(2)
            : '',
    );
    setMerchantId(changed ? tabMerchant : saved);
    setCartId(changed ? null : (cart?.id ?? null));
    // Restored results are labeled saved; a new comparison requires renewed confirmation.
    setEligible(false);
    // No saved purchase: the store's own eligibility (the generic store and a release store start eligible).
    setOnlineRetail(
      changed
        ? storeOnlineRetail(tabMerchant)
        : (next.state.purchase?.onlineRetail ?? storeOnlineRetail(saved)),
    );
    // Venmo is offered only with catalog v3 terms.
    const path = next.state.purchase?.paymentPath ?? 'card';
    setPaymentPath(path === 'venmo' && next.catalog.schemaVersion !== 3 ? 'card' : path);
    // A saved result for another store is not shown as current (as when the select changes).
    setDirty(changed);
    setEditing(next.state.wallet.cards.length === 0);
  }, []);

  const load = useCallback(async () => {
    setError('');
    setPending('load');
    try {
      restore(await checkoutRequest({ type: 'checkout:get-state' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your saved inputs could not be loaded. Try again.');
    } finally {
      setPending(null);
    }
  }, [restore]);

  useEffect(() => {
    let cancelled = false;
    // Kept even when loading fails, so "Reload saved inputs" restores the tab's store too.
    const tab = activeTabMerchant().then((found) => {
      const id = found.store && found.store.kind !== 'processor' ? found.store.id : null;
      store.current = id;
      return { ...found, id };
    });
    void Promise.all([checkoutRequest({ type: 'checkout:get-state' }), tab])
      .then(async ([next, found]) => {
        if (cancelled) return;
        restore(next);
        if (found.store?.kind === 'processor') setPaymentPage(found.store.name);
        if (found.store && found.tabId !== null) setTab({ id: found.tabId, kind: found.store.kind });
        // An https store tab is read on open: a certain amount fills in, otherwise the rates view. A
        // cart read in this very tab, or a comparison saved for this matched store, is kept instead
        // (reopening the popup must not discard it); the generic id is every other store, so a saved
        // generic comparison never suppresses the read at another site. "Read cart amount" re-reads.
        const settled = next.state.cart
          ? next.state.cart.tabId === found.tabId
          : !!next.state.comparison &&
            found.id !== GENERIC_MERCHANT_ID &&
            next.state.purchase?.merchantId === found.id;
        // Phase 15.3: `popup_opened` with what the read on open found, when one happened or could not (a
        // payment page, a non-web tab); nothing when a read cart or saved comparison is kept.
        let outcome: PopupReadOutcome | null = null;
        if (found.https && found.id && next.state.wallet.cards.length && !settled)
          outcome = await readCart(true, next, found.id);
        else if (found.store?.kind === 'processor') outcome = 'payment-page';
        else if (!found.store && next.state.wallet.cards.length) outcome = 'non-web';
        if (TELEMETRY_ENABLED && outcome && !cancelled)
          void telemetryRequest({
            type: 'telemetry:popup-opened',
            tabId: found.tabId,
            readOutcome: outcome,
          }).catch(() => undefined);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Your saved inputs could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [restore]); // eslint-disable-line react-hooks/exhaustive-deps -- readCart reads the mounted state once

  useEffect(() => {
    // Only a ready result computed from the current inputs can go stale; an unavailable result
    // (e.g. expired terms) must stay visible even if an older saved comparison exists.
    if (
      view?.comparison?.status !== 'ready' ||
      !view.state.comparison ||
      view.state.comparison.inputRevision !== view.state.revision
    )
      return;
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const remaining =
      Math.min(
        view.state.comparison.computedAt + RESULT_MAX_AGE_MS,
        Date.parse(view.catalog.expiresAt),
        midnight.getTime(),
        view.state.comparison.cartId && view.state.cart
          ? view.state.cart.capturedAt + CART_MAX_AGE_MS
          : Infinity,
      ) - Date.now();
    const timer = window.setTimeout(
      () => {
        setView((current) =>
          current
            ? {
                ...current,
                comparison: null,
                notice: 'Confirm the current amount and compare again to refresh this estimate.',
              }
            : current,
        );
        setEligible(false);
      },
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[STATE_KEY]) return;
      const next = changes[STATE_KEY].newValue;
      if (next === undefined) {
        // Until the next response, the catalog shown is the one this page last received.
        if (view)
          restore({
            ok: true,
            state: emptyState(),
            catalog: view.catalog,
            cardIndex: view.cardIndex,
            comparison: null,
            notice: 'Local data deleted.',
            catalogUpdatesAvailable: view.catalogUpdatesAvailable,
            checkingTerms: false,
          });
      } else if (next.revision !== view?.state.revision) {
        setView((current) =>
          current
            ? {
                ...current,
                comparison: null,
                notice: 'Saved inputs changed. Reload them before comparing again.',
              }
            : current,
        );
        setEligible(false);
        setDirty(true);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [restore, view]);
  // Phase 15.4: the worker broadcasts `terms:checked` when a background refresh settles; while this popup
  // stands in for expired terms with "Checking…", reload so it shows the outcome (new terms, or the expiry).
  // The listener is attached from the first render and counts every broadcast; a view that says "Checking…"
  // after a broadcast it has not acted on reloads at once. Attached only once "Checking…" had rendered (as
  // before 2026-10-20), a broadcast landing before React ran that effect, or before the response that said
  // "Checking…" was rendered, was lost and the popup stayed on "Checking…" (a flaky first-run-copy test on CI).
  const [termsChecks, setTermsChecks] = useState(0);
  const broadcasts = useRef(0);
  const handled = useRef(0);
  const checking = view?.checkingTerms === true;
  useEffect(() => {
    if (!checking || broadcasts.current === handled.current) return;
    handled.current = broadcasts.current;
    void load();
  }, [checking, view, termsChecks, load]);
  useEffect(() => {
    const onMessage = (message: unknown) => {
      if ((message as { type?: unknown } | null)?.type !== 'terms:checked') return;
      broadcasts.current += 1;
      // A render that says "Checking…" acts on it through the effect above.
      setTermsChecks(broadcasts.current);
    };
    // Optional: unit tests stub `chrome.runtime` without it; extension pages always have it.
    chrome.runtime.onMessage?.addListener(onMessage);
    return () => chrome.runtime.onMessage?.removeListener(onMessage);
  }, []);

  /** The cards ranked by rate at `store` (read-only; nothing is stored). */
  async function loadRates(store: string, online: Eligibility) {
    const next = await checkoutRequest({
      type: 'checkout:rates',
      merchantId: store,
      onlineRetail: online,
      paymentPath,
    });
    if (next.comparison?.status === 'ready') setRates({ merchantId: store, result: next.comparison });
  }
  /** Reads the open tab. `auto` (on open): a found amount fills in, a cart whose amount was not read
   * shows the rates view, any other outcome changes nothing; the button shows every message. */
  async function readCart(
    auto = false,
    base: View | null = view,
    tabStore: string = merchantId,
  ): Promise<PopupReadOutcome | null> {
    if (!base) return null;
    setPending('read');
    setError('');
    if (!auto) {
      setDirty(true);
      setEligible(false);
    }
    try {
      const next = await checkoutRequest({
        type: 'checkout:read-cart',
        expectedRevision: base.state.revision,
      });
      setRates(null);
      setView(next);
      if (next.state.cart || !auto) {
        setDirty(true);
        setEligible(false);
        setCartId(next.state.cart?.id ?? null);
        setAmount(next.state.cart ? (next.state.cart.amountCents / 100).toFixed(2) : '');
        setOnlineRetail(next.state.cart ? storeOnlineRetail(next.state.cart.merchantId) : 'unknown');
      }
      if (next.state.cart) {
        setMerchantId(next.state.cart.merchantId);
        store.current = next.state.cart.merchantId;
      }
      return next.state.cart ? 'found' : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (RATES_READ_MESSAGES.includes(message)) {
        // A cart or checkout page with no certain amount: compare by rate, never ask for an amount.
        setCartId(null);
        setDirty(true);
        try {
          await loadRates(tabStore, storeOnlineRetail(tabStore));
        } catch {
          if (!auto) setError('Your cards could not be compared. Try again.');
        }
      } else if (!auto || message === READ_COPY['unsupported-currency'])
        setError(message || 'The cart could not be read. Read it again.');
      return READ_OUTCOMES[message] ?? null;
    } finally {
      setPending(null);
    }
  }

  const loadCards = (cardIds: string[]) =>
    checkoutRequest({ type: 'checkout:catalog-cards', cardIds }).then((next) => next.catalog);
  async function saveWallet(wallet: Wallet) {
    if (!view) return;
    setPending('save');
    setError('');
    try {
      const next = await checkoutRequest({
        type: 'checkout:save-wallet',
        wallet,
        expectedRevision: view.state.revision,
      });
      setView(next);
      setEditing(false);
      setDirty(true);
      setEligible(false);
    } finally {
      setPending(null);
    }
  }
  async function compare() {
    if (!view) return;
    setError('');
    const cents = parseUsd(amount);
    if (cents === null || cents <= 0) {
      setError('Enter a purchase amount from $0.01 to $100,000.00.');
      return;
    }
    if (!eligible) {
      setError('Confirm that the amount covers eligible purchases.');
      return;
    }
    setPending('compare');
    try {
      const next = await checkoutRequest({
        type: 'checkout:compare',
        expectedRevision: view.state.revision,
        cartId,
        purchase: {
          merchantId,
          currency: 'USD',
          amountCents: cents,
          purchasedOn: localDate(Date.now()),
          eligiblePurchase: 'eligible',
          onlineRetail,
          paymentPath,
        },
      });
      justCompared.current = true;
      setRates(null);
      setView(next);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The comparison could not be saved. Try again.');
    } finally {
      setPending(null);
    }
  }
  async function clear(options?: DeleteOptions) {
    setPending('delete');
    setError('');
    try {
      restore(await checkoutRequest({ type: 'checkout:clear', ...options }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local data could not be deleted. Try again.');
    } finally {
      setPending(null);
    }
  }
  async function refreshCatalog() {
    if (!view) return;
    setPending('catalog');
    setError('');
    try {
      restore(
        await checkoutRequest({ type: 'checkout:refresh-catalog', expectedRevision: view.state.revision }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Card terms could not be checked. Try again.');
    } finally {
      setPending(null);
    }
  }
  const cart = cartId ? view?.state.cart : null;
  // A saved store the release and the catalog no longer know is "this store", not "Unsupported merchant".
  const storeName = merchantName(merchantId);
  const storeLabel = storeName === 'Unsupported merchant' ? 'this store' : storeName;
  const evidence = storeEvidence(merchantId);
  const unvalued = view ? unvaluedPrograms(view.catalog, view.state.wallet) : [];
  /** Delete all local data: the gate's vault request when mounted under it, else the plain clear (Phase 15.5b:
   * both stop, nothing cleared, when the service could not delete the usage reports first). */
  const remove = (options?: DeleteOptions) => (onDelete ? onDelete(options) : void clear(options));
  const reportsNotDeleted =
    vaultError === REPORTS_NOT_DELETED_MESSAGE || error === REPORTS_NOT_DELETED_MESSAGE;
  const ownedNames = (view?.state.wallet.cards ?? [])
    .map((c) => catalog?.cards.find((p) => p.id === c.cardId)?.shortName ?? 'Unavailable card')
    .join(' · ');
  return (
    <ErrorBoundary>
      <main className="checkout-popup">
        <PopupHeader />
        <div className="p-4 space-y-4">
          {reportsNotDeleted ? (
            <ReportsNotDeleted busy={busy} onDelete={remove} />
          ) : (
            vaultError && (
              <AlertInline color="critical" role="alert">
                {vaultError}
              </AlertInline>
            )
          )}
          {error && !reportsNotDeleted && (
            <AlertInline
              color="critical"
              role="alert"
              actions={
                <Button size="small" color="secondary" disabled={busy} onClick={() => void load()}>
                  Reload saved inputs
                </Button>
              }
            >
              {error}
            </AlertInline>
          )}
          {!view && !error && <ApplicationState status="loading" titleTag="h2" title="Loading your cards…" />}
          {paymentPage && (
            <AlertInline role="status">
              {paymentPage} is a payment page, not the store’s. Cards can’t be compared here; open the store’s
              cart or checkout page, or pick the store below.
            </AlertInline>
          )}
          {view?.notice && (
            <AlertInline
              role="status"
              actions={
                <Button size="small" color="secondary" disabled={busy} onClick={() => void load()}>
                  Load saved inputs
                </Button>
              }
            >
              {view.notice}
            </AlertInline>
          )}
          {view &&
            (editing ? (
              <WalletEditor
                key={view.state.revision}
                catalog={view.catalog}
                index={view.cardIndex}
                loadCards={loadCards}
                wallet={view.state.wallet}
                busy={busy}
                onSave={saveWallet}
                onCancel={view.state.wallet.cards.length ? () => setEditing(false) : undefined}
              />
            ) : (
              <>
                <Card as="section" hasBorder aria-labelledby="saved-cards-heading">
                  <div className="card-body space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h2 id="saved-cards-heading" className="section-title">
                        Your cards
                      </h2>
                      <Button
                        size="small"
                        color="tertiary"
                        icon="credit-card"
                        disabled={busy}
                        onClick={() => {
                          setEditing(true);
                          setError('');
                        }}
                      >
                        Edit cards
                      </Button>
                    </div>
                    <p>{ownedNames || 'No cards selected.'}</p>
                    {unvalued.length > 0 && (
                      <p className="supporting">
                        No published value for {unvalued.map((p) => p.name).join(', ')}. Those cards show
                        points or miles only and are listed last until you set a value under Point values in
                        Edit cards.
                      </p>
                    )}
                    {limitNotes.map((note) => (
                      <p key={note.key} className="supporting">
                        {note.text}
                      </p>
                    ))}
                  </div>
                </Card>
                <Card as="section" hasBorder aria-labelledby="purchase-heading">
                  <div className="card-body space-y-4">
                    <h2 id="purchase-heading" className="section-title">
                      Your purchase
                    </h2>
                    <Field
                      id="purchase-merchant"
                      label="Merchant"
                      helperText="Chosen from the page you opened this on. Change it if it is wrong."
                    >
                      {(control) => (
                        <Select
                          {...control}
                          value={merchantId}
                          disabled={busy}
                          onChange={(e) => {
                            setMerchantId(e.target.value);
                            store.current = e.target.value;
                            setAmount('');
                            setCartId(null);
                            setRates(null);
                            setOnlineRetail(storeOnlineRetail(e.target.value));
                            setEligible(false);
                            setDirty(true);
                            setError('');
                          }}
                        >
                          {!STORE_IDS.includes(merchantId) && (
                            <option value={merchantId}>
                              {storeName === 'Unsupported merchant' ? 'Unsupported saved store' : storeName}
                            </option>
                          )}
                          {STORE_IDS.map((id) => (
                            <option key={id} value={id}>
                              {merchantName(id)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {evidence && <p className="supporting">{evidence}</p>}
                    {TELEMETRY_ENABLED && tab?.kind === 'generic' && merchantId === GENERIC_MERCHANT_ID && (
                      <SuggestStore tabId={tab.id} disabled={busy} />
                    )}
                    {!catalogMerchantIds(view.catalog).includes(merchantId) &&
                      !storeProfile(view.catalog, merchantId) && (
                        <AlertInline color="warning" role="status">
                          Your current card terms do not cover {storeLabel}. Check for updated terms or an
                          extension update.
                        </AlertInline>
                      )}
                    <Button
                      color="secondary"
                      icon="shopping-cart"
                      isLoading={pending === 'read'}
                      disabled={busy && pending !== 'read'}
                      onClick={() => void readCart()}
                    >
                      Read cart amount
                    </Button>
                    {cart && (
                      <AlertInline
                        color="highlight"
                        role="status"
                        actions={
                          <Button
                            size="small"
                            color="tertiary"
                            icon="arrow-right"
                            iconPosition="trailing"
                            disabled={busy}
                            onClick={() => {
                              setCartId(null);
                              setDirty(true);
                              setEligible(false);
                            }}
                          >
                            Use manual entry instead
                          </Button>
                        }
                      >
                        <p>
                          Read {formatUsd(cart.amountCents)} as{' '}
                          {cart.kind === 'estimated-total'
                            ? 'an estimated total'
                            : cart.kind === 'subtotal'
                              ? 'a subtotal before tax and shipping'
                              : 'the order total'}
                          . Confirm or correct the amount below. The page is checked again before comparing.
                        </p>
                        {cart.kind === 'subtotal' && (
                          <p className="mt-2">
                            The final charge is not known yet, so this compares the subtotal before tax and
                            shipping.
                          </p>
                        )}
                      </AlertInline>
                    )}
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void compare();
                      }}
                    >
                      <Field id="purchase-amount" label="Purchase amount (USD)">
                        {(control) => (
                          <TextInput
                            {...control}
                            inputMode="decimal"
                            maxLength={14}
                            value={amount}
                            disabled={busy}
                            placeholder="0.00"
                            onChange={(e) => {
                              setAmount(e.target.value);
                              setDirty(true);
                              setEligible(false);
                            }}
                          />
                        )}
                      </Field>
                      <Field
                        id="payment-path"
                        label="How you will pay"
                        helperText={`Paying through PayPal${view.catalog.schemaVersion === 3 ? ', Venmo' : ''}, a digital wallet or buy now, pay later can change which bonuses apply.`}
                      >
                        {(control) => (
                          <Select
                            {...control}
                            value={paymentPath}
                            disabled={busy}
                            onChange={(e) => {
                              setPaymentPath(e.target.value as PaymentPathV3);
                              setDirty(true);
                            }}
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
                      <Field
                        id="online-eligibility"
                        label="Online retail bonus eligibility"
                        helperText="The bonus applies to physical goods paid for online at a US retailer. Services, in-store payment and third-party installment plans are excluded. The merchant must report an internet transaction."
                      >
                        {(control) => (
                          <Select
                            {...control}
                            value={onlineRetail}
                            disabled={busy}
                            onChange={(e) => {
                              setOnlineRetail(e.target.value as Eligibility);
                              setDirty(true);
                            }}
                          >
                            <option value="unknown">I’m not sure</option>
                            <option value="eligible">Eligible goods, paid directly online</option>
                            <option value="ineligible">In-store payment or other excluded channel</option>
                          </Select>
                        )}
                      </Field>
                      <Checkbox
                        label="I confirmed the amount is for eligible purchases, excluding gift cards, cash equivalents, fees and rewards-covered amounts."
                        checked={eligible}
                        disabled={busy}
                        onChange={(e) => {
                          setEligible(e.target.checked);
                          setDirty(true);
                        }}
                      />
                      <Button
                        type="submit"
                        isFullWidth
                        isLoading={pending === 'compare'}
                        disabled={(busy && pending !== 'compare') || !view.state.wallet.cards.length}
                      >
                        Compare my cards
                      </Button>
                    </form>
                  </div>
                </Card>
                {rates && (
                  <Card as="section" hasBorder aria-labelledby="rates-heading">
                    <div className="card-body">
                      <RatesResult
                        catalog={view.catalog}
                        result={rates.result}
                        merchantId={rates.merchantId}
                        headingId="rates-heading"
                      />
                    </div>
                  </Card>
                )}
                {/* Always mounted, so screen readers announce a result when it appears. */}
                <div aria-live="polite">
                  {!dirty && view.comparison && (
                    <div
                      ref={resultAnchor}
                      tabIndex={-1}
                      {...(view.comparison.status === 'ready'
                        ? { role: 'region', 'aria-labelledby': 'comparison-heading' }
                        : {})}
                    >
                      <ComparisonResult
                        catalog={view.catalog}
                        result={view.comparison}
                        purchase={view.state.purchase}
                        subtotalOnly={
                          view.state.cart?.kind === 'subtotal' &&
                          view.state.cart.amountCents === view.state.purchase?.amountCents
                        }
                        maxAgeMinutes={
                          (view.state.comparison?.cartId ? CART_MAX_AGE_MS : RESULT_MAX_AGE_MS) / 60_000
                        }
                        checking={view.checkingTerms}
                      />
                    </div>
                  )}
                </div>
              </>
            ))}
          <Disclosure title="Settings" id="popup-settings">
            <div className="space-y-4">
              <BadgeSettings />
              {TELEMETRY_ENABLED && <TelemetrySettings />}
              <section className="space-y-2" aria-labelledby="protection-heading">
                <h2 id="protection-heading" className="section-title">
                  Passphrase protection: {protection === 'on' ? 'on' : 'off'}
                </h2>
                <ProtectionSettings protection={protection} />
              </section>
            </div>
          </Disclosure>
          <footer className="supporting space-y-3 pt-2">
            <p>
              Cards and purchase inputs stay on this device. This comparison works offline and requires no API
              key.
            </p>
            {catalog &&
              (view.checkingTerms ? (
                <p role="status">{CHECKING_TERMS_TITLE}</p>
              ) : (
                <p>Card terms expire {new Date(catalog.expiresAt).toLocaleString('en-US')}.</p>
              ))}
            <div className="flex flex-wrap gap-2">
              {onLock && (
                <Button size="small" color="secondary" icon="lock" disabled={busy} onClick={onLock}>
                  Lock saved inputs
                </Button>
              )}
              {view?.catalogUpdatesAvailable && (
                <Button
                  size="small"
                  color="secondary"
                  icon="swap-vertical"
                  isLoading={pending === 'catalog'}
                  disabled={(busy && pending !== 'catalog') || editing}
                  onClick={() => void refreshCatalog()}
                >
                  Check for updated terms
                </Button>
              )}
            </div>
            {TELEMETRY_ENABLED && <ReportProblem tabId={tab && tab.kind !== 'processor' ? tab.id : null} />}
            <DataProtectionDetails protection={protection} />
            <DeleteSavedData busy={busy} onDelete={remove} />
            {CREDITS_URL && (
              <p>
                About AI Checkout:{' '}
                <Link href={CREDITS_URL} isExternal>
                  credits and data sources
                </Link>
              </p>
            )}
          </footer>
        </div>
      </main>
    </ErrorBoundary>
  );
}
