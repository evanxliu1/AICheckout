// Every component and state on one page; e2e/gallery.spec.ts runs axe over it.
import { useState, type ReactNode } from 'react';
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
  type AlertColor,
  type BadgeColor,
  type ButtonColor,
  type IconName,
} from '../src';

const BUTTON_COLORS: ButtonColor[] = ['primary', 'secondary', 'tertiary', 'critical'];
const STATUS_COLORS: (BadgeColor & AlertColor)[] = ['neutral', 'highlight', 'success', 'warning', 'critical'];
const ICONS: IconName[] = [
  'alert-circle',
  'alert-diamond',
  'alert-triangle',
  'check-circle',
  'credit-card',
  'external-link',
  'help',
  'info',
  'lock',
  'search',
  'shopping-cart',
  'trash',
];

type CardRow = { id: string; name: string; issuer: string; rateBps: number };
const CARD_ROWS: CardRow[] = [
  { id: 'citi-double-cash', name: 'Citi Double Cash', issuer: 'Citi', rateBps: 200 },
  { id: 'amex-bce', name: 'Blue Cash Everyday', issuer: 'American Express', rateBps: 300 },
  { id: 'chase-freedom-unlimited', name: 'Freedom Unlimited', issuer: 'Chase', rateBps: 150 },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Buttons() {
  return (
    <Section id="buttons" title="Button">
      <div className="gallery-stack">
        {(['small', 'medium', 'large'] as const).map((size) => (
          <div key={size} className="gallery-row">
            {BUTTON_COLORS.map((color) => (
              <Button key={color} color={color} size={size} icon={color === 'tertiary' ? 'plus' : undefined}>
                {`${color} ${size}`}
              </Button>
            ))}
          </div>
        ))}
        <div className="gallery-row">
          <Button icon="arrow-right" iconPosition="trailing">
            Continue
          </Button>
          <Button color="secondary" icon="trash" isIconOnly>
            Delete card
          </Button>
          <Button isLoading>Saving</Button>
          <Button color="secondary" disabled>
            Disabled
          </Button>
          <Button color="tertiary" icon="plus" disabled>
            Disabled tertiary
          </Button>
        </div>
        <Button isFullWidth color="secondary">
          Full width
        </Button>
      </div>
    </Section>
  );
}

function Forms() {
  const [name, setName] = useState('');
  return (
    <Section id="forms" title="Form controls">
      <div className="gallery-grid">
        <Field label="Card nickname" helperText="Shown only on this device." isRequired>
          {(control) => (
            <TextInput {...control} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
        <Field label="Monthly spend" error="Enter an amount in dollars, like 250.">
          {(control) => <TextInput {...control} inputMode="decimal" defaultValue="abc" />}
        </Field>
        <Field label="Promo code" isOptional>
          {(control) => <TextInput {...control} placeholder="e.g. SPRING" />}
        </Field>
        <Field label="Read-only value">
          {(control) => <TextInput {...control} readOnly value="2026-10-01" />}
        </Field>
        <Field label="Disabled input">
          {(control) => <TextInput {...control} disabled value="Unavailable" />}
        </Field>
        <Field label="Merchant" helperText="Where you are checking out.">
          {(control) => (
            <Select {...control} defaultValue="best-buy-us">
              <option value="best-buy-us">Best Buy</option>
              <option value="newegg-us">Newegg</option>
              <option value="amazon-us">Amazon</option>
            </Select>
          )}
        </Field>
        <Field label="Payment path" error={['Choose how you will pay.', 'PayPal lowers confidence.']}>
          {(control) => (
            <Select {...control} defaultValue="">
              <option value="">Select one</option>
              <option value="card">Card</option>
              <option value="paypal">PayPal</option>
            </Select>
          )}
        </Field>
        <Field label="Disabled select">
          {(control) => (
            <Select {...control} disabled>
              <option>Card</option>
            </Select>
          )}
        </Field>
      </div>
      <h3>Checkbox, radio, toggle</h3>
      <div className="gallery-grid">
        <Fieldset legend="Cards in your wallet" helperText="Pick every card you carry." isRequired>
          <Checkbox label="Citi Double Cash" defaultChecked />
          <Checkbox label="Blue Cash Everyday" helperText="Enrolled in online retail." />
          <Checkbox label="Retired card" disabled defaultChecked />
          <Checkbox label="Unavailable card" disabled />
        </Fieldset>
        <Fieldset legend="Payment path" error="Pick a payment path.">
          <Radio name="path" value="card" label="Card" />
          <Radio name="path" value="paypal" label="PayPal" helperText="Bonus categories become uncertain." />
          <Radio name="path" value="bnpl" label="Buy now, pay later" disabled />
        </Fieldset>
        <Fieldset legend="Settings" layout="vertical">
          <Toggle label="Refresh the catalog automatically" defaultChecked />
          <Toggle label="Show rules that don't apply" />
          <Toggle label="Locked setting" disabled defaultChecked />
        </Fieldset>
        <Fieldset legend="Horizontal group" layout="horizontal" isOptional>
          <Checkbox label="Online" defaultChecked />
          <Checkbox label="In store" />
          <Checkbox label="Must accept terms" error="Required to continue." />
        </Fieldset>
      </div>
    </Section>
  );
}

function Badges() {
  return (
    <Section id="badges" title="Badge">
      <div className="gallery-stack">
        {(['filled', 'inverted', 'outlined'] as const).map((type) => (
          <div key={type} className="gallery-row">
            {STATUS_COLORS.map((color) => (
              <Badge key={color} color={color} type={type}>
                {`${color} ${type}`}
              </Badge>
            ))}
          </div>
        ))}
        <div className="gallery-row">
          <Badge size="small" color="success" icon="check-circle">
            Verified
          </Badge>
          <Badge size="medium" color="warning" icon="alert-triangle">
            Needs review
          </Badge>
          <Badge size="large" color="critical" icon="alert-diamond">
            Blocked
          </Badge>
          <Badge color="neutral" icon="lock" isIconOnly>
            Locked
          </Badge>
        </div>
      </div>
    </Section>
  );
}

function Alerts() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <Section id="alerts" title="AlertInline">
      <div className="gallery-stack">
        {STATUS_COLORS.map((color) => (
          <AlertInline key={color} color={color} title={`${color[0].toUpperCase()}${color.slice(1)} alert`}>
            Citi Double Cash earns 1% at purchase and 1% when the balance is paid.
          </AlertInline>
        ))}
        <AlertInline
          color="warning"
          title="Catalog expires soon"
          actions={
            <>
              <Button size="small" color="secondary">
                Refresh now
              </Button>
              <Link href="#alerts">What this means</Link>
            </>
          }
        >
          The bundled catalog was verified on 2026-09-28.
        </AlertInline>
        {dismissed ? null : (
          <AlertInline color="highlight" role="status" onDismiss={() => setDismissed(true)}>
            Description-only alert with a dismiss button.
          </AlertInline>
        )}
      </div>
    </Section>
  );
}

function Cards() {
  return (
    <Section id="cards" title="Card">
      <div className="gallery-grid">
        <Card hasBorder>
          <div className="gallery-card-body">
            <p>Base level with border</p>
          </div>
        </Card>
        <Card level="mid" levelHover="high" hasBorder>
          <div className="gallery-card-body">
            <p>Mid level, high on hover</p>
          </div>
        </Card>
        <Card level="high" background="neutral-secondary">
          <div className="gallery-card-body">
            <p>High level, secondary background</p>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Tables() {
  return (
    <Section id="tables" title="Table">
      <Table
        caption="Cards ranked by base rate"
        columns={[
          {
            key: 'name',
            label: 'Card',
            isRowHeader: true,
            sortValue: (row) => row.name,
            render: (row) => row.name,
          },
          { key: 'issuer', label: 'Issuer', render: (row) => row.issuer },
          {
            key: 'rate',
            label: 'Rate',
            align: 'right',
            sortValue: (row) => row.rateBps,
            render: (row) => `${(row.rateBps / 100).toFixed(1)}%`,
          },
          {
            key: 'status',
            label: 'Status',
            render: (row) => (
              <Badge size="small" color={row.rateBps >= 200 ? 'success' : 'neutral'}>
                {row.rateBps >= 200 ? 'Best' : 'Base'}
              </Badge>
            ),
          },
        ]}
        rows={CARD_ROWS}
        rowKey={(row) => row.id}
        initialSort={{ key: 'rate', direction: 'descending' }}
        isStriped
      />
      <h3>Short density, hidden caption</h3>
      <Table
        caption="Merchants"
        isCaptionHidden
        density="short"
        columns={[
          { key: 'name', label: 'Merchant', render: (row: { id: string }) => row.id },
          { key: 'mcc', label: 'MCC', align: 'right', render: () => '5732' },
        ]}
        rows={[{ id: 'best-buy-us' }, { id: 'newegg-us' }]}
        rowKey={(row) => row.id}
      />
    </Section>
  );
}

function TabsDemo() {
  return (
    <Section id="tabs" title="Tabs">
      <Tabs
        label="Draft views"
        tabs={[
          {
            id: 'diff',
            label: 'Diff',
            icon: 'swap-vertical',
            count: 3,
            content: <p>Three rules changed.</p>,
          },
          { id: 'json', label: 'JSON', content: <p>Raw catalog JSON.</p> },
          { id: 'sources', label: 'Sources', icon: 'external-link', content: <p>Issuer pages.</p> },
        ]}
      />
      <h3>Large</h3>
      <Tabs
        label="Platform"
        size="large"
        tabs={[
          { id: 'ext', label: 'Extension', content: <p>Popup screens.</p> },
          { id: 'review', label: 'Review app', content: <p>Reviewer screens.</p> },
        ]}
      />
    </Section>
  );
}

function ModalDemo() {
  const [open, setOpen] = useState<null | 'neutral' | 'critical'>(null);
  return (
    <Section id="modal" title="Modal">
      <div className="gallery-row">
        <Button onClick={() => setOpen('neutral')}>Open modal</Button>
        <Button color="critical" onClick={() => setOpen('critical')}>
          Open critical modal
        </Button>
      </div>
      <Modal
        isOpen={open !== null}
        onClose={() => setOpen(null)}
        color={open === 'critical' ? 'critical' : 'neutral'}
        icon={open === 'critical' ? 'alert-diamond' : undefined}
        tagline="Catalog 2026-10-01.real.1"
        title={open === 'critical' ? 'Discard this draft?' : 'Publish catalog?'}
        footer={
          <>
            <Button color={open === 'critical' ? 'critical' : 'primary'} onClick={() => setOpen(null)}>
              {open === 'critical' ? 'Discard' : 'Publish'}
            </Button>
            <Button color="secondary" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </>
        }
      >
        <p>Seven cards and three merchants will be served to every extension on its next refresh.</p>
        <Field label="Type the version to confirm">{(control) => <TextInput {...control} />}</Field>
      </Modal>
    </Section>
  );
}

function States() {
  return (
    <Section id="states" title="ApplicationState">
      <div className="gallery-grid">
        <Card hasBorder>
          <div className="gallery-card-body">
            <ApplicationState status="loading" titleTag="h3" title="Loading the catalog" />
          </div>
        </Card>
        <Card hasBorder>
          <div className="gallery-card-body">
            <ApplicationState
              status="empty"
              titleTag="h3"
              title="No cards yet"
              icon="credit-card"
              actions={<Button icon="plus">Add a card</Button>}
            >
              Add the cards you carry to compare rewards at checkout.
            </ApplicationState>
          </div>
        </Card>
        <Card hasBorder>
          <div className="gallery-card-body">
            <ApplicationState
              status="error"
              titleTag="h3"
              title="Couldn't reach the catalog"
              errorCode="503"
              align="center"
              actions={
                <>
                  <Button color="secondary">Try again</Button>
                  <Link variant="standalone" icon="help" href="#states">
                    Get help
                  </Link>
                </>
              }
            >
              The extension keeps using the bundled catalog until the service is back.
            </ApplicationState>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Links() {
  return (
    <Section id="links" title="Link">
      <div className="gallery-stack">
        <p>
          Read the <Link href="#links">privacy policy</Link> or the{' '}
          <Link href="https://github.com/evanxliu1/AICheckout" isExternal>
            source on GitHub
          </Link>
          . Secondary:{' '}
          <Link href="#links" color="secondary">
            support
          </Link>
          .
        </p>
        <div className="gallery-row">
          <Link variant="standalone" size="small" icon="arrow-right" iconPosition="trailing" href="#links">
            Small standalone
          </Link>
          <Link variant="standalone" icon="shopping-cart" href="#links">
            Medium standalone
          </Link>
          <Link variant="standalone" size="large" color="secondary" icon="info" href="#links">
            Large secondary
          </Link>
          <Link variant="standalone" href="https://helios.hashicorp.design" isExternal>
            Helios design system
          </Link>
        </div>
      </div>
    </Section>
  );
}

function Disclosures() {
  return (
    <Section id="disclosures" title="Disclosure">
      <div className="gallery-stack">
        <Disclosure title="Rules that don't apply here">
          <p>Supermarkets 6% (not at this merchant).</p>
        </Disclosure>
        <Disclosure title="Sources" titleTag="h3" open>
          <p>
            <Link href="#disclosures">Issuer terms, captured 2026-09-28</Link>
          </p>
        </Disclosure>
      </div>
    </Section>
  );
}

function Icons() {
  return (
    <Section id="icons" title="Icon">
      <div className="gallery-row">
        {ICONS.map((name) => (
          <Icon key={name} name={name} title={name} />
        ))}
        {ICONS.slice(0, 4).map((name) => (
          <Icon key={`${name}-24`} name={name} size={24} title={`${name} 24`} />
        ))}
        <Icon name="loading" title="Loading" />
      </div>
    </Section>
  );
}

export default function Gallery() {
  return (
    <main className="gallery">
      <h1>AI Checkout UI</h1>
      <p>
        React components built to the <Link href="https://helios.hashicorp.design">Helios design system</Link>{' '}
        specs with Helios tokens and Flight icons.
      </p>
      <Buttons />
      <Forms />
      <Badges />
      <Alerts />
      <Cards />
      <Tables />
      <TabsDemo />
      <ModalDemo />
      <States />
      <Links />
      <Disclosures />
      <Icons />
    </main>
  );
}
