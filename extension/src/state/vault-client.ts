import { vaultResponseSchema } from './vault-contracts';
import type { VaultRequest } from './vault-contracts';

export async function requestVault(request: VaultRequest) {
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
