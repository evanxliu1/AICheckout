import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertInline, ApplicationState, Button, Card, Field, TextInput } from '@ai-checkout/ui';
import Popup from '../popup/Popup';
import PopupHeader from './PopupHeader';
import DataProtectionDetails from './DataProtectionDetails';
import DeleteSavedData from './DeleteSavedData';
import { STATE_KEY } from '../state/service';
import { PASSPHRASE_MIN_LENGTH } from '../state/vault-crypto';
import { VAULT_SESSION_KEY } from '../state/vault-contracts';
import type { VaultRequest, VaultStatus } from '../state/vault-contracts';
import { requestVault } from '../state/vault-client';

/** Opens straight into the popup unless optional passphrase protection is on and locked, or the
 * saved record is damaged. */
export default function VaultGate() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sequence = useRef(0);
  const update = useCallback((next: VaultStatus) => {
    setStatus(next);
    setPhrase('');
  }, []);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const next = await requestVault({ type: 'checkout:vault-status' });
      if (id === sequence.current) update(next);
    } catch (err) {
      if (id === sequence.current)
        setError(err instanceof Error ? err.message : 'Saved data could not be checked.');
    }
  }, [update]);
  useEffect(() => {
    const requests = sequence;
    void refresh();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const state = changes[STATE_KEY];
      if (
        (area === 'session' && changes[VAULT_SESSION_KEY]) ||
        (area === 'local' &&
          state &&
          (state.oldValue?.id !== state.newValue?.id || state.newValue === undefined))
      ) {
        // Unmount every private input/result immediately when lock/delete/protection changes.
        setStatus(null);
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      ++requests.current;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [refresh]);
  async function act(request: VaultRequest, hide = false) {
    const id = ++sequence.current;
    setBusy(true);
    setError('');
    if (hide) setStatus(null);
    try {
      const next = await requestVault(request);
      if (id === sequence.current) update(next);
    } catch (err) {
      // Storage events can refresh status before a failed operation responds (for
      // example, deletion locks successfully but the disk clear fails). Keep that
      // failure visible even when the event superseded the status request.
      setError(err instanceof Error ? err.message : 'Protected data could not be updated.');
      setPhrase('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const remove = () => void act({ type: 'checkout:vault-delete', confirmed: true }, true);
  if ((status === 'unlocked' || status === 'unprotected') && !busy)
    return (
      <Popup
        vaultError={error}
        protection={status === 'unlocked' ? 'on' : 'off'}
        onLock={status === 'unlocked' ? () => void act({ type: 'checkout:vault-lock' }, true) : undefined}
        onDelete={remove}
      />
    );
  return (
    <main className="checkout-popup">
      <PopupHeader />
      <div className="p-4 space-y-4">
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        {status === null || busy ? (
          <ApplicationState
            status="loading"
            titleTag="h2"
            title={busy ? 'Updating saved data…' : 'Checking saved data…'}
            actions={
              error ? (
                <Button
                  color="secondary"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    void refresh();
                  }}
                >
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card as="section" hasBorder aria-labelledby="vault-heading">
            <div className="card-body space-y-3">
              <h2 id="vault-heading" className="section-title">
                {status === 'damaged' ? 'Saved data could not be read' : 'Unlock your saved inputs'}
              </h2>
              {status === 'locked' ? (
                <>
                  <p>
                    Passphrase protection is on. Enter your local passphrase; your saved inputs stay encrypted
                    until you unlock them for this browser session. You can turn protection off in Settings
                    after unlocking.
                  </p>
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act({ type: 'checkout:vault-unlock', passphrase: phrase });
                    }}
                  >
                    <Field
                      id="vault-passphrase"
                      label="Local passphrase"
                      helperText="Use the passphrase you created in this Chrome profile."
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          type="password"
                          value={phrase}
                          disabled={busy}
                          required
                          minLength={PASSPHRASE_MIN_LENGTH}
                          maxLength={256}
                          autoComplete="current-password"
                          onChange={(event) => setPhrase(event.target.value)}
                        />
                      )}
                    </Field>
                    <Button type="submit" isFullWidth icon="lock" isLoading={busy}>
                      Unlock
                    </Button>
                  </form>
                </>
              ) : (
                <p>
                  Your saved record is damaged or uses an unsupported format. It has not been overwritten. You
                  can delete it to start again.
                </p>
              )}
              <DataProtectionDetails protection={status === 'damaged' ? 'damaged' : 'on'} locked />
            </div>
          </Card>
        )}
        {status && <DeleteSavedData busy={busy} onDelete={remove} />}
      </div>
    </main>
  );
}
