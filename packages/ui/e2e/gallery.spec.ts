// Accessibility gate for packages/ui: axe over the gallery (WCAG 2.0/2.1 A and AA rules) in its
// default state, with every disclosure open, and with each modal open.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary).toEqual([]);
}

for (const width of [360, 1280]) {
  test(`gallery has no axe violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'AI Checkout UI' })).toBeVisible();
    await expectNoViolations(page);
    // No horizontal page scroll; wide tables scroll inside a focusable region instead.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    for (const summary of await page.locator('summary').all()) {
      if (!(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)))
        await summary.click();
    }
    await expectNoViolations(page);
  });
}

for (const opener of ['Open modal', 'Open critical modal']) {
  test(`${opener}: focus is trapped, Esc closes, focus returns, no axe violations`, async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: opener, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await expectNoViolations(page);

    // Tab cycles within the dialog.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('tabs, radios, and the sortable table work from the keyboard', async ({ page }) => {
  await page.goto('/');
  const diff = page.getByRole('tab', { name: /Diff/ });
  await diff.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'JSON' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'JSON' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Sources/ })).toHaveAttribute('aria-selected', 'true');

  const card = page.getByRole('radio', { name: 'Card' });
  await card.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'PayPal' })).toBeChecked();

  const table = page.getByRole('table', { name: /Cards ranked by base rate/ });
  await table.getByRole('button', { name: 'Card' }).focus();
  await page.keyboard.press('Enter');
  await expect(table.getByRole('columnheader', { name: 'Card' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('rowheader').first()).toHaveText('Blue Cash Everyday');
});
