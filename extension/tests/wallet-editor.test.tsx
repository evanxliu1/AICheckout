import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletEditor from '../src/components/WalletEditor';
import {
  formatCentsEach,
  gateQuestions,
  parseCentsEach,
  unvaluedPrograms,
} from '../src/components/wallet-options';
import { CATALOG_V2 } from '../src/domain';
import type { CatalogV3, Wallet } from '../src/domain';
import { CATALOG_V3_FIXTURE } from '../../packages/rewards-core/test-cases';
import { largeCatalogV3 } from '../../packages/rewards-core/large-catalog-fixture';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T15:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const empty: Wallet = { defaultCardId: null, cards: [] };
function editor(catalog: CatalogV3 | typeof CATALOG_V2, wallet: Wallet = empty) {
  const onSave = vi.fn<(wallet: Wallet) => Promise<void>>(async () => {});
  render(<WalletEditor catalog={catalog} wallet={wallet} busy={false} onSave={onSave} />);
  return { onSave, user: userEvent.setup() };
}
const search = () => screen.getByRole('combobox', { name: 'Add a card' });
async function add(user: ReturnType<typeof userEvent.setup>, text: string, name: string) {
  // The field is empty after each pick; clearing it would open the whole list.
  await user.click(search());
  await user.paste(text);
  await user.click(screen.getByRole('option', { name }));
}
const saved = (onSave: ReturnType<typeof editor>['onSave']) => onSave.mock.calls.at(-1)![0];

describe('wallet editor: search and add', () => {
  it('finds a card by part of its name or its bank, grouped by issuer, and adds it', async () => {
    const { user, onSave } = editor(CATALOG_V2);
    expect(screen.getByText('No cards yet. Add each card you might pay with.')).toBeTruthy();
    await user.type(search(), 'blue');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'American Express Blue Cash Everyday',
      'American Express Blue Cash Preferred',
    ]);
    expect(screen.getByRole('group', { name: 'American Express' })).toBeTruthy();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText('Added American Express Blue Cash Everyday. 1 of 20 cards.')).toBeTruthy();
    const list = screen.getByRole('list');
    expect(within(list).getByText('American Express Blue Cash Everyday')).toBeTruthy();
    // Rule-derived limits appear for the added card only.
    expect(screen.getByLabelText(/Blue Cash Everyday online retail spend this year/)).toBeTruthy();
    expect(screen.queryByLabelText(/bonus activation/)).toBeNull();
    // An added card is no longer offered.
    await user.type(search(), 'blue');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'American Express Blue Cash Preferred',
    ]);
    await user.keyboard('{Escape}{Escape}');
    await add(user, 'citi', 'Citi Double Cash');
    expect(screen.getByLabelText('Default card')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove American Express Blue Cash Everyday' }));
    expect(document.activeElement).toBe(search());
    expect(screen.queryByLabelText(/online retail spend/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(saved(onSave)).toEqual({
      defaultCardId: 'citi-double-cash',
      cards: [{ cardId: 'citi-double-cash', usage: [] }],
    });
  });

  it('searches 180 cards and stops at the 20-card limit', async () => {
    const { user } = editor(largeCatalogV3({ day: '2026-10-15' }));
    expect(screen.getByText(/\(180 cards\)/)).toBeTruthy();
    await user.type(search(), 'card 017');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Synthetic Card 017']);
    await user.keyboard('{Enter}');
    for (const n of [...Array(20).keys()]
      .map((i) => String(i + 1).padStart(3, '0'))
      .filter((n) => n !== '017'))
      await add(user, n, `Synthetic Card ${n}`);
    expect(screen.getByRole('heading', { name: 'Cards you own (20)' })).toBeTruthy();
    expect((search() as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('You can save up to 20 cards. Remove one to add another.')).toBeTruthy();
    // The disabled search field loses focus; it moves to the list of cards, then back on remove.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Cards you own (20)' }));
    await user.click(screen.getByRole('button', { name: 'Remove Synthetic Card 005' }));
    expect(document.activeElement).toBe(search());
  }, 20_000);
});

