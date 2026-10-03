import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import WalletEditor from '../components/WalletEditor';
import ComparisonResult from '../components/ComparisonResult';
import DataProtectionDetails from '../components/DataProtectionDetails';
import DeleteSavedData from '../components/DeleteSavedData';
import BadgeSettings from '../components/BadgeSettings';
import ProtectionSettings from '../components/ProtectionSettings';
import SavingsHistory from '../components/SavingsHistory';
import {
  Disclosure,
  AlertInline,
  ApplicationState,
  Button,
  Card,
  Checkbox,
  Field,
  Select,
  TextInput,
} from '@ai-checkout/ui';
import PopupHeader from '../components/PopupHeader';
import { PAYMENT_LABELS } from '../components/estimates';
import { unvaluedPrograms } from '../components/wallet-options';
import { catalogMerchantIds, formatUsd, parseUsd, usageInputs } from '../domain';
import type { Eligibility, PaymentPathV3, Wallet } from '../domain';
import { checkoutRequest } from '../state/client';
import type { CheckoutResponse } from '../state/contracts';
import { localDate, CART_MAX_AGE_MS, RESULT_MAX_AGE_MS, STATE_KEY } from '../state/keys';
import { emptyState } from '../state/contracts';
import { MERCHANT_IDS, merchantName } from '../checkout/merchants';

type View = Extract<CheckoutResponse, { ok: true }>;

export default function Popup({
  onLock,
  onDelete,
  vaultError,
  protection = 'off',
}: {
  onLock?: () => void;
  onDelete?: () => void;
  vaultError?: string;
  /** Optional passphrase protection (off by default). */
  protection?: 'off' | 'on';
} = {}) {
  const [view, setView] = useState<View | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<
    'load' | 'read' | 'save' | 'compare' | 'delete' | 'catalog' | 'savings' | null
  >(null);
  const busy = pending !== null;
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [merchantId, setMerchantId] = useState<string>('best-buy-us');
  const [eligible, setEligible] = useState(false);
  const [onlineRetail, setOnlineRetail] = useState<Eligibility>('unknown');
  const [paymentPath, setPaymentPath] = useState<PaymentPathV3>('card');
  const [dirty, setDirty] = useState(false);
  const [cartId, setCartId] = useState<string | null>(null);
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
    setPaymentPath(next.state.purchase?.paymentPath ?? 'card');
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
  async function deleteSavings() {
    if (!view) return;
    setPending('savings');
    setError('');
    try {
      restore(
        await checkoutRequest({ type: 'checkout:delete-savings', expectedRevision: view.state.revision }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The history could not be deleted. Try again.');
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
  const unvalued = view ? unvaluedPrograms(view.catalog, view.state.wallet) : [];
  const ownedNames = (view?.state.wallet.cards ?? [])
    .map((c) => catalog?.cards.find((p) => p.id === c.cardId)?.shortName ?? 'Unavailable card')
    .join(' · ');
  return (
    <ErrorBoundary>
      <main className="checkout-popup">
        <PopupHeader />
        <div className="p-4 space-y-4">
          {vaultError && (
            <AlertInline color="critical" role="alert">
              {vaultError}
            </AlertInline>
          )}
          {error && (
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
                      helperText="Choose the merchant for manual entry. Reading a supported cart selects its merchant for you."
                    >
                      {(control) => (
                        <Select
                          {...control}
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
                        >
                          {!MERCHANT_IDS.some((id) => id === merchantId) && (
                            <option value={merchantId}>Unsupported saved merchant</option>
                          )}
                          {MERCHANT_IDS.map((id) => (
                            <option key={id} value={id}>
                              {merchantName(id)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {!catalogMerchantIds(view.catalog).includes(merchantId) && (
                      <AlertInline color="warning" role="status">
                        Your current card terms do not cover {merchantName(merchantId)}. Check for updated
                        terms or an extension update.
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
                            The final charge is not known. Enter the amount you’ll charge when it is
                            available, or compare this subtotal only.
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
                      />
                    </div>
                  )}
                </div>
              </>
            ))}
          {view && !editing && view.state.wallet.cards.length > 0 && (
            <SavingsHistory
              entries={view.state.savings}
              cards={view.cardIndex}
              busy={busy}
              onDelete={() => void deleteSavings()}
            />
          )}
          <Disclosure title="Settings" id="popup-settings">
            <div className="space-y-4">
              <BadgeSettings />
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
              Cards, purchase inputs and savings stay on this device. This comparison works offline and
              requires no API key.
            </p>
            {catalog && <p>Card terms expire {new Date(catalog.expiresAt).toLocaleString('en-US')}.</p>}
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
            <DataProtectionDetails protection={protection} />
            <DeleteSavedData busy={busy} onDelete={() => (onDelete ? onDelete() : void clear())} />
          </footer>
        </div>
      </main>
    </ErrorBoundary>
  );
}
