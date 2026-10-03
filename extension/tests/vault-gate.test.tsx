import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VaultGate from '../src/components/VaultGate';
import { CATALOG_V2 } from '../src/domain';
import { emptyState } from '../src/state/contracts';
import { VAULT_SESSION_KEY } from '../src/state/vault-contracts';
import type { VaultStatus } from '../src/state/vault-contracts';

type Change = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let status: VaultStatus, listeners: Set<Change>;
const send = vi.fn();
const phrase = 'several unrelated words for testing';
const privateView = {
  ok: true,
  state: {
    ...emptyState(),
    wallet: {
      defaultCardId: 'capital-one-quicksilver',
      cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
    },
  },
  catalog: CATALOG_V2,
  comparison: null,
  notice: null,
  catalogUpdatesAvailable: false,
};
beforeEach(() => {
  status = 'unprotected';
  listeners = new Set();
  send.mockReset();
  send.mockImplementation(async (request: { type: string }) => {
    if (request.type === 'checkout:vault-create' || request.type === 'checkout:vault-unlock')
      status = 'unlocked';
    if (request.type === 'checkout:vault-lock') status = 'locked';
    if (request.type === 'checkout:vault-delete' || request.type === 'checkout:vault-remove')
      status = 'unprotected';
    if (request.type === 'settings:get')
      return { ok: true, settings: { schemaVersion: 1, disabledMerchants: [] } };
    return request.type === 'checkout:get-state' ? privateView : { ok: true, status };
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: send },
    storage: {
      onChanged: {
        addListener: (listener: Change) => listeners.add(listener),
        removeListener: (listener: Change) => listeners.delete(listener),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fillSetup(repeat = phrase) {
  fireEvent.change(screen.getByLabelText('New local passphrase'), { target: { value: phrase } });
  fireEvent.change(screen.getByLabelText('Confirm local passphrase'), { target: { value: repeat } });
}
function emitLock() {
  for (const listener of listeners) listener({ [VAULT_SESSION_KEY]: { oldValue: { id: 'old' } } }, 'session');
}

describe('local protection gate', () => {
  it('opens straight into the popup by default and protects from Settings only after confirmation', async () => {
    render(<VaultGate />);
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.getByText('Quicksilver')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lock saved inputs' })).toBeNull();
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByText('Passphrase protection: off')).toBeTruthy();
    fillSetup('different words entered here');
    fireEvent.click(screen.getByRole('button', { name: 'Protect with a passphrase' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('do not match'),
    );
    fillSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Protect with a passphrase' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('cannot be recovered'),
    );
    expect(send.mock.calls.some(([request]) => request.type === 'checkout:vault-create')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /cannot be recovered/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Protect with a passphrase' }));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'checkout:vault-create',
        passphrase: phrase,
        disclosureVersion: 1,
      }),
    );
  });
  it('lets an existing vault user turn protection off with the current passphrase', async () => {
    status = 'unlocked';
    render(<VaultGate />);
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.getByRole('button', { name: 'Lock saved inputs' })).toBeTruthy();
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByText('Passphrase protection: on')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Current passphrase'), { target: { value: phrase } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off passphrase protection' }));
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: 'checkout:vault-remove', passphrase: phrase }),
    );
  });
  it('clears a wrong passphrase and allows a successful unlock retry', async () => {
    status = 'locked';
    render(<VaultGate />);
    fireEvent.change(await screen.findByLabelText('Local passphrase'), { target: { value: phrase } });
    send.mockResolvedValueOnce({ ok: false, error: 'Could not unlock. Check your passphrase.' });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Could not unlock'),
    );
    expect((screen.getByLabelText('Local passphrase') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Local passphrase'), { target: { value: phrase } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('immediately unmounts private inputs when another window locks, even while status is pending', async () => {
    status = 'unlocked';
    render(<VaultGate />);
    await screen.findByLabelText('Purchase amount (USD)');
    let respond!: (value: unknown) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    act(() => emitLock());
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
    expect(screen.queryByText('Quicksilver')).toBeNull();
    await act(async () => respond({ ok: true, status: 'locked' }));
    await screen.findByLabelText('Local passphrase');
    cleanup();
    expect(listeners.size).toBe(0);
  });
  it('reports a failed lock instead of silently claiming the session is locked', async () => {
    status = 'unlocked';
    render(<VaultGate />);
    await screen.findByLabelText('Purchase amount (USD)');
    send.mockResolvedValueOnce({ ok: false, error: 'Protected storage could not be saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'Lock saved inputs' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
  });
  it('preserves a deletion error when locking emits a storage event before disk deletion fails', async () => {
    status = 'unlocked';
    render(<VaultGate />);
    await screen.findByLabelText('Purchase amount (USD)');
    fireEvent.click(screen.getByText('Delete saved data'));
    expect(
      (screen.getByRole('button', { name: 'Delete all local data' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(send.mock.calls.some(([request]) => request.type === 'checkout:vault-delete')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /I want to permanently delete/ }));
    send.mockImplementationOnce(async () => {
      status = 'locked';
      emitLock();
      return { ok: false, error: 'Protected storage could not be saved.' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete all local data' }));
    await screen.findByLabelText('Local passphrase');
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
  });
  it('requires explicit reset confirmation for damaged data and then starts fresh', async () => {
    status = 'damaged';
    render(<VaultGate />);
    await screen.findByText('Saved data could not be read');
    expect(screen.queryByLabelText('Local passphrase')).toBeNull();
    fireEvent.click(screen.getByText('Delete saved data'));
    const remove = screen.getByRole('button', { name: 'Delete all local data' });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I want to permanently delete/ }));
    fireEvent.click(remove);
    await screen.findByLabelText('Purchase amount (USD)');
    expect(send).toHaveBeenCalledWith({ type: 'checkout:vault-delete', confirmed: true });
  });
  it('recovers from a worker connection failure without exposing the wallet', async () => {
    send.mockRejectedValueOnce(new Error('disconnected'));
    render(<VaultGate />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not connect');
    expect(screen.queryByLabelText('Purchase amount (USD)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('Purchase amount (USD)');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
