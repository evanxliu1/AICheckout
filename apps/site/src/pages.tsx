import type { ReactNode } from 'react';
import { AlertInline, Badge, Card, Link, Table, type TableColumn } from '@ai-checkout/ui';
import { Layout, PageIntro, REPO, type PageId } from './Layout';
import { ResultsChart, rowLabel } from './Chart';
import { SystemsDiagram } from './Diagram';
import { percent, resultRows, resultsFile, seconds, type ResultRow } from './results';

const CARDS = [
  'Citi Double Cash',
  'Wells Fargo Active Cash',
  'Capital One Quicksilver',
  'Capital One Savor',
  'Chase Freedom Unlimited',
  'American Express Blue Cash Everyday',
  'American Express Blue Cash Preferred',
];
const MERCHANTS = ['Amazon US', 'Best Buy US', 'Newegg US'];
const RESULTS_MD = `${REPO}/blob/main/docs/evals/results.md`;

export type Rendered = { title: string; description: string; body: ReactNode };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

const SCREENSHOTS = [
  {
    src: '/media/2-comparison.png',
    alt: 'Extension popup recommending Blue Cash Everyday at $3.00 on a $100 Best Buy purchase, quoting the issuer rule and its conditions: U.S. merchants only, up to $6,000 per year then 1%.',
    caption: 'The best card for this purchase, with the rule in the issuer’s words and its conditions.',
  },
  {
    src: '/media/3-uncertainty.png',
    alt: 'Extension popup titled Compare the conditions: with annual spend unknown, Double Cash leads at $2.00 because another card’s estimate is a range.',
    caption: 'Unknown spend toward a cap becomes a range, not a guess.',
  },
  {
    src: '/media/1-wallet.png',
    alt: 'Extension wallet setup listing the seven supported cards grouped by issuer.',
    caption: 'Pick the cards you already have. No card numbers or bank login.',
  },
  {
    src: '/media/4-subtotal.png',
    alt: 'Extension popup reading a Newegg cart subtotal and noting that tax and shipping are excluded.',
    caption: 'Reads the cart’s order summary when you click, and says when it is only a subtotal.',
  },
];

