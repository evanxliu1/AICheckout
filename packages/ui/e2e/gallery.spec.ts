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

    // Tab visits only reachable controls: closed disclosure content and unchecked radios are skipped.
    const name = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement;
        return el.getAttribute('aria-label') ?? (el.labels?.[0]?.textContent || el.textContent)?.trim();
      });
    const confirm = opener === 'Open modal' ? 'Publish' : 'Discard';
    const forward = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      forward.push(await name());
    }
    expect(forward).toEqual([
      'Changed rules',
      'No one',
      'Type the version to confirm',
      confirm,
      'Cancel',
      'Dismiss',
      'Changed rules',
    ]);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await name()).toBe('Cancel');

    // Opening the disclosure makes its field reachable.
    await dialog.getByText('Changed rules').click();
    await page.keyboard.press('Tab');
    expect(await name()).toBe('Reviewer note');
    await expectNoViolations(page);

    // Esc still closes when focus has fallen to <body>.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
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

test('the combobox filters, groups and picks from the keyboard with no axe violations', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Add a card' });
  await input.fill('cash');
  const list = page.getByRole('listbox', { name: 'Matching cards' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('group', { name: 'Citi' }).getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: '4 matches' })).toBeAttached();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /option-0/);
  await expectNoViolations(page);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Added: Citi Double Cash')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(list).toBeHidden();
  await input.fill('zzz');
  await expect(page.getByText('No cards match')).toBeVisible();
  await expectNoViolations(page);
});
