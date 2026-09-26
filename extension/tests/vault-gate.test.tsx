import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VaultGate from '../src/components/VaultGate';
import { emptyState } from '../src/state/contracts';
import { VAULT_SESSION_KEY } from '../src/state/vault-contracts';
import type { VaultStatus } from '../src/state/vault-contracts';

type Change = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let status: VaultStatus, listeners: Set<Change>;
const send = vi.fn();
const phrase = 'several unrelated words for testing';
const privateView = { ok: true, state: { ...emptyState(), wallet: {
  defaultCardId: 'capital-one-quicksilver', cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
} }, comparison: null, notice: null, catalogUpdatesAvailable: false };
beforeEach(() => {
  status = 'setup'; listeners = new Set(); send.mockReset();
  send.mockImplementation(async (request: { type: string }) => {
    if (request.type === 'checkout:vault-create' || request.type === 'checkout:vault-unlock') status = 'unlocked';
    if (request.type === 'checkout:vault-lock') status = 'locked';
    if (request.type === 'checkout:vault-delete') status = 'setup';
    return request.type === 'checkout:get-state' ? privateView : { ok: true, status };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send }, storage: { onChanged: {
    addListener: (listener: Change) => listeners.add(listener), removeListener: (listener: Change) => listeners.delete(listener),
  } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fillSetup(repeat = phrase) {
  fireEvent.change(screen.getByLabelText('New local passphrase'), { target: { value: phrase } });
  fireEvent.change(screen.getByLabelText('Confirm local passphrase'), { target: { value: repeat } });
}
function emitLock() { for (const listener of listeners) listener({ [VAULT_SESSION_KEY]: { oldValue: { id: 'old' } } }, 'session'); }

describe('local protection gate', () => {
  it('requires matching passphrases and explicit disclosure acceptance before requesting setup or reading private inputs', async () => {
    render(<VaultGate />); await screen.findByLabelText('New local passphrase');
    expect(screen.getByText(/After you choose a passphrase and accept setup/)).toBeTruthy();
    expect(send.mock.calls.map(([request]) => request.type)).toEqual(['checkout:vault-status']);
    fillSetup('different words entered here');
    fireEvent.click(screen.getByRole('button', { name: 'Protect saved inputs' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('do not match'));
    fillSetup(); fireEvent.click(screen.getByRole('button', { name: 'Protect saved inputs' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Confirm how'));
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to save/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Protect saved inputs' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(send).toHaveBeenCalledWith({ type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: 1 });
    expect(screen.queryByLabelText('New local passphrase')).toBeNull();
    expect(screen.getByText('Data and protection details')).toBeTruthy();
  });
  it('explains migration before exposing old financial inputs', async () => {
    status = 'migration'; render(<VaultGate />);
    expect(await screen.findByText(/Your earlier inputs are not encrypted yet/)).toBeTruthy();
    expect(screen.getByText(/Your earlier saved inputs are still unencrypted/)).toBeTruthy();
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
    fillSetup(); fireEvent.click(screen.getByRole('checkbox', { name: /I agree to save/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Protect saved inputs' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.getByText('Quicksilver')).toBeTruthy();
  });
  it('clears a wrong passphrase and allows a successful unlock retry', async () => {
    status = 'locked'; render(<VaultGate />);
    fireEvent.change(await screen.findByLabelText('Local passphrase'), { target: { value: phrase } });
    send.mockResolvedValueOnce({ ok: false, error: 'Could not unlock. Check your passphrase.' });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Could not unlock'));
    expect((screen.getByLabelText('Local passphrase') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Local passphrase'), { target: { value: phrase } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('immediately unmounts private inputs when another window locks, even while status is pending', async () => {
    status = 'unlocked'; render(<VaultGate />); await screen.findByLabelText('Purchase amount (USD)');
    let respond!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    act(() => emitLock());
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
    expect(screen.queryByText('Quicksilver')).toBeNull();
    await act(async () => respond({ ok: true, status: 'locked' }));
    await screen.findByLabelText('Local passphrase');
    cleanup(); expect(listeners.size).toBe(0);
  });
  it('reports a failed lock instead of silently claiming the session is locked', async () => {
    status = 'unlocked'; render(<VaultGate />); await screen.findByLabelText('Purchase amount (USD)');
    send.mockResolvedValueOnce({ ok: false, error: 'Protected storage could not be saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'Lock saved inputs' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
  });
  it('preserves a deletion error when locking emits a storage event before disk deletion fails', async () => {
    status = 'unlocked'; render(<VaultGate />); await screen.findByLabelText('Purchase amount (USD)');
    fireEvent.click(screen.getByText('Delete saved data'));
    expect((screen.getByRole('button', { name: 'Delete all local data' }) as HTMLButtonElement).disabled).toBe(true);
    expect(send.mock.calls.some(([request]) => request.type === 'checkout:vault-delete')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /I want to permanently delete/ }));
    send.mockImplementationOnce(async () => {
      status = 'locked'; emitLock();
      return { ok: false, error: 'Protected storage could not be saved.' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete all local data' }));
    await screen.findByLabelText('Local passphrase');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
  });
  it('requires explicit reset confirmation for damaged data and returns to setup', async () => {
    status = 'damaged'; render(<VaultGate />); await screen.findByText('Saved data could not be read');
    expect(screen.queryByLabelText('Local passphrase')).toBeNull();
    fireEvent.click(screen.getByText('Delete saved data'));
    const remove = screen.getByRole('button', { name: 'Delete all local data' });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I want to permanently delete/ }));
    fireEvent.click(remove); await screen.findByLabelText('New local passphrase');
    expect(send).toHaveBeenCalledWith({ type: 'checkout:vault-delete', confirmed: true });
  });
  it('recovers from a worker connection failure without exposing the wallet', async () => {
    send.mockRejectedValueOnce(new Error('disconnected')); render(<VaultGate />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not connect');
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('New local passphrase');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
