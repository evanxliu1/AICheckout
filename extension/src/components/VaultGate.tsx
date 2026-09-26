import { useCallback, useEffect, useRef, useState } from 'react';
import Popup from '../popup/Popup';
import DataProtectionDetails from './DataProtectionDetails';
import DeleteSavedData from './DeleteSavedData';
import { STATE_KEY } from '../state/service';
import { PASSPHRASE_MIN_LENGTH } from '../state/vault-crypto';
import { VAULT_DISCLOSURE_VERSION, VAULT_SESSION_KEY, vaultResponseSchema } from '../state/vault-contracts';
import type { VaultRequest, VaultStatus } from '../state/vault-contracts';

async function requestVault(request: VaultRequest) {
  let input: unknown;
  try { input = await chrome.runtime.sendMessage(request); }
  catch { throw new Error('The extension could not connect. Reopen it and try again.'); }
  const response = vaultResponseSchema.safeParse(input);
  if (!response.success) throw new Error('The extension returned an unreadable response.');
  if (!response.data.ok) throw new Error(response.data.error);
  return response.data.status;
}

export default function VaultGate() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [phrase, setPhrase] = useState(''), [repeat, setRepeat] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  const creating = status === 'setup' || status === 'migration';
  const update = useCallback((next: VaultStatus) => {
    setStatus(next); setPhrase(''); setRepeat(''); setAccepted(false);
  }, []);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try { const next = await requestVault({ type: 'checkout:vault-status' }); if (id === sequence.current) update(next); }
    catch (err) { if (id === sequence.current) setError(err instanceof Error ? err.message : 'Saved data could not be checked.'); }
  }, [update]);
  useEffect(() => {
    const requests = sequence;
    void refresh();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const state = changes[STATE_KEY];
      if ((area === 'session' && changes[VAULT_SESSION_KEY]) || (area === 'local' && state &&
        (state.oldValue?.id !== state.newValue?.id || state.newValue === undefined))) {
        // Unmount every private input/result immediately when lock/delete/session identity changes.
        setStatus(null); void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => { ++requests.current; chrome.storage.onChanged.removeListener(onChange); };
  }, [refresh]);
  async function act(request: VaultRequest, hide = false) {
    const id = ++sequence.current;
    setBusy(true); setError('');
    if (hide) setStatus(null);
    try { const next = await requestVault(request); if (id === sequence.current) update(next); }
    catch (err) {
      // Storage events can refresh status before a failed operation responds (for
      // example, deletion locks successfully but the disk clear fails). Keep that
      // failure visible even when the event superseded the status request.
      setError(err instanceof Error ? err.message : 'Protected data could not be updated.');
      setPhrase(''); setRepeat('');
      await refresh();
    } finally { setBusy(false); }
  }
  function submit() {
    if (creating) {
      if (phrase.length < PASSPHRASE_MIN_LENGTH) { setError(`Use at least ${PASSPHRASE_MIN_LENGTH} characters, ideally several unrelated words.`); return; }
      if (phrase !== repeat) { setError('The passphrases do not match. Enter them again.'); return; }
      if (!accepted) { setError('Confirm how your data will be saved before continuing.'); return; }
      void act({ type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: VAULT_DISCLOSURE_VERSION });
    } else void act({ type: 'checkout:vault-unlock', passphrase: phrase });
  }
  if (status === 'unlocked' && !busy) return <Popup vaultError={error}
    onLock={() => void act({ type: 'checkout:vault-lock' }, true)}
    onDelete={() => void act({ type: 'checkout:vault-delete', confirmed: true }, true)} />;
  return <main className="checkout-popup text-gray-900">
    <header className="px-4 py-3 bg-white border-b border-gray-200">
      <h1 className="text-xl font-bold">AI Checkout</h1>
      <p className="supporting mt-1">Compare rewards on cards you own.</p>
    </header>
    <div className="p-4 space-y-4">
      {error && <p role="alert" className="error-message">{error}</p>}
      {status === null ? <>
        <p role="status" className="supporting">{busy ? 'Updating protected storage…' : 'Checking saved data…'}</p>
        {error && <button className="btn-secondary" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Retry</button>}
      </> : <section className="surface" aria-labelledby="vault-heading">
        <h2 id="vault-heading" className="text-lg font-semibold">{creating ? 'Protect your saved inputs' : status === 'damaged' ? 'Saved data could not be read' : 'Unlock your saved inputs'}</h2>
        {status === 'migration' && <p className="supporting mt-2">Your earlier inputs are not encrypted yet. Protect them below without losing your saved cards, or delete them to start again.</p>}
        {creating ? <>
          <p className="supporting mt-2">Card selections, reported reward limits, purchase inputs and cart identifiers will be encrypted in this Chrome profile. They stay on your device and are not sent to an AI provider.</p>
          <p className="supporting mt-2">Choose a local passphrase. Unlock once each browser session; no account is needed. We cannot recover a forgotten passphrase. You can delete the saved data and start again.</p>
        </> : status === 'locked' ? <p className="supporting mt-2">Enter your local passphrase. Your saved inputs remain encrypted until you unlock them for this browser session.</p>
          : <p className="supporting mt-2">Your saved record is damaged or uses an unsupported format. It has not been overwritten. You can delete it to start again.</p>}
        {status !== 'damaged' && <form className="mt-4" onSubmit={event => { event.preventDefault(); submit(); }}>
          <label className="field-label" htmlFor="vault-passphrase">{creating ? 'New local passphrase' : 'Local passphrase'}</label>
          <input id="vault-passphrase" type="password" className="field-input" value={phrase} disabled={busy} required
            minLength={PASSPHRASE_MIN_LENGTH} maxLength={256} autoComplete={creating ? 'new-password' : 'current-password'}
            aria-describedby="vault-passphrase-help" onChange={event => setPhrase(event.target.value)} />
          <p id="vault-passphrase-help" className="supporting mt-2">{creating ? 'Use at least 15 characters, ideally several unrelated words. Save it somewhere you can find again.' : 'Use the passphrase you created in this Chrome profile.'}</p>
          {creating && <>
            <label className="field-label mt-4" htmlFor="vault-repeat">Confirm local passphrase</label>
            <input id="vault-repeat" type="password" className="field-input" value={repeat} disabled={busy} required
              minLength={PASSPHRASE_MIN_LENGTH} maxLength={256} autoComplete="new-password" onChange={event => setRepeat(event.target.value)} />
            <label className="flex items-start gap-3 text-sm mt-4">
              <input type="checkbox" className="mt-1" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />
              <span>I agree to save these inputs encrypted on this device and understand that a forgotten passphrase cannot be recovered.</span>
            </label>
          </>}
          <button className="btn-primary w-full mt-4" disabled={busy} type="submit">{busy ? 'Working…' : creating ? 'Protect saved inputs' : 'Unlock'}</button>
        </form>}
        <DataProtectionDetails status={status} />
      </section>}
      {status && status !== 'setup' && <DeleteSavedData busy={busy}
        onDelete={() => void act({ type: 'checkout:vault-delete', confirmed: true }, true)} />}
    </div>
  </main>;
}
