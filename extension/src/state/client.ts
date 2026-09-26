import { responseSchema } from './contracts';
import type { CheckoutRequest, CheckoutResponse } from './contracts';

export async function checkoutRequest(request: CheckoutRequest): Promise<Extract<CheckoutResponse, { ok: true }>> {
  let response: CheckoutResponse;
  try { response = await chrome.runtime.sendMessage(request); }
  catch { throw new Error('The extension could not connect. Reopen it and try again.'); }
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new Error('The extension returned an unreadable response.');
  response = parsed.data;
  if (!response.ok) throw new Error(response.error || 'The request could not be completed.');
  return response;
}
