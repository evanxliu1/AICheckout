import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import {
  AlertInline,
  ApplicationState,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  Disclosure,
  Field,
  Fieldset,
  Icon,
  Link,
  Modal,
  Radio,
  Select,
  Table,
  Tabs,
  TextInput,
  Toggle,
  matchesSearch,
  normalizeSearch,
} from '../src';

afterEach(cleanup);

describe('Icon', () => {
  it('is decorative by default and labelled when titled', () => {
    const { container } = render(<Icon name="info" />);
    expect(container.querySelector('svg')).toHaveProperty('ariaHidden', 'true');
    render(<Icon name="check-circle" size={24} title="Verified" />);
    const img = screen.getByRole('img', { name: 'Verified' });
    expect(img.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('falls back to the 16px drawing when no 24px variant is bundled', () => {
    render(<Icon name="x" size={24} title="Close" />);
    const img = screen.getByRole('img', { name: 'Close' });
    expect([img.getAttribute('width'), img.getAttribute('viewBox')]).toEqual(['24', '0 0 16 16']);
  });
});

describe('Button', () => {
  it('is a type=button button activated by Enter and Space', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('uses the text as the accessible name when icon-only', () => {
    render(
      <Button icon="trash" isIconOnly color="critical">
        Delete card
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete card' });
    expect(button.className).toContain('ac-button--critical');
    expect(button.textContent).toBe('');
  });

  it('keeps its name while loading and ignores activation', async () => {
    const onClick = vi.fn();
    render(
      <form onSubmit={onClick}>
        <Button type="submit" isLoading onClick={onClick}>
          Publish
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies size and full-width classes', () => {
    render(
      <Button size="small" isFullWidth color="secondary">
        Small
      </Button>,
    );
    expect(screen.getByRole('button').className).toMatch(/ac-button--small.*ac-button--full-width/);
  });
});

describe('Field and text controls', () => {
  it('wires label, helper text, error, and required state', () => {
    render(
      <Field label="Monthly spend" helperText="In dollars." error="Enter a number." isRequired>
        {(control) => <TextInput {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Monthly spend/ });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input).toHaveProperty('required', true);
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'In dollars.',
      'Enter a number.',
    ]);
    expect(input.className).toContain('ac-form-control--invalid');
  });

  it('omits aria-invalid and describedby when there is nothing to describe', () => {
    render(<Field label="Name">{(control) => <TextInput {...control} />}</Field>);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('labels a select and lists multiple errors', async () => {
    render(
      <Field label="Merchant" error={['Pick one.', 'Amazon is limited.']}>
        {(control) => (
          <Select {...control} defaultValue="">
            <option value="">Select</option>
            <option value="amazon-us">Amazon</option>
          </Select>
        )}
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Merchant' });
    await userEvent.selectOptions(select, 'amazon-us');
    expect((select as HTMLSelectElement).value).toBe('amazon-us');
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Pick one.Amazon is limited.',
    );
  });
});

describe('Checkbox, Radio, Toggle, Fieldset', () => {
  it('toggles a checkbox with Space and describes it', async () => {
    render(<Checkbox label="Citi Double Cash" helperText="2% total" />);
    const box = screen.getByRole('checkbox', { name: 'Citi Double Cash' });
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toHaveProperty('checked', true);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('2% total');
  });

  it('exposes Toggle as a switch', async () => {
    render(<Toggle label="Auto refresh" />);
    const toggle = screen.getByRole('switch', { name: 'Auto refresh' });
    await userEvent.click(screen.getByText('Auto refresh'));
    expect(toggle).toHaveProperty('checked', true);
  });

  it('groups radios under a legend (native radio group keyboard behavior)', async () => {
    render(
      <Fieldset legend="Payment path" helperText="How you pay." error="Pick one.">
        <Radio name="path" value="card" label="Card" />
        <Radio name="path" value="paypal" label="PayPal" />
      </Fieldset>,
    );
    const group = screen.getByRole('group', { name: 'Payment path' });
    expect(
      group
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent),
    ).toEqual(['How you pay.', 'Pick one.']);
    await userEvent.click(screen.getByRole('radio', { name: 'Card' }));
    await userEvent.click(screen.getByText('PayPal'));
    expect(screen.getByRole('radio', { name: 'Card' })).toHaveProperty('checked', false);
    expect(screen.getByRole('radio', { name: 'PayPal' })).toHaveProperty('checked', true);
  });
});

describe('Badge', () => {
  it('renders text, and keeps icon-only text for assistive technology', () => {
    render(
      <>
        <Badge color="success">Verified</Badge>
        <Badge icon="lock" isIconOnly>
          Locked
        </Badge>
      </>,
    );
    expect(screen.getByText('Verified').parentElement?.className).toContain('ac-badge--success-filled');
    expect(screen.getByText('Locked').className).toBe('ac-visually-hidden');
  });
});

describe('AlertInline', () => {
  it('uses role=alert for critical and no live role for neutral by default', () => {
    render(
      <>
        <AlertInline color="critical" title="Publish failed">
          Try again.
        </AlertInline>
        <AlertInline title="Heads up">Info.</AlertInline>
        <AlertInline color="neutral" role="status">
          Saved.
        </AlertInline>
      </>,
    );
    expect(screen.getByRole('alert', { name: 'Publish failed' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Saved.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('has a labelled dismiss button', async () => {
    const onDismiss = vi.fn();
    render(<AlertInline onDismiss={onDismiss}>Dismiss me.</AlertInline>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('Card', () => {
  it('renders as the requested element with level classes', () => {
    render(
      <ul>
        <Card as="li" level="mid" hasBorder>
          Item
        </Card>
      </ul>,
    );
    expect(screen.getByRole('listitem').className).toBe(
      'ac-card ac-card--level-mid ac-card--border ac-card--neutral-primary',
    );
  });
});

describe('Table', () => {
  type Row = { id: string; name: string; rate: number };
  const rows: Row[] = [
    { id: 'a', name: 'Beta', rate: 150 },
    { id: 'b', name: 'Alpha', rate: 300 },
    { id: 'c', name: 'Gamma', rate: 200 },
  ];
  const columns = [
    {
      key: 'name',
      label: 'Card',
      isRowHeader: true,
      sortValue: (r: Row) => r.name,
      render: (r: Row) => r.name,
    },
    { key: 'rate', label: 'Rate', sortValue: (r: Row) => r.rate, render: (r: Row) => String(r.rate) },
    { key: 'note', label: 'Note', render: () => '-' },
  ];

  it('has a caption, column and row headers, and sorts from the keyboard', async () => {
    render(<Table caption="Cards" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Cards' });
    expect(table).toBeTruthy();
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Beta',
      'Alpha',
      'Gamma',
    ]);
    expect(screen.queryByRole('button', { name: 'Note' })).toBeNull();

    screen.getByRole('button', { name: 'Rate' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('columnheader', { name: 'Rate' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Beta',
      'Gamma',
      'Alpha',
    ]);
    expect(table.querySelector('caption')?.textContent).toBe('Cards, sorted by Rate ascending');

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('columnheader', { name: 'Rate' }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getAllByRole('rowheader')[0].textContent).toBe('Alpha');
    expect(screen.getByRole('columnheader', { name: 'Card' }).hasAttribute('aria-sort')).toBe(false);
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'one', label: 'One', content: 'First panel' },
    { id: 'two', label: 'Two', count: 2, content: 'Second panel' },
    { id: 'three', label: 'Three', content: 'Third panel' },
  ];

  it('uses a roving tabindex and arrow/Home/End keys', async () => {
    const onChange = vi.fn();
    render(<Tabs label="Views" tabs={tabs} onChange={onChange} />);
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeTruthy();
    const [one, two, three] = screen.getAllByRole('tab');
    expect([one.tabIndex, two.tabIndex, three.tabIndex]).toEqual([0, -1, -1]);
    expect(screen.getByRole('tabpanel', { name: 'One' }).textContent).toBe('First panel');

    one.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(three);
    expect(three.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(one);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(three);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(one);
    await userEvent.click(two);
    expect(two.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel').textContent).toBe('Second panel');
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['three', 'one', 'three', 'one', 'two']);
  });

  it('supports controlled selection', async () => {
    function Controlled() {
      const [selected, setSelected] = useState('two');
      return <Tabs label="Views" tabs={tabs} selectedId={selected} onChange={setSelected} />;
    }
    render(<Controlled />);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Two2');
    await userEvent.click(screen.getByRole('tab', { name: 'Three' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Three');
  });
});

describe('Modal', () => {
  function Harness({ isDismissDisabled = false }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <p>Background</p>
        <Modal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Publish catalog?"
          isDismissDisabled={isDismissDisabled}
          footer={<button onClick={() => setOpen(false)}>Cancel</button>}
        >
          <input aria-label="Confirm" />
        </Modal>
      </>
    );
  }

  it('is a labelled modal dialog that traps focus, closes on Esc, and returns focus', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Publish catalog?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(document.activeElement).toBe(dismiss);
    expect(opener.closest('div')?.inert).toBe(true);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Confirm' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(dismiss);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.closest('div')?.inert).toBe(false);
  });

  it('ignores Esc and the dismiss button when dismissal is disabled', async () => {
    render(<Harness isDismissDisabled />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveProperty('disabled', true);
  });
});

describe('ApplicationState', () => {
  it('announces loading as a status and uses the chosen heading level', () => {
    render(
      <>
        <ApplicationState status="loading" title="Loading catalog" />
        <ApplicationState status="error" title="Offline" titleTag="h3" errorCode="503">
          Try later.
        </ApplicationState>
      </>,
    );
    expect(screen.getByRole('status').textContent).toBe('Loading catalog');
    expect(screen.getByRole('heading', { level: 3, name: 'Offline' })).toBeTruthy();
    expect(screen.getByText('Error 503')).toBeTruthy();
  });
});

describe('Link', () => {
  it('marks external links and adds safe rel', () => {
    render(
      <Link href="https://example.com" isExternal>
        Docs
      </Link>,
    );
    const link = screen.getByRole('link', { name: /^Docs\s*\(opens in a new tab\)$/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders standalone links with a leading icon', () => {
    render(
      <Link variant="standalone" icon="help" href="/support/">
        Support
      </Link>,
    );
    const link = screen.getByRole('link', { name: 'Support' });
    expect(link.className).toContain('ac-link--standalone');
    expect(link.firstElementChild?.getAttribute('data-icon')).toBe('help');
  });
});

describe('Disclosure', () => {
  it('toggles with the keyboard via native details/summary', async () => {
    render(
      <Disclosure title="Sources">
        <p>Issuer page</p>
      </Disclosure>,
    );
    const details = screen.getByText('Sources').closest('details')!;
    expect(details.open).toBe(false);
    await userEvent.click(screen.getByText('Sources'));
    expect(details.open).toBe(true);
  });
});

describe('review fixes', () => {
  it('Modal Tab order skips closed disclosure content, hidden elements, and extra radios', async () => {
    render(
      <Modal isOpen onClose={() => {}} title="Trap" footer={<button>Last</button>}>
        <Disclosure title="More">
          <input aria-label="Inside closed" />
        </Disclosure>
        <input aria-label="Hidden" hidden />
        <input type="radio" name="g" aria-label="R1" />
        <input type="radio" name="g" aria-label="R2" defaultChecked />
        <input type="radio" name="g" aria-label="R3" />
      </Modal>,
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(document.activeElement).toBe(dismiss);
    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      order.push(
        document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? null,
      );
    }
    expect(order).toEqual(['More', 'R2', 'Last', 'Dismiss']);
    await userEvent.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe('Last');

    screen.getByText('More').closest('details')!.open = true;
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Inside closed');
  });

  it('Modal handles Esc and Tab from the document when focus fell to body', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Esc">
        <p>Body</p>
      </Modal>,
    );
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Modal closes on overlay click and focuses initialFocusRef', async () => {
    function WithRef() {
      const [open, setOpen] = useState(true);
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Ref" initialFocusRef={ref}>
          <button ref={ref}>Confirm</button>
        </Modal>
      );
    }
    render(<WithRef />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
    await userEvent.click(document.querySelector('.ac-modal-overlay')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Modal cleans up portal, inert, and scroll lock when unmounted while open', () => {
    const { unmount } = render(
      <div data-testid="page">
        <Modal isOpen onClose={() => {}} title="Gone">
          <p>Body</p>
        </Modal>
      </div>,
    );
    const page = screen.getByTestId('page').parentElement!;
    expect(page.inert).toBe(true);
    expect(document.body.classList.contains('ac-modal-open')).toBe(true);
    unmount();
    expect(document.querySelector('.ac-modal-root')).toBeNull();
    expect(page.inert).toBe(false);
    expect(document.body.classList.contains('ac-modal-open')).toBe(false);
  });

  it('Modal keeps the scroll lock until the last of two modals closes; only the top handles Esc', async () => {
    const outerClose = vi.fn();
    function Nested() {
      const [inner, setInner] = useState(false);
      return (
        <Modal isOpen onClose={outerClose} title="Outer">
          <button onClick={() => setInner(true)}>Open inner</button>
          <Modal isOpen={inner} onClose={() => setInner(false)} title="Inner">
            <p>Inner body</p>
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    await userEvent.click(screen.getByRole('button', { name: 'Open inner' }));
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull();
    expect(outerClose).not.toHaveBeenCalled();
    expect(document.body.classList.contains('ac-modal-open')).toBe(true);
  });

  it('Tabs fall back to the first tab for an unknown default or a removed selected tab', async () => {
    const all = [
      { id: 'a', label: 'A', content: 'Panel A' },
      { id: 'b', label: 'B', content: 'Panel B' },
    ];
    const { rerender } = render(<Tabs label="T" tabs={all} defaultSelectedId="missing" />);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('A');
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    rerender(<Tabs label="T" tabs={[all[0]]} />);
    const only = screen.getByRole('tab', { name: 'A' });
    expect(only.getAttribute('aria-selected')).toBe('true');
    expect(only.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel A');
    rerender(<Tabs label="T" tabs={all} selectedId="gone" />);
    expect(screen.getByRole('tab', { name: 'A' }).tabIndex).toBe(0);
  });

  it('treats aria-invalid false/"false" as valid', () => {
    render(
      <>
        <TextInput aria-label="One" aria-invalid={false} />
        <TextInput aria-label="Two" aria-invalid="false" />
        <Select aria-label="Three" aria-invalid="false" />
        <Checkbox label="Four" aria-invalid="false" />
        <TextInput aria-label="Five" aria-invalid="true" />
      </>,
    );
    for (const name of ['One', 'Two'])
      expect(screen.getByRole('textbox', { name }).hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Three' }).hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Four' }).hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Five' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('Field merges describedBy and keeps a polite live region for errors that appear later', () => {
    const { rerender } = render(
      <>
        <p id="hint">Hint</p>
        <Field label="Amount" helperText="Dollars" describedBy="hint">
          {(control) => <TextInput {...control} />}
        </Field>
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Amount' });
    const errorId = input.id + '-error';
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-helper hint`);
    const region = document.getElementById(errorId)!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    rerender(
      <>
        <p id="hint">Hint</p>
        <Field label="Amount" helperText="Dollars" describedBy="hint" error="Too high.">
          {(control) => <TextInput {...control} />}
        </Field>
      </>,
    );
    expect(document.getElementById(errorId)).toBe(region);
    expect(region.textContent).toBe('Too high.');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-helper ${errorId} hint`);
  });

  it('Fieldset merges a consumer aria-describedby', () => {
    render(
      <Fieldset legend="Group" helperText="Help" aria-describedby="extra">
        <Checkbox label="One" />
      </Fieldset>,
    );
    expect(screen.getByRole('group', { name: 'Group' }).getAttribute('aria-describedby')).toMatch(
      /-helper extra$/,
    );
  });

  it('Button icon-only without a name throws; Icon with aria-label is a labelled image', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Button icon="trash" isIconOnly>
          {null}
        </Button>,
      ),
    ).toThrow(/accessible name/);
    render(
      <Button icon="trash" isIconOnly aria-label="Remove">
        {null}
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    render(<Icon name="lock" aria-label="Locked" />);
    expect(screen.getByRole('img', { name: 'Locked' }).hasAttribute('aria-hidden')).toBe(false);
  });

  it('Table does not re-sort on re-render with inline columns and unchanged rows', () => {
    const rows = [
      { id: 'a', n: 2 },
      { id: 'b', n: 1 },
    ];
    const sortValue = vi.fn((row: { n: number }) => row.n);
    const view = () => (
      <Table
        caption="N"
        columns={[{ key: 'n', label: 'N', sortValue, render: (row) => String(row.n) }]}
        rows={rows}
        rowKey={(row) => row.id}
        initialSort={{ key: 'n', direction: 'ascending' }}
      />
    );
    const { rerender } = render(view());
    const calls = sortValue.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    rerender(view());
    expect(sortValue.mock.calls.length).toBe(calls);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '2']);
  });
});

describe('Combobox', () => {
  const OPTIONS = [
    { id: 'dc', label: 'Citi Double Cash', group: 'Citi' },
    { id: 'cc', label: 'Citi Custom Cash', group: 'Citi' },
    { id: 'bce', label: 'Blue Cash Everyday', group: 'American Express', keywords: 'BCE' },
    { id: 'cabelas', label: 'Cabela’s CLUB', group: 'Capital One' },
  ];
  function Picker({ onSelect }: { onSelect: (id: string) => void }) {
    return (
      <Field label="Add a card" helperText="Type part of a name.">
        {(control) => (
          <Combobox
            {...control}
            listLabel="Matching cards"
            emptyText="No cards match"
            options={OPTIONS}
            onSelect={onSelect}
          />
        )}
      </Field>
    );
  }

  it('matches every typed word anywhere in the name, group or keywords', () => {
    expect(matchesSearch(OPTIONS[0], 'double')).toBe(true);
    expect(matchesSearch(OPTIONS[0], 'citi cash')).toBe(true);
    expect(matchesSearch(OPTIONS[0], 'custom')).toBe(false);
    expect(matchesSearch(OPTIONS[2], 'american bce')).toBe(true);
    expect(matchesSearch(OPTIONS[3], 'cabelas')).toBe(true);
    expect(matchesSearch(OPTIONS[3], 'CABELA’S club')).toBe(true);
    expect(normalizeSearch('Barnes & Noble')).toBe('barnes and noble');
  });

  it('filters as you type, groups matches, and picks with the keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Add a card' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toContain('helper');
    await user.type(input, 'cash');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox', { name: 'Matching cards' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Citi Double Cash',
      'Citi Custom Cash',
      'Blue Cash Everyday',
    ]);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'))).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'American Express' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('3 matches');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = screen.getByRole('option', { name: 'Citi Custom Cash' });
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(list.contains(active)).toBe(true);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Blue Cash Everyday' }).id,
    );
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('bce');
    expect((input as HTMLInputElement).value).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves through interleaved groups in the order they are shown', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Field label="Add a card">
        {(control) => (
          <Combobox
            {...control}
            listLabel="Matching cards"
            options={[OPTIONS[0], OPTIONS[2], OPTIONS[1]]}
            onSelect={onSelect}
          />
        )}
      </Field>,
    );
    const input = screen.getByRole('combobox', { name: 'Add a card' });
    await user.type(input, 'cash');
    const shown = screen.getAllByRole('option');
    expect(shown.map((o) => o.textContent)).toEqual([
      'Citi Double Cash',
      'Citi Custom Cash',
      'Blue Cash Everyday',
    ]);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(shown[1].id);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('cc');
  });

  it('says when nothing matches, closes on Escape, and picks by click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <form onSubmit={() => onSelect('submitted')}>
        <Picker onSelect={onSelect} />
      </form>,
    );
    const input = screen.getByRole('combobox', { name: 'Add a card' });
    await user.type(input, 'zzz');
    expect(screen.getByRole('status').textContent).toBe('No cards match');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'double');
    await user.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Escape}');
    expect((input as HTMLInputElement).value).toBe('');
    await user.type(input, 'every');
    await user.click(screen.getByRole('option', { name: 'Blue Cash Everyday' }));
    expect(onSelect).toHaveBeenCalledWith('bce');
    // A single match is picked with Enter alone.
    await user.type(input, 'double');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('dc');
  });
});
