// Opened in a tab on install: pick the cards you own and a default card, so the cart badge has
// something to compare. Everything is saved on this device only.
import { useCallback, useEffect, useState } from 'react';
import { AlertInline, ApplicationState, Card, Icon } from '@ai-checkout/ui';
import WalletEditor from '../components/WalletEditor';
import Consent from '../components/Consent';
import { checkoutRequest } from '../state/client';
import { telemetryRequest } from '../state/telemetry-client';
import { TELEMETRY_ENABLED } from '../state/keys';
import type { CheckoutResponse } from '../state/contracts';
import type { Wallet } from '../domain';

type View = Extract<CheckoutResponse, { ok: true }>;

export default function Onboarding() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /** Phase 15.3: the one consent question, after the cards are saved, only in builds that report usage. */
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  useEffect(() => {
    if (consent) document.getElementById('consent-heading')?.focus();
  }, [consent]);
  async function answer(granted: boolean) {
    setBusy(true);
    setConsentError('');
    try {
      await telemetryRequest({ type: 'telemetry:consent', granted, source: 'onboarding' });
      setConsent(false);
      setDone(true);
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : 'Your choice could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(async () => {
    try {
      setView(await checkoutRequest({ type: 'checkout:get-state' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your saved cards could not be loaded.');
    }
  }, []);
  useEffect(() => void load(), [load]);
  // Move to the confirmation once it renders (an effect, so it also runs in a background tab).
  useEffect(() => {
    if (done) document.getElementById('onboarding-done')?.focus();
  }, [done]);
  async function save(wallet: Wallet) {
    if (!view) return;
    setBusy(true);
    setError('');
    try {
      setView(
        await checkoutRequest({
          type: 'checkout:save-wallet',
          wallet,
          expectedRevision: view.state.revision,
        }),
      );
      if (TELEMETRY_ENABLED) setConsent(true);
      else setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your cards could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding">
      <header className="onboarding__header">
        <Icon name="shopping-cart" size={24} className="text-action" />
        <div>
          <h1 className="popup-title">Welcome to AI Checkout</h1>
          <p className="supporting">The best card you already own, shown right on your cart.</p>
        </div>
      </header>
      <div className="onboarding__body space-y-4">
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        {!view && !error ? (
          <ApplicationState status="loading" titleTag="h2" title="Loading your cards…" />
        ) : view && consent ? (
          <Consent busy={busy} error={consentError} onAnswer={(granted) => void answer(granted)} />
        ) : view && done ? (
          <Card as="section" hasBorder aria-labelledby="onboarding-done">
            <div className="card-body space-y-3">
              <h2 id="onboarding-done" tabIndex={-1} className="section-title">
                You’re set
              </h2>
              <p>
                Open a cart at any U.S. online store. A small badge in the corner shows which of your cards
                earns the most on it. Click it for every card’s estimate and the terms behind it.
              </p>
              <p className="supporting">
                Your cards and settings stay on this device. AI Checkout reads only the cart’s order summary
                on cart and checkout pages, and only the amount. You can change cards, turn the badge off for
                a site, or protect your data with a passphrase from the AI Checkout toolbar button.
                {TELEMETRY_ENABLED && ' Usage sharing can be changed there too, under Settings.'}
              </p>
              <p className="supporting">You can close this tab.</p>
            </div>
          </Card>
        ) : view ? (
          <>
            <section className="space-y-2" aria-labelledby="onboarding-intro">
              <h2 id="onboarding-intro" className="section-title">
                Pick the cards you have
              </h2>
              <p>
                Search for each card in your wallet and add it, then pick the one you use by default. No card
                numbers or bank login, and no account: AI Checkout keeps this on your device.
              </p>
            </section>
            <WalletEditor
              catalog={view.catalog}
              index={view.cardIndex}
              loadCards={(cardIds) =>
                checkoutRequest({ type: 'checkout:catalog-cards', cardIds }).then((next) => next.catalog)
              }
              wallet={view.state.wallet}
              busy={busy}
              onSave={save}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
