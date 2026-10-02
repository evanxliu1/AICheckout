// Optional passphrase protection, off by default. Turning it on encrypts the saved record; turning
// it off (passphrase required) stores it in plain local storage again.
import { useState } from 'react';
import { AlertInline, Button, Checkbox, Field, TextInput } from '@ai-checkout/ui';
import { PASSPHRASE_MIN_LENGTH } from '../state/vault-crypto';
import { VAULT_DISCLOSURE_VERSION } from '../state/vault-contracts';
import { requestVault } from '../state/vault-client';

export default function ProtectionSettings({ protection }: { protection: 'off' | 'on' }) {
  const [phrase, setPhrase] = useState(''),
    [repeat, setRepeat] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setError('');
    if (protection === 'off') {
      if (phrase.length < PASSPHRASE_MIN_LENGTH)
        return setError(`Use at least ${PASSPHRASE_MIN_LENGTH} characters, ideally several unrelated words.`);
      if (phrase !== repeat) return setError('The passphrases do not match. Enter them again.');
      if (!accepted) return setError('Confirm that a forgotten passphrase cannot be recovered.');
    }
    setBusy(true);
    try {
      // The popup reloads itself when protection changes (storage events in VaultGate).
      await requestVault(
        protection === 'off'
          ? { type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: VAULT_DISCLOSURE_VERSION }
          : { type: 'checkout:vault-remove', passphrase: phrase },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Protection could not be changed.');
    } finally {
      setPhrase('');
      setRepeat('');
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p>
        {protection === 'off'
          ? 'Optional. Encrypt your cards, savings and purchase inputs with a passphrase. You unlock once per browser session; the badge asks you to unlock before it can show your best card. A forgotten passphrase cannot be recovered.'
          : 'Your saved data is encrypted with your passphrase. Turning protection off keeps your data and stores it unencrypted in this Chrome profile, like the default.'}
      </p>
      {error && (
        <AlertInline color="critical" role="alert">
          {error}
        </AlertInline>
      )}
      <Field
        id={protection === 'off' ? 'vault-passphrase' : 'vault-current-passphrase'}
        label={protection === 'off' ? 'New local passphrase' : 'Current passphrase'}
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
            autoComplete={protection === 'off' ? 'new-password' : 'current-password'}
            onChange={(event) => setPhrase(event.target.value)}
          />
        )}
      </Field>
      {protection === 'off' && (
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
            label="I understand that a forgotten passphrase cannot be recovered."
            checked={accepted}
            disabled={busy}
            onChange={(event) => setAccepted(event.target.checked)}
          />
        </>
      )}
      <Button
        type="submit"
        size="small"
        color={protection === 'off' ? 'primary' : 'secondary'}
        icon="lock"
        isLoading={busy}
      >
        {protection === 'off' ? 'Protect with a passphrase' : 'Turn off passphrase protection'}
      </Button>
    </form>
  );
}
