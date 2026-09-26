import { useEffect, useRef, useState } from 'react';
import { clearAllStorage, getOpenAIKey, setOpenAIKey, validateOpenAIKey } from '../utils/storage';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    setStatus('');
    setShowKey(false);
    setApiKey('');
    void getOpenAIKey().then((key) => {
      if (!cancelled) setApiKey(key);
    }).catch(() => {
      if (!cancelled) setStatus('Settings could not be read. Close this window and try again.');
    });
    return () => {
      cancelled = true;
      element?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [isOpen]);

  async function save() {
    const key = apiKey.trim();
    if (!validateOpenAIKey(key)) {
      setStatus('Enter an API key beginning with sk-, or use Remove API key.');
      return;
    }
    setBusy(true);
    try {
      await setOpenAIKey(key);
      onClose();
    } catch {
      setStatus('Your API key could not be saved. Check available extension storage and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(allData: boolean) {
    setBusy(true);
    try {
      if (allData) await clearAllStorage();
      else await setOpenAIKey('');
      setApiKey('');
      onClose();
    } catch {
      setStatus('The data could not be deleted. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;
  return (
    <dialog ref={dialog} aria-labelledby="settings-title" className="settings-dialog"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 id="settings-title" className="text-xl font-bold text-gray-900">Settings</h2>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-2">OpenAI API key</label>
        <input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey}
          onChange={(event) => setApiKey(event.target.value)} maxLength={512}
          autoComplete="off" spellCheck={false} aria-describedby="key-description"
          className="w-full px-3 py-2 border border-gray-300 rounded-md" />
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
          <input type="checkbox" checked={showKey} onChange={(event) => setShowKey(event.target.checked)} />
          Show API key
        </label>
        <p id="key-description" className="text-sm text-gray-600 mt-3">
          This prototype sends cart item names and the merchant to OpenAI when you request a recommendation.
          Your key stays in this extension’s local storage and is sent only to OpenAI. API usage may incur charges.
        </p>
        <p role="status" className="text-sm text-red-800 mt-3">{status}</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save API key'}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove(false)}>Remove API key</button>
        </div>
      </form>
      <div className="mt-5 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-600 mb-2">Delete the saved key, cached card catalog, preferences, and diagnostics from this device.</p>
        <button type="button" disabled={busy} className="text-sm text-red-800 underline" onClick={() => void remove(true)}>Delete all local data</button>
      </div>
    </dialog>
  );
}
