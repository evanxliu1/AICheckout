// "Suggest this store" (Phase 15.3): at a store the merchant release does not name, one tap sends the tab's
// registrable domain (the worker resolves it from the tab, never from this page), with the random identifier
// only while sharing is on. Works for shoppers who chose Not now (decision 3 of the Phase 15 plan).
import { useState } from 'react';
import { AlertInline, Button } from '@ai-checkout/ui';
import { telemetryRequest } from '../state/telemetry-client';

export default function SuggestStore({ tabId, disabled }: { tabId: number; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  async function suggest() {
    setState('busy');
    setError('');
    try {
      await telemetryRequest({ type: 'telemetry:suggest-store', tabId });
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The suggestion could not be sent.');
      setState('idle');
    }
  }
  return (
    <div className="space-y-2">
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      {state === 'sent' ? (
        <AlertInline role="status">Thanks. This store’s address was sent so it can be added.</AlertInline>
      ) : (
        <Button
          size="small"
          color="tertiary"
          icon="plus"
          isLoading={state === 'busy'}
          disabled={disabled}
          onClick={() => void suggest()}
        >
          Suggest this store
        </Button>
      )}
    </div>
  );
}
