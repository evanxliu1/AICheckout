// The pages' side of usage reporting (Phase 15.3): typed requests to the worker, which builds every event.
import { telemetryResponseSchema } from './telemetry-contracts';
import type { TelemetryRequest, TelemetryStatus } from './telemetry-contracts';

export async function telemetryRequest(request: TelemetryRequest): Promise<TelemetryStatus> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch {
    throw new Error('The extension could not connect. Reopen it and try again.');
  }
  const parsed = telemetryResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error('The extension returned an unreadable response.');
  if (!parsed.data.ok) throw new Error(parsed.data.error);
  return parsed.data.status;
}
