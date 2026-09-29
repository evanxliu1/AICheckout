import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { openNativePopup } from './native-popup';
import { decryptVault, encryptVault } from '../src/state/vault-crypto';
import type { AppState } from '../src/state/contracts';

// Synthetic test passphrase only. The production build contains no test entry point.
export const TEST_PASSPHRASE = 'test-only river amber quiet notebook';
export async function createVault(page: Page) {
  await page.getByLabel('New local passphrase', { exact: true }).fill(TEST_PASSPHRASE);
  await page.getByLabel('Confirm local passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('checkbox', { name: /I agree to save/ }).check();
  await page.getByRole('button', { name: 'Protect saved inputs' }).click();
  await expect(page.getByRole('button', { name: 'Lock saved inputs' })).toBeVisible();
}
export async function unlockVault(page: Page) {
  await page.getByLabel('Local passphrase', { exact: true }).fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock saved inputs' })).toBeVisible();
}
export async function createNativeVault(popup: Awaited<ReturnType<typeof openNativePopup>>) {
  await expect.poll(popup.text).toContain('Protect your saved inputs');
  await popup.fill('vault-passphrase', TEST_PASSPHRASE);
  await popup.fill('vault-repeat', TEST_PASSPHRASE);
  await popup.evaluate("document.querySelector('input[type=checkbox]').click()");
  await popup.click('Protect saved inputs');
  await expect.poll(popup.text).toContain('Choose cards you already own');
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
async function snapshot(target: InspectionTarget) {
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
export async function readVaultState(target: InspectionTarget) {
  const { envelope, key } = await snapshot(target);
  return decryptVault(envelope, key);
}
export async function mutateVaultState(target: InspectionTarget, mutate: (state: AppState) => void) {
  const { envelope, key } = await snapshot(target),
    state = await decryptVault(envelope, key);
  mutate(state);
  const encrypted = await encryptVault(state, envelope, key);
  await target.evaluate((value) => chrome.storage.local.set({ checkoutStateV1: value }), encrypted);
}
