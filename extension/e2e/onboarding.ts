import { expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

/** A fresh install opens the onboarding tab; specs that do not test it close it first so it
 * cannot take focus from the merchant tab under test. */
export async function closeOnboarding(context: BrowserContext) {
  const find = () => context.pages().find((page) => page.url().endsWith('/src/onboarding/index.html'));
  await expect
    .poll(() => find() !== undefined, { timeout: 5000 })
    .toBe(true)
    .catch(() => undefined);
  await find()?.close();
}
