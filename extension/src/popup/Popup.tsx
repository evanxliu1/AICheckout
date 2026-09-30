import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import WalletEditor from '../components/WalletEditor';
import ComparisonResult from '../components/ComparisonResult';
import DataProtectionDetails from '../components/DataProtectionDetails';
import DeleteSavedData from '../components/DeleteSavedData';
import { catalogMerchantIds, formatUsd, parseUsd } from '../domain';
import type { Eligibility, Wallet } from '../domain';
import { checkoutRequest } from '../state/client';
import type { CheckoutResponse } from '../state/contracts';
import { localDate, CART_MAX_AGE_MS, RESULT_MAX_AGE_MS, STATE_KEY } from '../state/service';
import { emptyState } from '../state/contracts';
import { currentCatalog } from '../state/catalog';
import { MERCHANT_IDS, merchantName } from '../checkout/merchants';

type View = Extract<CheckoutResponse, { ok: true }>;

export default function Popup({
  onLock,
  onDelete,
  vaultError,
}: { onLock?: () => void; onDelete?: () => void; vaultError?: string } = {}) {
  const [view, setView] = useState<View | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<'load' | 'read' | 'save' | 'compare' | 'delete' | 'catalog' | null>(
    null,
  );
  const busy = pending !== null;
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [merchantId, setMerchantId] = useState<string>('best-buy-us');
  const [eligible, setEligible] = useState(false);
  const [onlineRetail, setOnlineRetail] = useState<Eligibility>('unknown');
  const [dirty, setDirty] = useState(false);
  const [cartId, setCartId] = useState<string | null>(null);
  const resultAnchor = useRef<HTMLDivElement>(null);
  const catalog = currentCatalog(view?.state ?? emptyState());
  const bceCard = view?.state.wallet.cards.find((c) => c.cardId === 'amex-blue-cash-everyday');
  const bceUsage = bceCard?.usage.find(
    (u) => u.ruleId === 'bce-online-retail' && u.recordedOn === localDate(Date.now()),
  );

  useEffect(() => {
    if (!dirty && !editing && view?.comparison) {
      resultAnchor.current?.focus({ preventScroll: true });
      resultAnchor.current?.scrollIntoView({ block: 'start' });
    }
  }, [dirty, editing, view?.comparison]);

  const restore = useCallback((next: View) => {
    setView(next);
    const cart = next.state.cart;
    const hasPendingCart = !!cart && !next.state.comparison;
    setAmount(
      hasPendingCart
        ? (cart.amountCents / 100).toFixed(2)
        : next.state.purchase
          ? (next.state.purchase.amountCents / 100).toFixed(2)
          : '',
    );
    setMerchantId(
      hasPendingCart
        ? cart.merchantId
        : (next.state.purchase?.merchantId ?? cart?.merchantId ?? 'best-buy-us'),
    );
    setCartId(cart?.id ?? null);
    // Restored results are labeled saved; a new comparison requires renewed confirmation.
    setEligible(false);
    setOnlineRetail(next.state.purchase?.onlineRetail ?? 'unknown');
    setDirty(false);
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
    void checkoutRequest({ type: 'checkout:get-state' })
      .then((next) => {
        if (!cancelled) restore(next);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Your saved inputs could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [restore]);

  useEffect(() => {
    if (!view?.comparison || !view.state.comparison) return;
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const remaining =
      Math.min(
        view.state.comparison.computedAt + RESULT_MAX_AGE_MS,
        Date.parse(catalog.expiresAt),
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
  }, [view, catalog.expiresAt]);

  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[STATE_KEY]) return;
      const next = changes[STATE_KEY].newValue;
      if (next === undefined) {
        restore({
          ok: true,
          state: emptyState(),
          comparison: null,
          notice: 'Local data deleted.',
          catalogUpdatesAvailable: view?.catalogUpdatesAvailable ?? false,
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
  }, [restore, view?.state.revision, view?.catalogUpdatesAvailable]);

  async function readCart() {
    if (!view) return;
    setPending('read');
    setError('');
    setDirty(true);
    setEligible(false);
    try {
      const next = await checkoutRequest({
        type: 'checkout:read-cart',
        expectedRevision: view.state.revision,
      });
      setView(next);
      setCartId(next.state.cart?.id ?? null);
      setAmount(next.state.cart ? (next.state.cart.amountCents / 100).toFixed(2) : '');
      if (next.state.cart) setMerchantId(next.state.cart.merchantId);
      setOnlineRetail('unknown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The cart could not be read. Enter the amount manually.');
    } finally {
      setPending(null);
    }
  }

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
        },
      });
      setView(next);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The comparison could not be saved. Try again.');
    } finally {
      setPending(null);
    }
  }
  async function clear() {
    setPending('delete');
    setError('');
    try {
      restore(await checkoutRequest({ type: 'checkout:clear' }));
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
  return (
    <ErrorBoundary>
      <main className="checkout-popup text-gray-900">
        <header className="px-4 py-3 bg-white border-b border-gray-200">
          <h1 className="text-xl font-bold">AI Checkout</h1>
          <p className="supporting mt-1">Compare rewards on cards you own.</p>
        </header>
        <div className="p-4 space-y-4">
          {vaultError && (
            <p role="alert" className="error-message">
              {vaultError}
            </p>
          )}
          {error && (
            <div role="alert" className="error-message">
              <p>{error}</p>
              <button className="underline font-medium mt-2" disabled={busy} onClick={() => void load()}>
                Reload saved inputs
              </button>
            </div>
          )}
          {!view && !error && (
            <p role="status" className="supporting">
              Loading your cards…
            </p>
          )}
          {view?.notice && (
            <div role="status" className="supporting">
              <p>{view.notice}</p>
              <button className="text-primary-700 underline mt-2" disabled={busy} onClick={() => void load()}>
                Load saved inputs
              </button>
            </div>
          )}
          {view &&
            (editing ? (
              <WalletEditor
                key={view.state.revision}
                catalog={catalog}
                wallet={view.state.wallet}
                busy={busy}
                onSave={saveWallet}
                onCancel={view.state.wallet.cards.length ? () => setEditing(false) : undefined}
              />
            ) : (
              <>
                <section className="surface" aria-label="Saved cards">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-semibold">Your cards</h2>
                    <button
                      className="text-primary-700 underline text-sm"
                      disabled={busy}
                      onClick={() => {
                        setEditing(true);
                        setError('');
                      }}
                    >
                      Edit cards
                    </button>
                  </div>
                  <p className="supporting mt-1">
                    {view.state.wallet.cards
                      .map(
                        (c) => catalog.cards.find((p) => p.id === c.cardId)?.shortName ?? 'Unavailable card',
                      )
                      .join(' · ') || 'No cards selected.'}
                  </p>
                  {bceCard && (
                    <p className="supporting mt-2">
                      Blue Cash Everyday online retail spend:{' '}
                      {bceUsage?.spentCents != null
                        ? `${formatUsd(bceUsage.spentCents)} reported today. Edit if it changed.`
                        : 'unknown. You can add it in Edit cards.'}
                    </p>
                  )}
                </section>
                <section className="surface" aria-labelledby="purchase-heading">
                  <h2 id="purchase-heading" className="text-lg font-semibold">
                    Your purchase
                  </h2>
                  <label htmlFor="purchase-merchant" className="field-label mt-4">
                    Merchant
                  </label>
                  <select
                    id="purchase-merchant"
                    className="field-input"
                    value={merchantId}
                    disabled={busy}
                    onChange={(e) => {
                      setMerchantId(e.target.value);
                      setAmount('');
                      setCartId(null);
                      setOnlineRetail('unknown');
                      setEligible(false);
                      setDirty(true);
                      setError('');
                    }}
                    aria-describedby="merchant-help"
                  >
                    {!MERCHANT_IDS.some((id) => id === merchantId) && (
                      <option value={merchantId}>Unsupported saved merchant</option>
                    )}
                    {MERCHANT_IDS.map((id) => (
                      <option key={id} value={id}>
                        {merchantName(id)}
                      </option>
                    ))}
                  </select>
                  <p id="merchant-help" className="supporting mt-2">
                    Choose the merchant for manual entry. Reading a supported cart selects its merchant for
                    you.
                  </p>
                  {!catalogMerchantIds(catalog).includes(merchantId) && (
                    <p role="status" className="supporting mt-2">
                      Your current card terms do not cover {merchantName(merchantId)}. Check for updated terms
                      or an extension update.
                    </p>
                  )}
                  <button className="btn-secondary mt-3" disabled={busy} onClick={() => void readCart()}>
                    {pending === 'read' ? 'Reading cart…' : 'Read cart amount'}
                  </button>
                  {cartId && view.state.cart && (
                    <div className="supporting mt-3" role="status">
                      <p>
                        Read {formatUsd(view.state.cart.amountCents)} as{' '}
                        {view.state.cart.kind === 'estimated-total'
                          ? 'an estimated total'
                          : view.state.cart.kind === 'subtotal'
                            ? 'a subtotal before tax and shipping'
                            : 'the order total'}
                        . Confirm or correct the amount below. The page is checked again before comparing.
                      </p>
                      {view.state.cart.kind === 'subtotal' && (
                        <p className="mt-2">
                          The final charge is not known. Enter the amount you’ll charge when it is available,
                          or compare this subtotal only.
                        </p>
                      )}
                      <button
                        className="underline text-primary-700 mt-2"
                        disabled={busy}
                        onClick={() => {
                          setCartId(null);
                          setDirty(true);
                          setEligible(false);
                        }}
                      >
                        Use manual entry instead
                      </button>
                    </div>
                  )}
                  <form
                    className="mt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void compare();
                    }}
                  >
                    <label htmlFor="purchase-amount" className="field-label">
                      Purchase amount (USD)
                    </label>
                    <input
                      id="purchase-amount"
                      type="text"
                      inputMode="decimal"
                      maxLength={14}
                      value={amount}
                      disabled={busy}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setDirty(true);
                        setEligible(false);
                      }}
                      className="field-input"
                      placeholder="0.00"
                    />
                    <label htmlFor="online-eligibility" className="field-label mt-4">
                      Online retail bonus eligibility
                    </label>
                    <select
                      id="online-eligibility"
                      className="field-input"
                      value={onlineRetail}
                      disabled={busy}
                      onChange={(e) => {
                        setOnlineRetail(e.target.value as Eligibility);
                        setDirty(true);
                      }}
                      aria-describedby="online-help"
                    >
                      <option value="unknown">I’m not sure</option>
                      <option value="eligible">Eligible goods, paid directly online</option>
                      <option value="ineligible">In-store payment or other excluded channel</option>
                    </select>
                    <p id="online-help" className="supporting mt-2">
                      The bonus applies to physical goods paid for online at a US retailer. Services, in-store
                      payment and third-party installment plans are excluded. The merchant must report an
                      internet transaction.
                    </p>
                    <label className="flex items-start gap-3 text-sm mt-4">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={eligible}
                        disabled={busy}
                        onChange={(e) => {
                          setEligible(e.target.checked);
                          setDirty(true);
                        }}
                      />
                      <span>
                        I confirmed the amount is for eligible purchases, excluding gift cards, cash
                        equivalents, fees and rewards-covered amounts.
                      </span>
                    </label>
                    <button
                      className="btn-primary w-full mt-5"
                      type="submit"
                      disabled={busy || !view.state.wallet.cards.length}
                    >
                      {pending === 'compare' ? 'Comparing…' : 'Compare my cards'}
                    </button>
                  </form>
                </section>
                {!dirty && view.comparison && (
                  <div ref={resultAnchor} tabIndex={-1} aria-label="Comparison result">
                    <ComparisonResult
                      catalog={catalog}
                      result={view.comparison}
                      purchase={view.state.purchase}
                      subtotalOnly={
                        view.state.cart?.kind === 'subtotal' &&
                        view.state.cart.amountCents === view.state.purchase?.amountCents
                      }
                      maxAgeMinutes={view.state.comparison?.cartId ? 5 : 15}
                    />
                  </div>
                )}
              </>
            ))}
          <footer className="supporting pt-2">
            <p>
              Cards and purchase inputs stay on this device. This comparison works offline and requires no API
              key.
            </p>
            <p className="mt-2">Card terms expire {new Date(catalog.expiresAt).toLocaleString('en-US')}.</p>
            <div className="flex flex-col items-start gap-3 mt-3">
              {onLock && (
                <button className="text-primary-700 underline" disabled={busy} onClick={onLock}>
                  Lock saved inputs
                </button>
              )}
              {view?.catalogUpdatesAvailable && (
                <button
                  className="text-primary-700 underline"
                  disabled={busy || editing}
                  onClick={() => void refreshCatalog()}
                >
                  {pending === 'catalog' ? 'Checking terms…' : 'Check for updated terms'}
                </button>
              )}
            </div>
            {onLock && <DataProtectionDetails />}
            <DeleteSavedData busy={busy} onDelete={() => (onDelete ? onDelete() : void clear())} />
          </footer>
        </div>
      </main>
    </ErrorBoundary>
  );
}
