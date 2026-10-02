import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { openNativePopup } from './native-popup';
import { decryptVault, encryptVault } from '../src/state/vault-crypto';
import type { AppState } from '../src/state/contracts';

// Synthetic test passphrase only. The production build contains no test entry point.
export const TEST_PASSPHRASE = 'test-only river amber quiet notebook';
/** Passphrase protection is off by default: the popup opens straight into card setup. */
export async function startPopup(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your cards' })).toBeVisible();
}
/** Turns on the optional passphrase protection from the popup's Settings. */
export async function protectVault(page: Page) {
  await page.getByText('Settings', { exact: true }).click();
  await page.getByLabel('New local passphrase', { exact: true }).fill(TEST_PASSPHRASE);
  await page.getByLabel('Confirm local passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Protect with a passphrase' }).click();
  await expect(page.getByRole('button', { name: 'Lock saved inputs' })).toBeVisible();
}
export async function unlockVault(page: Page) {
  await page.getByLabel('Local passphrase', { exact: true }).fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock saved inputs' })).toBeVisible();
}
export async function startNativePopup(popup: Awaited<ReturnType<typeof openNativePopup>>) {
  await expect.poll(popup.text).toContain('Choose cards you already own');
}
/** Turns on passphrase protection in a native toolbar popup (CDP-driven, no Playwright locators). */
export async function protectNativeVault(popup: Awaited<ReturnType<typeof openNativePopup>>) {
  await popup.evaluate("document.querySelector('#popup-settings summary').click()");
  await popup.fill('vault-passphrase', TEST_PASSPHRASE);
  await popup.fill('vault-repeat', TEST_PASSPHRASE);
  await popup.evaluate(
    "[...document.querySelectorAll('#popup-settings label')].find(l => l.textContent.includes('cannot be recovered')).click()",
  );
  await popup.click('Protect with a passphrase');
  await expect.poll(popup.text).toContain('Lock saved inputs');
}
export async function deleteVault(page: Page) {
  await page.getByText('Delete saved data', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I want to permanently delete/ }).check();
  await page.getByRole('button', { name: 'Delete all local data' }).click();
}
export async function deleteNativeVault(popup: Awaited<ReturnType<typeof openNativePopup>>) {
  await popup.evaluate("document.querySelector('#delete-saved-data summary').click()");
  expect(await popup.evaluate("document.querySelector('#delete-saved-data button').disabled")).toBe(true);
  await popup.evaluate("document.querySelector('#delete-saved-data input').click()");
  await popup.click('Delete all local data');
}
type InspectionTarget = { evaluate<R, Arg>(fn: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R> };
async function snapshot(target: InspectionTarget): Promise<{ envelope: unknown; key: unknown }> {
  return target.evaluate(
    async () => ({
      envelope: (await chrome.storage.local.get('checkoutStateV1')).checkoutStateV1,
      key: (await chrome.storage.session.get('checkoutVaultSessionV1')).checkoutVaultSessionV1,
    }),
    undefined,
  );
}
// Fixture-only privileged inspection: decrypt in the test process, using the real
// format/crypto, without adding a bypass to the shipped worker or popup.
const encrypted = (value: unknown) => (value as { kind?: string } | undefined)?.kind === 'encrypted-vault';
/** The saved state, plain (the default) or decrypted when passphrase protection is on. */
export async function readVaultState(target: InspectionTarget): Promise<AppState> {
  const { envelope, key } = await snapshot(target);
  return encrypted(envelope)
    ? ((await decryptVault(envelope, key as never)) as AppState)
    : (envelope as AppState);
}
export async function mutateVaultState(target: InspectionTarget, mutate: (state: AppState) => void) {
  const { envelope, key } = await snapshot(target),
    state = encrypted(envelope)
      ? ((await decryptVault(envelope, key as never)) as AppState)
      : structuredClone(envelope as AppState);
  if (state.schemaVersion !== 2) throw new Error('Open the popup once so pilot-era state is migrated.');
  mutate(state);
  const value = encrypted(envelope) ? await encryptVault(state, envelope as never, key as never) : state;
  await target.evaluate((next) => chrome.storage.local.set({ checkoutStateV1: next }), value);
}
