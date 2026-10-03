import type { ReactNode } from 'react';
import { AlertInline, Badge, Card, Link, Table, type TableColumn } from '@ai-checkout/ui';
import { Layout, PageIntro, REPO, type PageId } from './Layout';
import { ResultsChart, rowLabel } from './Chart';
import { SystemsDiagram } from './Diagram';
import {
  expansionFile,
  expansionRows,
  percent,
  resultRows,
  resultsFile,
  seconds,
  sevenCardHeldoutRow,
  type ExpansionRow,
  type ResultRow,
} from './results';

/** Cards per issuer in the bundled catalog v3 (2026-10-02.expansion.1); tests/pages.test.tsx checks it. */
export const ISSUERS: [string, number][] = [
  ['American Express', 13],
  ['Bank of America', 19],
  ['Barclays', 26],
  ['Capital One', 22],
  ['Chase', 29],
  ['Citi', 17],
  ['Discover', 6],
  ['Synchrony', 23],
  ['U.S. Bank', 16],
  ['Wells Fargo', 7],
];
export const CARD_COUNT = ISSUERS.reduce((total, [, count]) => total + count, 0);
const EXPANSION_MD = `${REPO}/blob/main/docs/evals/expansion.md`;
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

// TODO(M7): retake these captures after the wallet search and point-value UI land; the wallet
// capture still shows the seven-card setup of catalog v2.
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
      'A Chrome extension that compares the credit cards you already have at an online checkout, with rules taken from the issuers’ own terms and each published release approved by a person.',
    body: (
      <>
        <div className="hero">
          <PageIntro eyebrow="Chrome extension" title="Which card you already own earns the most here?">
            <p>
              On your cart, AI Checkout shows which of the cards in your wallet earns the most, with the
              reward, the issuer rule behind it and its conditions. The math runs on your device; no model and
              no account are involved at checkout.
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
              <h3>A badge on your cart</h3>
              <p>
                Choose the cards you have once. On a supported cart a small badge shows your best card and its
                reward (“Use Blue Cash Everyday · $3.00 back”), ranked by what the purchase is sure to earn.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Reads only the order summary</h3>
              <p>
                On {MERCHANTS.join(', ').replace(/, (?=[^,]*$)/, ' and ')} it reads the cart’s order-summary
                amount automatically, and nothing else: never item names, addresses or payment fields. Turn it
                off for any site.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Shows its reasons, counts your savings</h3>
              <p>
                Open the badge for every card’s estimate with the issuer’s rule and conditions. After an
                order, one tap adds the extra cash back to your all-time total, kept on your device.
              </p>
            </Card>
          </ul>
        </Section>

        <Section id="how" title="How it decides">
          <ol className="steps">
            <li>
              <strong>Rules from issuer terms, approved by a person.</strong> Each card’s earning rules
              (category, rate, spending cap, activation, U.S.-only, named merchants) come from a catalog built
              from the issuers’ published terms. A language model drafts changes with quotes, automated checks
              verify every quote, and a person approves each published release. The 178-card catalog bundled
              today was checked against the captured terms by verifier agents; a person reviews it before it
              is published as the next release.{' '}
              <Link href="/architecture/">How the catalog is maintained</Link>
            </li>
            <li>
              <strong>Deterministic math at checkout.</strong> A small engine works in whole cents and basis
              points. It applies only the rules that can apply to this merchant and payment method, honors
              spending caps and the rate after a cap, and counts a reward paid when you pay your bill (Citi’s
              second 1%) with a note saying so. Points and miles are compared in cash terms using a published
              estimate of their value, or the issuer’s stated value; an estimate is an opinion, not an issuer
              fact, and a program with no estimate is compared in points.
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
              <p>
                {CARD_COUNT} personal credit cards, cash back and points, from the ten largest U.S. card
                issuers:
              </p>
              <ul className="plain-list">
                {ISSUERS.map(([issuer, count]) => (
                  <li key={issuer}>
                    {issuer} ({count})
                  </li>
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
            The catalog pipeline was first measured on real issuer terms for seven cards, across six models
            and three prompts, then on {expansionFile.corpus.cases} cards of the expansion, where it scores
            lower. <Link href="/results/">See the results, including what they don’t show</Link>
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

const expansionColumns: TableColumn<ExpansionRow>[] = [
  {
    key: 'model',
    label: 'Model',
    isRowHeader: true,
    render: (row) => (
      <>
        <span className="config__model">{row.model}</span>
        <span className="config__meta">
          {row.id === 'cross-model'
            ? 'Neither drafted nor verified the labels'
            : 'Upper bound: labels seeded from it'}
        </span>
      </>
    ),
  },
  { key: 'cards', label: 'Cards', align: 'right', render: (row) => row.cards },
  {
    key: 'field',
    label: 'Field acc. (e2e)',
    align: 'right',
    render: (row) => <strong>{percent(row.fieldAccuracy)}</strong>,
  },
  {
    key: 'matched',
    label: 'Field acc. (matched)',
    align: 'right',
    render: (row) => percent(row.matchedFieldAccuracy),
  },
  { key: 'recall', label: 'Rule recall', align: 'right', render: (row) => percent(row.ruleRecall) },
  { key: 'issues', label: 'Issue recall', align: 'right', render: (row) => percent(row.issueRecall) },
  { key: 'clean', label: 'False-clean', align: 'right', render: (row) => row.falseClean },
  { key: 'latency', label: 'p50', align: 'right', render: (row) => seconds(row.p50Ms) },
];

function Results(): Rendered {
  const rows = resultRows();
  const dev = rows.filter((row) => row.split === 'dev');
  const heldout = rows.filter((row) => row.split === 'heldout');
  const added = rows.filter((row) => row.addedAfter);
  const measured = resultsFile.generatedAt.slice(0, 10);
  const expanded = expansionRows();
  const [cross] = expanded;
  const sevenCard = sevenCardHeldoutRow();
  return {
    title: 'Results: how well models read card terms · AI Checkout',
    description:
      'Extraction results on real issuer terms: seven cards across six models and three prompts, then 173 expansion cards, with limitations.',
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
              <strong>Small sample:</strong> seven cards (n=7), 37 cases, two repeats per case (one for Opus
              on dev and for gpt-5.6-luna). Variants such as prompt injections are planted edits of real
              pages.
            </li>
            <li>
              <strong>Noise is about ±3 points.</strong> Repeat-to-repeat differences reached 5.8 points;
              treat gaps under 3 points as ties. No confidence intervals are computed.
            </li>
            {added.length ? (
              <li>
                <strong>Opus and gpt-5.6-luna were added after.</strong> Claude Opus 5.5 was run on the
                held-out split after the other held-out results had been seen, and gpt-5.6-luna (xhigh effort,
                the curation model since 2026-10-02) on both splits after all of them; neither was part of the
                original choice.
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
            Chase Freedom Unlimited and American Express Blue Cash Everyday and Preferred: 17 cases, two
            repeats per chosen configuration (34 runs), run after the prompts were frozen.
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

        <Section id="expansion" title={`Expansion: ${expansionFile.corpus.cases} cards`}>
          <p>
            The catalog then grew to the main personal cards of the ten largest U.S. issuers. The same harness
            and prompt, never tuned on these pages, read the terms of {expansionFile.corpus.cases} cards whose
            labels were drafted from gpt-5.6-luna extractions and then checked and corrected by Claude
            verifier agents (agent-verified, one repeat). Data:{' '}
            <Link href="/results/expansion.json">expansion.json</Link>.
          </p>
          <Table
            caption="Expansion results: cross-model run and luna upper bound"
            isCaptionHidden
            columns={expansionColumns}
            rows={expanded}
            rowKey={(row) => row.id}
            density="short"
            className="results-table"
          />
          <ul className="prose-list">
            <li>
              The less biased number is {cross?.model} at {percent(cross?.fieldAccuracy ?? null)} end to end
              {sevenCard
                ? `, against ${percent(sevenCard.fieldAccuracy)} for the same model, effort, prompt and source selection on the seven-card held-out split (three cards, two repeats)`
                : ''}
              . The two are not directly comparable: the expansion has points cards and merchant-specific
              rules, its labels were made differently, and output tokens were counted differently.
            </li>
            <li>
              On the rules each model did find, field accuracy is about 94% for both. Most of the end-to-end
              drop is rules the model missed, mainly merchant- and partner-specific ones, and {cross?.model}{' '}
              reported only {percent(cross?.issueRecall ?? null)} of the labelled issues.
            </li>
            <li>
              The luna row is an upper bound, not an accuracy measure: wherever a verifier kept a luna value,
              it scores as correct. Labels seeded from luna drafts can also favour luna-style readings in the
              cross-model row.
            </li>
          </ul>
          <p>
            <Link href={EXPANSION_MD} variant="standalone" icon="arrow-right" isExternal>
              Expansion write-up with pipeline metrics and per-issuer results (expansion.md on GitHub)
            </Link>
          </p>
        </Section>

        <Section id="limitations" title="Limitations">
          <ul className="prose-list">
            <li>
              Seven cards, at most two per issuer, and 37 cases in the main comparison; the expansion run is
              one live run of one model, one repeat.
            </li>
            <li>
              Injection and conflict variants are synthetic edits of real pages, so they measure resistance to
              planted text, not to real adversarial pages.
            </li>
            <li>Labels are agent-verified on both corpora; a human verification pass is still to come.</li>
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
              The extension uses the catalog bundled with it, or, in hosted builds, the latest one it
              downloaded when you chose Check for updated terms. Its engine ranks your cards for the purchase,
              with the cart amount read only when you click.
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
              href={`${REPO}/blob/main/wiki/system/architecture.md`}
              variant="standalone"
              icon="arrow-right"
              isExternal
            >
              Architecture notes on GitHub
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
      'What the AI Checkout extension keeps on your device, the one request it can make (for the card catalog, when you ask), and what it never collects.',
    body: (
      <>
        <PageIntro eyebrow="Privacy" title="Your inputs stay on your device">
          <p>
            AI Checkout has no account and no analytics. Your cards, settings and savings stay in your Chrome
            profile, readable only by the extension, and can be encrypted with a passphrase. The only request
            the extension can make is for the published card catalog, and only when you ask it to check for
            updated terms.
          </p>
        </PageIntro>
        <Section id="sent" title="What leaves your device">
          <ul className="prose-list">
            <li>
              <strong>Only a request for the card catalog.</strong> It depends on the build:
              <ul className="prose-list nested">
                <li>
                  The default build (the one you get with <strong>Build from source</strong>) makes no network
                  request at all. It uses the card terms packaged with it.
                </li>
                <li>
                  Builds configured with the hosted catalog (<code>npm run build:hosted</code>, and the
                  planned Chrome Web Store release) show <strong>Check for updated terms</strong>. Each time
                  you choose it, the extension sends one GET request for the published catalog to a fixed
                  address on the AI Checkout API. It never fetches on its own.
                </li>
              </ul>
              The request carries no cookies, no referrer, and none of your cards, amounts or page addresses.
              Like any web request, it reveals your IP address, your browser’s user agent and the time of the
              request, which the API host records in its access logs.
            </li>
            <li>
              <strong>Who operates it.</strong> The API is run by the AI Checkout project (
              <Link href={REPO} isExternal>
                github.com/evanxliu1/AICheckout
              </Link>
              ). It is hosted on Render, and the catalog is stored in Supabase. Access logs are kept according
              to the hosting providers’ log retention; deleting your data in the extension cannot delete them.
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
            <li>
              The cards you selected and your default card (it breaks ties and is the baseline for savings).
            </li>
            <li>Your badge settings: the sites where the badge is turned off.</li>
            <li>
              Your savings history: for each order you confirmed in the badge, the date, merchant, last cart
              amount, recommended card, the card you said you used (or “not sure”) and the estimated cash
              back. You can export it as JSON or delete it.
            </li>
            <li>Spending you report toward a card’s cap, with its date, and activation choices.</li>
            <li>Your latest purchase inputs: merchant, amount, date and eligibility choices.</li>
            <li>
              After a manual cart read from the popup: the amount and currency, its kind (total, estimated
              total or subtotal), the merchant and reader, the capture time, a random capture identifier, the
              tab and document identifiers, and a hash of the page identity used to detect that the page
              changed (a freshness check, not anonymization).
            </li>
            <li>In hosted builds, the most recent catalog you downloaded.</li>
          </ul>
          <p>
            While a cart tab is open, the extension also keeps that tab’s latest cart amount and the card it
            last recommended in Chrome’s session memory; it is cleared when the tab closes. Nothing is synced
            to other devices.
          </p>
        </Section>
        <Section id="reads" title="The cart badge and cart reads">
          <ul className="prose-list">
            <li>
              <strong>Only three sites: Amazon US, Best Buy US and Newegg US.</strong> The extension has
              access to <code>www.amazon.com</code>, <code>bestbuy.com</code> and{' '}
              <code>secure.newegg.com</code>, and runs its badge script only on their cart, checkout and
              order-confirmation pages. No other website is accessed.
            </li>
            <li>
              <strong>Only the order summary.</strong> On a cart it reads the order-summary amount when the
              page loads and when the summary changes, and nothing else: no card numbers, security codes,
              addresses, payment fields or product names. It does not save the page or its address.
            </li>
            <li>
              <strong>Isolated badge.</strong> Your card names and amounts appear in a frame the store’s page
              cannot read.
            </li>
            <li>
              <strong>Orders by address only.</strong> When an order-confirmation page opens in the same tab
              within three hours of a recommendation, the extension recognizes it from the page address alone
              and asks once which card you paid with; an unanswered question expires after three hours or at
              the next cart. The order page itself is never read.
            </li>
            <li>
              Elsewhere, the toolbar popup reads a cart only when you click <strong>Read cart amount</strong>.
            </li>
          </ul>
        </Section>
        <Section id="vault" title="Optional passphrase protection">
          <p>
            Protection is off by default: saved data is stored unencrypted in the extension’s storage, which
            websites and the extension’s content scripts cannot read, but which someone with access to your
            device could. Turn on <strong>Protect with a passphrase</strong> in Settings to encrypt it with a
            key derived from a passphrase you choose; the passphrase is not saved. While locked, the badge
            only asks you to unlock. The unlocked key stays in Chrome’s session memory until you lock, restart
            Chrome, or the extension updates. A forgotten passphrase cannot be recovered: delete the saved
            data and start again.
          </p>
          <p>
            Encryption does not protect a device that is already compromised or a profile someone else is
            using while it is unlocked. Never enter payment credentials.
          </p>
        </Section>
        <Section id="delete" title="Deleting your data">
          <p>
            Open <strong>Delete saved data</strong> in the popup, confirm, and choose{' '}
            <strong>Delete all local data</strong> (cards, settings and savings). To delete only the savings
            history, use <strong>Delete savings history</strong>. Uninstalling the extension also removes its
            storage. Neither affects a retailer’s cart or your browser history.
          </p>
        </Section>
        <Section id="site" title="This website">
          <p>
            This site sets no cookies, runs no analytics and loads nothing from other domains. It is served by
            the same API on Render, whose access logs record IP address, user agent and request time.
          </p>
        </Section>
      </>
    ),
  };
}

function Support(): Rendered {
  const issues: [string, string][] = [
    [
      'No badge on a cart',
      'The badge appears on the Amazon US cart, Best Buy US cart and checkout, and the Newegg US cart once the order summary loads. Check Settings → Show the cart badge on, and whether you dismissed it in this tab.',
    ],
    ['“Pick your cards to see your best card”', 'No cards are saved yet. Click the badge to open setup.'],
    [
      '“Unlock to see your best card”',
      'Passphrase protection is on and locked. Click the badge or the toolbar button and unlock.',
    ],
    [
      'The cart can’t be read',
      'Wait for the order summary to load, or type the amount in the badge. In the popup, Read cart amount retries.',
    ],
    [
      'The order question did not appear',
      'Order pages are recognized by their address within three hours of a recommendation in the same tab, and these addresses are not yet verified for every store. That order is just not counted.',
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
      'Card terms are valid for 30 days. In hosted builds choose Check for updated terms; otherwise install a newer release. Don’t change your computer’s date.',
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
              After installing, a setup tab opens. Pick the cards you have and your default card, then save.
              No card number, login or passphrase is needed.
              {/* TODO(M7): describe searching the card list and the per-card options once wallet search lands. */}
            </li>
            <li>
              Open your cart on Amazon US, Best Buy US or Newegg US. The badge in the corner shows your best
              card; click it for every card’s estimate, a payment-method choice and an editable amount.
            </li>
            <li>
              After you order, the badge may ask once which card you paid with; your answer adds to your
              all-time extra cash back in the toolbar popup.
            </li>
            <li>
              For any other purchase, open the toolbar popup, pick the merchant, type the amount and choose{' '}
              <strong>Compare my cards</strong>.
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
              {CARD_COUNT} cards from ten U.S. issuers and three U.S. checkouts. Other cards, benefits and
              countries are out of scope.
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
              address or unredacted screenshots. GitHub issues are public.
            </p>
          </AlertInline>
          <p>
            For a security vulnerability, don’t open a public issue: report it privately through{' '}
            <Link href={`${REPO}/security/advisories/new`} isExternal>
              GitHub private vulnerability reporting
            </Link>{' '}
            (see{' '}
            <Link href={`${REPO}/blob/main/SECURITY.md`} isExternal>
              SECURITY.md
            </Link>
            ).
          </p>
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