function Home(): Rendered {
  return {
    title: 'AI Checkout: the best card you already own, at checkout',
    description:
      'A Chrome extension that compares the cash-back cards you already have at an online checkout, with rules reviewed by a human from the issuers’ own terms.',
    body: (
      <>
        <div className="hero">
          <PageIntro eyebrow="Chrome extension" title="Which card you already own earns the most here?">
            <p>
              AI Checkout compares the cash-back cards in your wallet on the purchase in front of you and
              shows the reward, the issuer rule behind it and its conditions. The math runs on your device; no
              model and no account are involved at checkout.
            </p>
          </PageIntro>
          <Card hasBorder className="install">
            <div className="install__head">
              <h2 className="install__title">Install</h2>
              <Badge color="neutral">Coming soon</Badge>
            </div>
            <p>
              The Chrome Web Store listing is not published yet. Until it is, you can build the extension from
              source and load it unpacked.
            </p>
            <Link href={`${REPO}#run-it`} variant="standalone" icon="arrow-right" isExternal>
              Build from source
            </Link>
          </Card>
        </div>

        <Section id="what" title="What it does">
          <ul className="feature-grid">
            <Card as="li" hasBorder className="feature">
              <h3>Compares your cards</h3>
              <p>
                Choose the cards you have once. At checkout, AI Checkout ranks them by the reward this
                purchase is guaranteed to earn.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Reads the cart on request</h3>
              <p>
                On {MERCHANTS.join(', ').replace(/, (?=[^,]*$)/, ' and ')} it reads the order summary amount
                when you click, and you confirm it. It never reads item names, addresses or payment fields.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Shows its reasons</h3>
              <p>
                Each estimate quotes the issuer’s rule and lists its conditions, the rules that do not apply
                at this merchant, and links to the issuer’s pages.
              </p>
            </Card>
          </ul>
        </Section>

        <Section id="how" title="How it decides">
          <ol className="steps">
            <li>
              <strong>Rules from issuer terms, reviewed by a person.</strong> Each card’s earning rules
              (category, rate, spending cap, activation, U.S.-only) come from a catalog built from the
              issuers’ published terms. A language model drafts changes with quotes, automated checks verify
              every quote, and a person approves each release.{' '}
              <Link href="/architecture/">How the catalog is maintained</Link>
            </li>
            <li>
              <strong>Deterministic math at checkout.</strong> A small engine works in whole cents and basis
              points. It applies only the rules that can apply to this merchant and payment method, honors
              spending caps and the rate after a cap, and counts a reward paid when you pay your bill (Citi’s
              second 1%) with a note saying so.
            </li>
            <li>
              <strong>Unknowns stay visible.</strong> If it doesn’t know how much of a cap you’ve used,
              whether a bonus is activated, or how PayPal or buy-now-pay-later will post, it shows a range and
              ranks by the lower end instead of guessing.
            </li>
          </ol>
        </Section>

        <Section id="screens" title="What you see">
          <p className="muted">
            Actual popup captures with sample inputs; the amounts are estimates, not earned rewards.
          </p>
          <ul className="screens">
            {SCREENSHOTS.map((shot) => (
              <li key={shot.src}>
                <figure>
                  <img src={shot.src} alt={shot.alt} width="640" height="400" loading="lazy" />
                  <figcaption>{shot.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="scope" title="Supported today">
          <div className="two-up">
            <div>
              <h3>Cards</h3>
              <ul className="plain-list">
                {CARDS.map((card) => (
                  <li key={card}>{card}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Checkouts</h3>
              <ul className="plain-list">
                {MERCHANTS.map((merchant) => (
                  <li key={merchant}>{merchant} cart</li>
                ))}
              </ul>
              <p className="muted small">
                U.S. purchases in U.S. dollars. Anywhere else you can type the amount yourself.
              </p>
            </div>
          </div>
        </Section>

        <Section id="measured" title="How well the model reads terms">
          <p>
            The catalog pipeline was measured on real issuer terms for the seven cards, across five models and
            three prompts. <Link href="/results/">See the results, including what they don’t show</Link>
          </p>
        </Section>
      </>
    ),
  };
}

const columns = (split: 'dev' | 'heldout'): TableColumn<ResultRow>[] => [
  {
    key: 'config',
    label: 'Configuration',
    isRowHeader: true,
    render: (row) => (
      <>
        <span className="config__model">{row.model}</span>
        <span className="config__meta">
          {row.prompt} · {row.selection}
        </span>
        {row.addedAfter ? (
          <Badge color="warning" size="small">
            Added after
          </Badge>
        ) : null}
      </>
    ),
  },
  { key: 'runs', label: 'Runs', align: 'right', render: (row) => row.runs },
  {
    key: 'field',
    label: 'Field acc. (e2e)',
    align: 'right',
    render: (row) => <strong>{percent(row.fieldAccuracy)}</strong>,
  },
  { key: 'recall', label: 'Rule recall', align: 'right', render: (row) => percent(row.ruleRecall) },
  { key: 'claim', label: 'Claim prec.', align: 'right', render: (row) => percent(row.claimPrecision) },
  {
    key: 'evidence',
    label: 'Evidence valid',
    align: 'right',
    render: (row) => percent(row.evidenceValidity),
  },
  { key: 'issues', label: 'Issue recall', align: 'right', render: (row) => percent(row.issueRecall) },
  {
    key: 'injection',
    label: 'Injection reported',
    align: 'right',
    render: (row) => percent(row.injectionRecall),
  },
  { key: 'clean', label: 'False-clean', align: 'right', render: (row) => row.falseClean },
  {
    key: 'latency',
    label: 'p50 / p95',
    align: 'right',
    render: (row) => `${seconds(row.p50Ms)} / ${seconds(row.p95Ms)}`,
  },
  ...(split === 'dev'
    ? []
    : [
        {
          key: 'harness',
          label: 'Harness fail.',
          align: 'right' as const,
          render: (row: ResultRow) => row.harnessFailures,
        },
      ]),
];

function Results(): Rendered {
  const rows = resultRows();
  const dev = rows.filter((row) => row.split === 'dev');
  const heldout = rows.filter((row) => row.split === 'heldout');
  const added = rows.filter((row) => row.addedAfter);
  const measured = resultsFile.generatedAt.slice(0, 10);
  return {
    title: 'Results: how well models read card terms · AI Checkout',
    description:
      'Extraction results on real issuer terms for seven cards: five models, three prompts, dev and held-out splits, with limitations.',
    body: (
      <>
        <PageIntro eyebrow="Evaluation" title="How well models read card terms">
          <p>
            Each configuration read the captured terms pages for seven U.S. cash-back cards and returned every
            earning rule with verbatim quotes. A scorer compared each field with reference labels and checked
            that every quote exists in the source. All numbers below come from{' '}
            <Link href="/results/results.json">results.json</Link> (scorer {resultsFile.scorerVersion}, corpus{' '}
            {resultsFile.corpus.version}, generated {measured}).
          </p>
        </PageIntro>

        <AlertInline color="warning" title="Read these numbers with care" role="none">
          <ul className="caveats">
            <li>
              <strong>Labels are agent-verified, not human-verified.</strong> An agent drafted them and seven
              reviewer agents checked them against the captures.
            </li>
            <li>
              <strong>Small sample:</strong> seven cards (n=7), 37 cases, two repeats per case (one for Opus).
              Variants such as prompt injections are planted edits of real pages.
            </li>
            <li>
              <strong>Noise is about ±3 points.</strong> Repeat-to-repeat differences reached 5.8 points;
              treat gaps under 3 points as ties. No confidence intervals are computed.
            </li>
            {added.length ? (
              <li>
                <strong>Opus was added after.</strong> Claude Opus 5.5 was run on the held-out split after the
                other held-out results had been seen; it was never part of the original choice.
              </li>
            ) : null}
          </ul>
        </AlertInline>

        <Section id="dev" title="Dev split">
          <p>
            Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver and Savor: 20 cases. Prompts
            were written and changed on this split only.
          </p>
          <Table
            caption="Dev results by model, prompt and source selection"
            isCaptionHidden
            columns={columns('dev')}
            rows={dev}
            rowKey={(row) => row.id}
            density="short"
            className="results-table"
          />
        </Section>

        <Section id="heldout" title="Held-out split">
          <p>
            Chase Freedom Unlimited and American Express Blue Cash Everyday and Preferred: 17 cases, run once
            per chosen configuration after the prompts were frozen.
          </p>
          <Table
            caption="Held-out results by model, prompt and source selection"
            isCaptionHidden
            columns={columns('heldout')}
            rows={heldout}
            rowKey={(row) => row.id}
            density="short"
            className="results-table"
          />
          <p className="muted small">
            Field acc. (e2e) counts every field of a missed rule as wrong. Claim precision is the share of
            stated values that are correct and cite a quote found in the source. False-clean counts runs the
            checks passed although something was wrong. Latency is wall-clock through the vendor CLIs.
          </p>
        </Section>

        <Section id="charts" title="Charts">
          <div className="charts">
            <ResultsChart id="chart-dev" title="Dev split" rows={dev} />
            <ResultsChart id="chart-heldout" title="Held-out split" rows={heldout} />
          </div>
          <p className="small">
            The same charts as images: <Link href="/results/results.svg">dev (SVG)</Link> and{' '}
            <Link href="/results/results-heldout.svg">held-out (SVG)</Link>.
          </p>
        </Section>

        <Section id="reading" title="What the results say">
          <ul className="prose-list">
            <li>
              A detailed prompt is the largest single lever: every model scores 65–83% end-to-end field
              accuracy with the two-sentence baseline and 92–99% with its best guided prompt.
            </li>
            <li>Model choice still matters: at a fixed prompt, models span up to 29 points.</li>
            <li>
              With guided prompts every configuration reported the planted prompt injections, on dev and
              held-out.
            </li>
            <li>
              The best held-out rows (
              {heldout
                .filter((row) => (row.fieldAccuracy ?? 0) >= 0.97)
                .map(rowLabel)
                .join('; ')}
              ) are within the noise of each other.
            </li>
          </ul>
        </Section>

        <Section id="limitations" title="Limitations">
          <ul className="prose-list">
            <li>Seven cards, at most two per issuer, and 37 cases.</li>
            <li>
              Injection and conflict variants are synthetic edits of real pages, so they measure resistance to
              planted text, not to real adversarial pages.
            </li>
            <li>Labels are agent-verified; a human verification pass is still to come.</li>
            <li>
              Models ran through their vendors’ agent CLIs on subscriptions, not raw APIs, which adds harness
              tokens and latency. Subscription models are not pinned snapshots.
            </li>
            <li>Latency was measured on one machine while other runs were in flight.</li>
            <li>
              The guided prompts’ worked examples happen to match Amex wording, and Amex is held-out, so part
              of the held-out lift is example-assisted.
            </li>
          </ul>
          <p>
            <Link href={RESULTS_MD} variant="standalone" icon="arrow-right" isExternal>
              Full write-up with error analysis and disclosures (results.md on GitHub)
            </Link>
          </p>
        </Section>
      </>
    ),
  };
}

const HARNESS: [string, string][] = [
  [
    'Untrusted input',
    'Issuer text is data inside a JSON envelope; embedded instructions must be reported as issues, and the corpus plants them.',
  ],
  [
    'Structured output',
    'A strict schema with explicit known, unknown and conflicting states; an unknown value must be null.',
  ],
  [
    'Grounding',
    'Every stated value cites a verbatim quote; the harness resolves each quote to an exact span of the source and rejects the rest.',
  ],
  [
    'Versioning',
    'Prompt, context envelope, output schema and source policy are versioned together and hashed into every trace.',
  ],
  [
    'Budgets',
    'Token, time and attempt limits per run, with spending reserved atomically in PostgreSQL before each call.',
  ],
  [
    'Authority',
    'The model has no tools and no write path. Applying a draft and publishing a release are separate signed-in human actions.',
  ],
  [
    'Traces',
    'A private ledger of inputs, raw output, usage, latency and validation findings, replayable by the offline evaluator.',
  ],
];

function Architecture(): Rendered {
  return {
    title: 'Architecture: two systems, one contract · AI Checkout',
    description:
      'How AI Checkout splits the work: a language model drafts catalog changes for human review, and a deterministic engine in the extension computes rewards offline.',
    body: (
      <>
        <PageIntro eyebrow="Architecture" title="Two systems, one contract">
          <p>
            The language model works where the problem is language: reading issuer terms. Arithmetic and
            ranking stay deterministic, and the only thing that crosses from one system to the other is a
            validated catalog release a person has published.
          </p>
        </PageIntro>
        <SystemsDiagram />
        <Section id="flow" title="The flow, step by step">
          <ol className="prose-list">
            <li>Issuer terms pages are captured and stored with a content hash.</li>
            <li>The extraction harness asks a model for every earning rule, each value with quotes.</li>
            <li>Schema and citation checks reject values whose quotes are not in the source.</li>
            <li>
              A reviewer compares the draft with the published catalog and the captured evidence, then
              publishes it as a separate action.
            </li>
            <li>PostgreSQL stores each release immutably; publication is one transaction.</li>
            <li>The API serves the current release at GET /v1/catalog.</li>
            <li>
              The extension caches the catalog (or uses the one bundled with it) and its engine ranks your
              cards for the purchase, with the cart amount read only when you click.
            </li>
          </ol>
        </Section>
        <Section id="engine" title="The engine">
          <p>
            A pure TypeScript engine computes in integer cents and basis points. It applies a rule only if it
            can apply at this merchant and with this payment method, honors spending caps and the rate after a
            cap, never lets a card fall below its base reward, and turns anything it doesn’t know into a
            range. Cards are ranked by the reward they are guaranteed to earn. The same Zod catalog contract
            is enforced in the extension, the API and, mirrored, in SQL.
          </p>
        </Section>
        <Section id="harness" title="The extraction harness">
          <Table
            caption="How the extraction harness handles each concern"
            isCaptionHidden
            columns={[
              { key: 'concern', label: 'Concern', isRowHeader: true, render: (row) => row[0] },
              { key: 'approach', label: 'Approach', render: (row) => row[1] },
            ]}
            rows={HARNESS}
            rowKey={(row) => row[0]}
            className="harness-table"
          />
          <p>
            The offline evaluator re-scores saved traces against reference labels: field accuracy, rule
            recall, claim precision, evidence validity, issue recall and false-clean verdicts.{' '}
            <Link href="/results/">Results</Link>
          </p>
          <p>
            <Link
              href={`${REPO}/blob/main/docs/design.md`}
              variant="standalone"
              icon="arrow-right"
              isExternal
            >
              Design document on GitHub
            </Link>
          </p>
        </Section>
      </>
    ),
  };
}

function Privacy(): Rendered {
  return {
    title: 'Privacy · AI Checkout',
    description:
      'What the AI Checkout extension keeps on your device, what it sends (only a request for the card catalog), and what it never collects.',
    body: (
      <>
        <PageIntro eyebrow="Privacy" title="Your inputs stay on your device">
          <p>
            AI Checkout has no account and no analytics. What you enter is encrypted in your Chrome profile,
            and the only thing the extension fetches is the published card catalog.
          </p>
        </PageIntro>
        <Section id="sent" title="What leaves your device">
          <ul className="prose-list">
            <li>
              <strong>Only a request for the card catalog.</strong> The extension fetches the published
              catalog with a GET from the AI Checkout API at a fixed address. The request carries no cookies,
              no referrer, and none of your cards, amounts or page addresses.
            </li>
            <li>
              <strong>No analytics, tracking or advertising.</strong> Nothing about your use is reported, sold
              or used to judge creditworthiness. No model is called at checkout.
            </li>
            <li>
              Opening an issuer link takes you to the issuer’s site, under its own privacy policy. Chrome and
              the Chrome Web Store handle installation and updates under their terms.
            </li>
          </ul>
        </Section>
        <Section id="stored" title="What stays on your device">
          <ul className="prose-list">
            <li>The cards you selected and your preferred card when rewards tie.</li>
            <li>Spending you report toward a card’s cap, with its date, and activation choices.</li>
            <li>Your latest purchase inputs: merchant, amount, date and eligibility choices.</li>
            <li>
              After a cart read: the amount, its kind (total or subtotal), the merchant, the capture time and
              a hash used to detect that the page changed.
            </li>
          </ul>
          <p>It is not synced to other devices, and it is not a purchase history.</p>
        </Section>
        <Section id="reads" title="Cart reads">
          <p>
            On the Amazon US, Best Buy US and Newegg US carts, the extension reads the order-summary amount
            only after you click <strong>Read cart amount</strong>, and you confirm it before comparing. It
            does not read card numbers, security codes, addresses, payment fields or product names, and it
            does not save the page or its address.
          </p>
        </Section>
        <Section id="vault" title="Encrypted storage">
          <p>
            Saved inputs are encrypted with a key derived from a passphrase you choose; the passphrase is not
            saved. The unlocked key stays in Chrome’s session memory until you lock, restart Chrome, or the
            extension updates. A forgotten passphrase cannot be recovered: delete the saved data and start
            again.
          </p>
          <p>
            Encryption does not protect a device that is already compromised or a profile someone else is
            using while it is unlocked. Never enter payment credentials.
          </p>
        </Section>
        <Section id="delete" title="Deleting your data">
          <p>
            Open <strong>Delete saved data</strong> in the popup, confirm, and choose{' '}
            <strong>Delete all local data</strong>. Uninstalling the extension also removes its storage.
            Neither affects a retailer’s cart or your browser history.
          </p>
        </Section>
        <Section id="site" title="This website">
          <p>
            This site sets no cookies, runs no analytics and loads nothing from other domains. The hosting
            provider may keep standard request logs.
          </p>
        </Section>
      </>
    ),
  };
}

function Support(): Rendered {
  const issues: [string, string][] = [
    [
      'The cart can’t be read',
      'Open the popup on the cart page, wait for the order summary to load, and try again. If the page changed, type the amount yourself.',
    ],
    [
      'Unsupported page',
      'Use the Amazon US cart, a Best Buy US cart, or secure.newegg.com/shop/cart. Product pages and checkout steps are out of scope.',
    ],
    [
      'It says subtotal',
      'Tax and shipping are not included. Enter the final charge once you know it, or compare the subtotal knowingly.',
    ],
    [
      'A range instead of one amount',
      'A condition is unknown, such as spend toward a cap or activation. Confirm it in Edit cards to narrow the range.',
    ],
    [
      'Terms expired',
      'The catalog is valid for 30 days. Update the extension or let it refresh the catalog; don’t change your computer’s date.',
    ],
    [
      'Forgot the passphrase',
      'It can’t be recovered. Open Delete saved data, confirm, and set up your cards again.',
    ],
  ];
  return {
    title: 'Support · AI Checkout',
    description:
      'Getting started with AI Checkout, common issues, deleting your data and reporting a problem.',
    body: (
      <>
        <PageIntro eyebrow="Support" title="Help with AI Checkout">
          <p>Getting started, common issues and how to report a problem.</p>
        </PageIntro>
        <Section id="start" title="Getting started">
          <ol className="prose-list">
            <li>
              Open AI Checkout from Chrome’s toolbar, read the setup notice, and choose a local passphrase of
              at least 15 characters.
            </li>
            <li>Select the supported cards you already have. No card number or login is needed.</li>
            <li>
              On a supported cart choose <strong>Read cart amount</strong>, or pick the merchant and type the
              amount.
            </li>
            <li>
              Confirm the amount and the conditions, then choose <strong>Compare my cards</strong>.
            </li>
          </ol>
        </Section>
        <Section id="issues" title="Common issues">
          <Table
            caption="Common issues and what to do"
            isCaptionHidden
            columns={[
              { key: 'issue', label: 'What you see', isRowHeader: true, render: (row) => row[0] },
              { key: 'fix', label: 'What to do', render: (row) => row[1] },
            ]}
            rows={issues}
            rowKey={(row) => row[0]}
            className="harness-table"
          />
        </Section>
        <Section id="limits" title="Known limitations">
          <ul className="prose-list">
            <li>
              Seven cards and three U.S. checkouts. Other cards, benefits and countries are out of scope.
            </li>
            <li>
              Estimates follow the issuers’ terms; how a purchase actually posts (its merchant category,
              PayPal or buy-now-pay-later) can change the reward, so the extension cannot guarantee one.
            </li>
            <li>Retailer pages change; when a cart reader stops working, type the amount instead.</li>
            <li>The Chrome Web Store listing is not published yet.</li>
          </ul>
        </Section>
        <Section id="report" title="Report a problem">
          <p>
            Open an issue on GitHub with the extension and Chrome versions, the merchant and page type, the
            exact message, and the steps. Use a made-up amount if it helps.
          </p>
          <AlertInline color="critical" title="Never include" role="none">
            <p>
              Your passphrase, card numbers, bank credentials, full cart addresses, product lists, home
              address or unredacted screenshots. GitHub issues are public; for a security concern, ask for a
              private contact without the details.
            </p>
          </AlertInline>
          <p>
            <Link href={`${REPO}/issues`} variant="standalone" icon="arrow-right" isExternal>
              Open an issue on GitHub
            </Link>
          </p>
          <p className="muted small">Responses are best effort; there is no service-level promise.</p>
        </Section>
      </>
    ),
  };
}

const RENDERERS: Record<PageId, () => Rendered> = {
  home: Home,
  results: Results,
  architecture: Architecture,
  privacy: Privacy,
  support: Support,
};

export function page(id: PageId): Rendered {
  const rendered = RENDERERS[id]();
  return { ...rendered, body: <Layout page={id}>{rendered.body}</Layout> };
}
