import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertInline, ApplicationState, Button, Card, Checkbox, Field, TextInput } from '@ai-checkout/ui';
import Popup from '../popup/Popup';
import PopupHeader from './PopupHeader';
import DataProtectionDetails from './DataProtectionDetails';
import DeleteSavedData from './DeleteSavedData';
import { STATE_KEY } from '../state/service';
import { PASSPHRASE_MIN_LENGTH } from '../state/vault-crypto';
import { VAULT_DISCLOSURE_VERSION, VAULT_SESSION_KEY, vaultResponseSchema } from '../state/vault-contracts';
import type { VaultRequest, VaultStatus } from '../state/vault-contracts';

async function requestVault(request: VaultRequest) {
  let input: unknown;
  try {
    input = await chrome.runtime.sendMessage(request);
  } catch {
    throw new Error('The extension could not connect. Reopen it and try again.');
  }
  const response = vaultResponseSchema.safeParse(input);
  if (!response.success) throw new Error('The extension returned an unreadable response.');
  if (!response.data.ok) throw new Error(response.data.error);
  return response.data.status;
}

export default function VaultGate() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [phrase, setPhrase] = useState(''),
    [repeat, setRepeat] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sequence = useRef(0);
  const creating = status === 'setup' || status === 'migration';
  const update = useCallback((next: VaultStatus) => {
    setStatus(next);
    setPhrase('');
    setRepeat('');
    setAccepted(false);
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
        // Unmount every private input/result immediately when lock/delete/session identity changes.
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
      setRepeat('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    if (creating) {
      if (phrase.length < PASSPHRASE_MIN_LENGTH) {
        setError(`Use at least ${PASSPHRASE_MIN_LENGTH} characters, ideally several unrelated words.`);
        return;
      }
      if (phrase !== repeat) {
        setError('The passphrases do not match. Enter them again.');
        return;
      }
      if (!accepted) {
        setError('Confirm how your data will be saved before continuing.');
        return;
      }
      void act({
        type: 'checkout:vault-create',
        passphrase: phrase,
        disclosureVersion: VAULT_DISCLOSURE_VERSION,
      });
    } else void act({ type: 'checkout:vault-unlock', passphrase: phrase });
  }
  if (status === 'unlocked' && !busy)
    return (
      <Popup
        vaultError={error}
        onLock={() => void act({ type: 'checkout:vault-lock' }, true)}
        onDelete={() => void act({ type: 'checkout:vault-delete', confirmed: true }, true)}
      />
    );
  const title = creating
    ? 'Protect your saved inputs'
    : status === 'damaged'
      ? 'Saved data could not be read'
      : 'Unlock your saved inputs';
  return (
    <main className="checkout-popup">
      <PopupHeader />
      <div className="p-4 space-y-4">
        {error && (
          <AlertInline color="critical" role="alert">
            {error}
          </AlertInline>
        )}
        {status === null ? (
          <ApplicationState
            status="loading"
            titleTag="h2"
            title={busy ? 'Updating protected storage…' : 'Checking saved data…'}
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
                {title}
              </h2>
              {status === 'migration' && (
                <p>
                  Your earlier inputs are not encrypted yet. Protect them below without losing your saved
                  cards, or delete them to start again.
                </p>
              )}
              {creating ? (
                <>
                  <p>
                    Card selections, reported reward limits, purchase inputs and cart identifiers will be
                    encrypted in this Chrome profile. They stay on your device and are not sent to an AI
                    provider.
                  </p>
                  <p>
                    Choose a local passphrase. Unlock once each browser session; no account is needed. We
                    cannot recover a forgotten passphrase. You can delete the saved data and start again.
                  </p>
                </>
              ) : status === 'locked' ? (
                <p>
                  Enter your local passphrase. Your saved inputs remain encrypted until you unlock them for
                  this browser session.
                </p>
              ) : (
                <p>
                  Your saved record is damaged or uses an unsupported format. It has not been overwritten. You
                  can delete it to start again.
                </p>
              )}
              {status !== 'damaged' && (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <Field
                    id="vault-passphrase"
                    label={creating ? 'New local passphrase' : 'Local passphrase'}
                    helperText={
                      creating
                        ? 'Use at least 15 characters, ideally several unrelated words. Save it somewhere you can find again.'
                        : 'Use the passphrase you created in this Chrome profile.'
                    }
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
                        autoComplete={creating ? 'new-password' : 'current-password'}
                        onChange={(event) => setPhrase(event.target.value)}
                      />
                    )}
                  </Field>
                  {creating && (
                    <>
                      <Field id="vault-repeat" label="Confirm local passphrase">
                        {(control) => (
                          <TextInput
                            {...control}
                            type="password"
                            value={repeat}
                            disabled={busy}
                            required
                            minLength={PASSPHRASE_MIN_LENGTH}
                            maxLength={256}
                            autoComplete="new-password"
                            onChange={(event) => setRepeat(event.target.value)}
                          />
                        )}
                      </Field>
                      <Checkbox
                        label="I agree to save these inputs encrypted on this device and understand that a forgotten passphrase cannot be recovered."
                        checked={accepted}
                        disabled={busy}
                        onChange={(event) => setAccepted(event.target.checked)}
                      />
                    </>
                  )}
                  <Button type="submit" isFullWidth icon="lock" isLoading={busy}>
                    {creating ? 'Protect saved inputs' : 'Unlock'}
                  </Button>
                </form>
              )}
              <DataProtectionDetails status={status} />
            </div>
          </Card>
        )}
        {status && status !== 'setup' && (
          <DeleteSavedData
            busy={busy}
            onDelete={() => void act({ type: 'checkout:vault-delete', confirmed: true }, true)}
          />
        )}
      </div>
    </main>
  );
}
