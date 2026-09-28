import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/** Chrome exposes toolbar popups as "other" targets, not Playwright Page objects.
 * Use the documented CDP transport rather than widening extension host permissions. */
export async function openNativePopup(context: BrowserContext, merchant: Page, extensionId: string) {
  await merchant.bringToFront();
  const cdp = await context.browser()!.newBrowserCDPSession();
  const before = await cdp.send('Target.getTargets', { filter: [{}] });
  const tab = before.targetInfos.find((t) => t.type === 'tab' && t.url === merchant.url());
  if (!tab) throw new Error('Merchant tab target not found');
  let actionTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId }),
      new Promise<never>((_, reject) => {
        actionTimer = setTimeout(() => reject(new Error('Chrome toolbar action timed out')), 10000);
      }),
    ]);
  } catch (error) {
    await cdp.detach().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(actionTimer);
  }
  let targetId = '';
  await expect
    .poll(async () => {
      const targets = await cdp.send('Target.getTargets', { filter: [{}] });
      targetId =
        targets.targetInfos.find(
          (t) => t.type === 'other' && !before.targetInfos.some((old) => old.targetId === t.targetId),
        )?.targetId ?? '';
      return targetId;
    })
    .not.toBe('');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  async function send(method: string, params: Record<string, unknown>) {
    const id = ++sequence;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off('Target.receivedMessageFromTarget', receive);
        reject(new Error(`Popup ${method} timed out`));
      }, 8000);
      const receive = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        clearTimeout(timer);
        cdp.off('Target.receivedMessageFromTarget', receive);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      void cdp
        .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch((error) => {
          clearTimeout(timer);
          cdp.off('Target.receivedMessageFromTarget', receive);
          reject(error);
        });
    });
  }
  async function evaluate<T>(expression: string): Promise<T> {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return (reply.result as { value: T }).value;
  }
  await expect
    .poll(() => evaluate<string>('location.href').catch(() => ''), { timeout: 15000 })
    .toBe(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect.poll(() => evaluate<string>('document.body.innerText')).toContain('AI Checkout');
  return {
    evaluate,
    text: () => evaluate<string>('document.body.innerText'),
    click: async (name: string) => {
      await evaluate(
        `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(name)}); if (!button || button.disabled) throw Error('Button not available'); button.click(); })()`,
      );
    },
    fill: async (id: string, value: string) => {
      await evaluate(
        `(() => { const input = document.getElementById(${JSON.stringify(id)}); if (!input) throw Error('Input not found'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    },
    close: async () => {
      await cdp.send('Target.closeTarget', { targetId });
      // A close request can finish before Chrome destroys the native popup target.
      // Observe destruction before a caller immediately toggles the toolbar again.
      await expect
        .poll(async () =>
          (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos.some(
            (target) => target.targetId === targetId,
          ),
        )
        .toBe(false);
      await cdp.detach();
    },
    screenshot: async () => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(result.data as string, 'base64');
    },
  };
}