describe('wallet editor: catalog v3 options', () => {
  it('asks chosen categories per card, each membership question once, and saves the answers', async () => {
    const catalog = structuredClone(CATALOG_V3_FIXTURE);
    catalog.cards.find((c) => c.id === 'test-cash-plus')!.choices[0].defaultOptionIds = ['electronics'];
    const { user, onSave } = editor(catalog);
    await add(user, 'prime', 'Test Prime Visa');
    await add(user, 'amazon store', 'Test Amazon Store Card');
    await add(user, 'store master', 'Test Store Mastercard');
    // One question for both Amazon cards; the Test Store tier is not asked: no catalog merchant
    // is a Test Store, so the answer could not change any estimate.
    const prime = screen.getByRole('group', { name: 'Do you have an eligible Amazon Prime membership?' });
    expect(within(prime).getByText('Affects Prime Visa, Amazon Store.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Test Store loyalty tier/ })).toBeNull();
    expect(screen.getAllByRole('group', { name: /Amazon Prime/ })).toHaveLength(1);
    expect((within(prime).getByRole('radio', { name: 'Not sure' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(prime).getByRole('radio', { name: 'Prime member' }));

    await add(user, 'cash plus', 'Test Cash Plus');
    const options = screen.getByRole('group', { name: 'Cash Plus: Two 5% categories, chosen each quarter' });
    expect(options.textContent).toContain('Filled in with the card’s default');
    expect(
      (within(options).getByRole('checkbox', { name: 'Electronics stores' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(within(options).getByRole('checkbox', { name: 'Fast food' }));
    // Two picks reached: the third option waits.
    expect(
      (within(options).getByRole('checkbox', { name: 'Department stores' }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(options.textContent).not.toContain('Filled in with the card’s default');
    // Only the chosen categories' limits are asked.
    expect(screen.getByLabelText('Cash Plus electronics store bonus activation')).toBeTruthy();
    expect(screen.queryByLabelText('Cash Plus department store bonus activation')).toBeNull();
    // The combined limit is recorded on the department-store rule (the group's smallest ID), so its
    // spend field stays while another category of the group is chosen.
    expect(screen.getByLabelText(/Cash Plus combined electronics store spend this quarter/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    const wallet = saved(onSave);
    expect(wallet.gates).toEqual([{ gateId: 'amazon-prime', optionId: 'member' }]);
    expect(wallet.cards.find((c) => c.cardId === 'test-cash-plus')!.choices).toEqual([
      { choiceId: 'five-percent', optionIds: ['electronics', 'fast-food'] },
    ]);
    expect(wallet.valueOverrides).toEqual([]);
  });

  it('keeps "not sure" unanswered and asks nothing for cards without options', async () => {
    const { user, onSave } = editor(CATALOG_V3_FIXTURE, {
      defaultCardId: 'test-prime-visa',
      cards: [{ cardId: 'test-prime-visa', usage: [] }],
      gates: [{ gateId: 'amazon-prime', optionId: 'not-member' }],
    });
    const prime = screen.getByRole('group', { name: /Amazon Prime/ });
    expect(
      (within(prime).getByRole('radio', { name: 'No Prime membership' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(within(prime).getByRole('radio', { name: 'Not sure' }));
    await user.click(screen.getByRole('button', { name: 'Remove Test Prime Visa' }));
    await add(user, 'paypal', 'Test PayPal Cashback');
    expect(screen.queryByRole('heading', { name: 'Card options' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'About you' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Point values' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(saved(onSave)).toMatchObject({
      cards: [{ cardId: 'test-paypal-cashback', usage: [], choices: [] }],
      gates: [],
      valueOverrides: [],
    });
  });

  it('lists point values with their basis, asks for a value where none is published, and resets', async () => {
    const { user, onSave } = editor(CATALOG_V3_FIXTURE);
    await add(user, 'points card', 'Test Points Card');
    await add(user, 'store master', 'Test Store Mastercard');
    await add(user, 'automatic', 'Test Automatic Top Category');
    const section = screen.getByRole('region', { name: 'Point values' });
    expect(section.textContent).toContain(
      'Estimate 1.2¢ each, estimated by Example Valuations (read Oct 1, 2026).',
    );
    expect(section.textContent).toContain('Issuer-stated 1¢ each, stated by the issuer.');
    expect(section.textContent).toContain(
      'Issuer-stated 1¢ each with Store Mastercard, stated by the issuer.',
    );
    expect(section.textContent).toContain(
      'No published value Set one to compare these miles with cash back.',
    );
    const miles = screen.getByLabelText(
      'Your value for Test Airline Miles, in cents each',
    ) as HTMLInputElement;
    expect(miles.placeholder).toBe('Not set');
    expect(
      (screen.getByLabelText('Your value for Test Membership Points, in cents each') as HTMLInputElement)
        .placeholder,
    ).toBe('1.2');
    const reset = screen.getByRole('button', { name: 'Reset to default: Test Airline Miles' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    await user.type(miles, 'abc');
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(screen.getByRole('alert').textContent).toMatch(
      /Enter a value for Test Airline Miles from 0\.01 to 100 cents/,
    );
    await user.clear(miles);
    await user.type(miles, '1.25');
    expect(section.textContent).not.toContain('No published value');
    await user.type(screen.getByLabelText('Your value for Test Membership Points, in cents each'), '2');
    await user.click(screen.getByRole('button', { name: 'Reset to default: Test Membership Points' }));
    expect(document.activeElement).toBe(
      screen.getByLabelText('Your value for Test Membership Points, in cents each'),
    );
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(saved(onSave).valueOverrides).toEqual([
      { programId: 'test-airline-miles', valueHundredthsOfCent: 125 },
    ]);
  });

  it('shows a saved value in cents and reports unvalued programs for the popup', () => {
    const wallet: Wallet = {
      defaultCardId: null,
      cards: [{ cardId: 'test-auto-top', usage: [] }],
      valueOverrides: [{ programId: 'test-airline-miles', valueHundredthsOfCent: 150 }],
    };
    editor(CATALOG_V3_FIXTURE, wallet);
    expect((screen.getByLabelText(/Your value for Test Airline Miles/) as HTMLInputElement).value).toBe(
      '1.5',
    );
    expect(unvaluedPrograms(CATALOG_V3_FIXTURE, wallet)).toEqual([]);
    expect(unvaluedPrograms(CATALOG_V3_FIXTURE, { cards: wallet.cards }).map((p) => p.id)).toEqual([
      'test-airline-miles',
    ]);
    expect(gateQuestions(CATALOG_V2, ['citi-double-cash'])).toEqual([]);
  });
});

describe('point value parsing', () => {
  it('reads cents with up to two decimals as hundredths of a cent', () => {
    expect(parseCentsEach('1.25')).toBe(125);
    expect(parseCentsEach('1.5')).toBe(150);
    expect(parseCentsEach(' 2 ')).toBe(200);
    expect(parseCentsEach('.8')).toBe(80);
    expect(parseCentsEach('0.01')).toBe(1);
    expect(parseCentsEach('100')).toBe(10_000);
    expect(parseCentsEach('1.2¢')).toBe(120);
    for (const bad of ['0', '0.001', '100.01', '1,5', '-1', 'abc', '', '1.234'])
      expect(parseCentsEach(bad)).toBeNull();
    expect([150, 125, 100, 66].map(formatCentsEach)).toEqual(['1.5', '1.25', '1', '0.66']);
  });
});

describe('wallet editor: answers the form does not ask, values and failures (M7 review)', () => {
  it('keeps saved choices, gate answers and point values the catalog in effect does not ask', async () => {
    const wallet: Wallet = {
      defaultCardId: 'test-prime-visa',
      cards: [
        {
          cardId: 'test-prime-visa',
          usage: [],
          choices: [{ choiceId: 'from-a-newer-catalog', optionIds: ['kept'] }],
        },
      ],
      gates: [
        { gateId: 'amazon-prime', optionId: 'member' },
        { gateId: 'from-a-newer-catalog', optionId: 'kept' },
      ],
      valueOverrides: [{ programId: 'from-a-newer-catalog', valueHundredthsOfCent: 150 }],
    };
    const { user, onSave } = editor(CATALOG_V3_FIXTURE, wallet);
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(saved(onSave)).toMatchObject({
      cards: [
        { cardId: 'test-prime-visa', choices: [{ choiceId: 'from-a-newer-catalog', optionIds: ['kept'] }] },
      ],
      gates: [
        { gateId: 'amazon-prime', optionId: 'member' },
        { gateId: 'from-a-newer-catalog', optionId: 'kept' },
      ],
      valueOverrides: [{ programId: 'from-a-newer-catalog', valueHundredthsOfCent: 150 }],
    });
    cleanup();
    // An older (v2) catalog in effect asks none of them; saving keeps them all.
    const v2 = editor(CATALOG_V2, {
      ...wallet,
      defaultCardId: 'citi-double-cash',
      cards: [{ cardId: 'citi-double-cash', usage: [], choices: wallet.cards[0].choices }],
    });
    await v2.user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(saved(v2.onSave)).toMatchObject({
      cards: [
        { cardId: 'citi-double-cash', choices: [{ choiceId: 'from-a-newer-catalog', optionIds: ['kept'] }] },
      ],
      gates: wallet.gates,
      valueOverrides: wallet.valueOverrides,
    });
  });

  it('shows the card’s own stated value as the default, which the engine uses first', async () => {
    const catalog = structuredClone(CATALOG_V3_FIXTURE);
    catalog.cards.find((c) => c.id === 'test-points-card')!.statedValueHundredthsOfCent = 60;
    const { user } = editor(catalog);
    await add(user, 'points card', 'Test Points Card');
    const field = screen.getByLabelText(
      'Your value for Test Membership Points, in cents each',
    ) as HTMLInputElement;
    expect(field.placeholder).toBe('0.6');
  });

  it('takes a card back out when its terms cannot be loaded, and says so', async () => {
    const loadCards = vi.fn(async () => {
      throw new Error('The extension could not connect. Reopen it and try again.');
    });
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <WalletEditor
        catalog={{ ...CATALOG_V3_FIXTURE, cards: [] }}
        index={CATALOG_V3_FIXTURE.cards.map((c) => ({
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          issuer: c.issuer,
        }))}
        loadCards={loadCards}
        wallet={empty}
        busy={false}
        onSave={onSave}
      />,
    );
    await add(user, 'points card', 'Test Points Card');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The card terms could not be loaded. The extension could not connect. Reopen it and try again.',
    );
    expect(screen.getByText('No cards yet. Add each card you might pay with.')).toBeTruthy();
    expect(screen.getByText('Could not add Test Points Card.')).toBeTruthy();
    expect(document.activeElement).toBe(search());
  });
});
