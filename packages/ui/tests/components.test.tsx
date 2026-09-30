import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  AlertInline,
  ApplicationState,
  Badge,
  Button,
  Card,
  Checkbox,
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
