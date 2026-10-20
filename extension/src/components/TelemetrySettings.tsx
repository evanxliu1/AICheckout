// Settings for usage reporting (Phase 15.3): the "Sharing usage data" toggle (off is Stop sharing: the queue
// and the random identifier are cleared, nothing more is sent) and "Delete my data" (the current identifier
// goes to the service for deletion, then sharing stops). Rendered only in builds with usage reporting.
import { useEffect, useState } from 'react';
import { AlertInline, Button, Fieldset, Toggle } from '@ai-checkout/ui';
import { telemetryRequest } from '../state/telemetry-client';
import type { TelemetryStatus } from '../state/telemetry-contracts';

export default function TelemetrySettings() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    telemetryRequest({ type: 'telemetry:get' })
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Settings could not be loaded.'));
  }, []);
  async function run(action: () => Promise<TelemetryStatus>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setStatus(await action());
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const sharing = status?.consent === 'granted';
  return (
    <div className="space-y-2">
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      {notice && <AlertInline role="status">{notice}</AlertInline>}
      <Fieldset
        legend="Usage reports"
        helperText="With sharing on, usage reports leave this device under a random identifier: no name, email or browsing history, and never a store’s address unless you tap Suggest this store or Report a problem. Turning sharing off clears the identifier and anything waiting to be sent; reports already sent can then no longer be deleted from here, and expire after 90 days."
      >
        <Toggle
          label="Sharing usage data"
          checked={sharing}
          disabled={busy || !status}
          onChange={(event) =>
            void run(
              () =>
                telemetryRequest({
                  type: 'telemetry:consent',
                  granted: event.target.checked,
                  source: 'settings',
                }),
              event.target.checked ? 'Sharing is on.' : 'Sharing stopped. Nothing more will be sent.',
            )
          }
        />
        <p className="supporting">
          Delete my data asks the service to delete the reports sent under your current identifier, then stops
          sharing. To delete reports, use it before turning sharing off. Reports expire after 90 days in any
          case.
        </p>
        <Button
          size="small"
          color="secondary"
          icon="trash"
          disabled={busy || !status}
          onClick={() =>
            void run(
              () => telemetryRequest({ type: 'telemetry:delete' }),
              sharing
                ? 'Your reports were deleted and sharing stopped.'
                : 'Sharing is off and this device holds no identifier, so there was nothing to delete. Reports sent earlier expire after 90 days.',
            )
          }
        >
          Delete my data
        </Button>
      </Fieldset>
    </div>
  );
}
