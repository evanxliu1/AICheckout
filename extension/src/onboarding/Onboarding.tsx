// Opened in a tab on install: pick the cards you own and a default card, so the cart badge has
// something to compare. Everything is saved on this device only.
import { useCallback, useEffect, useState } from 'react';
import { AlertInline, ApplicationState, Card, Icon } from '@ai-checkout/ui';
import WalletEditor from '../components/WalletEditor';
import { checkoutRequest } from '../state/client';
import type { CheckoutResponse } from '../state/contracts';
import { currentCatalog } from '../state/catalog';
import type { Wallet } from '../domain';
import { MERCHANT_IDS, merchantName } from '../checkout/merchants';

type View = Extract<CheckoutResponse, { ok: true }>;

export default function Onboarding() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const load = useCallback(async () => {
    try {
      setView(await checkoutRequest({ type: 'checkout:get-state' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your saved cards could not be loaded.');
    }
  }, []);
  useEffect(() => void load(), [load]);
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
      setDone(true);
      requestAnimationFrame(() => document.getElementById('onboarding-done')?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your cards could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const sites = MERCHANT_IDS.map(merchantName)
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1');
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
        ) : view && done ? (
          <Card as="section" hasBorder aria-labelledby="onboarding-done">
            <div className="card-body space-y-3">
              <h2 id="onboarding-done" tabIndex={-1} className="section-title">
                You’re set
              </h2>
              <p>
                Open a cart on {sites}. A small badge in the corner shows which of your cards earns the most
                cash back on it. Click it for every card’s estimate and the terms behind it.
              </p>
              <p className="supporting">
                Your cards and settings stay on this device. AI Checkout reads only the cart’s order summary
                on those sites, and only the amount. You can change cards, turn the badge off for a site, or
                protect your data with a passphrase from the AI Checkout toolbar button.
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
                Choose the cash-back cards in your wallet and the one you use by default. No card numbers or
                bank login, and no account: AI Checkout keeps this on your device.
              </p>
            </section>
            <WalletEditor
              catalog={currentCatalog(view.state)}
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
