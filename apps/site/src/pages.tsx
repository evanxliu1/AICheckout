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

// Copied from the Web Store screenshots in docs/release/assets (vite.config.ts COPIED); regenerated
// on 2026-10-03 in the Ocean theme with the 178-card catalog (extension 2.0.0; milestone 15.6 regenerates them
// for 2.1.0). The alt text describes the images as they are; keep it in step with them.
const SCREENSHOTS = [
  {
    src: '/media/2-comparison.png',
    alt: 'Extension popup recommending Blue Cash Everyday at $3.00 on a $100 Best Buy purchase, quoting the issuer rule and its conditions: U.S. merchants only, up to $6,000 per year then 1%.',
    caption: 'The best card for this purchase, with the rule in the issuer’s words and its conditions.',
  },
  {
    src: '/media/3-uncertainty.png',
    alt: 'Extension popup result with annual spend unknown: Blue Cash Everyday shows a $1.00 to $3.00 range and says its online retail spend toward the yearly bonus limit is unknown.',
    caption: 'Unknown spend toward a cap becomes a range, not a guess.',
  },
  {
    src: '/media/1-wallet.png',
    alt: 'Extension wallet editor: a search field for the 178-card catalog above the sample cards added, starting with Citi Double Cash, Wells Fargo Active Cash and Capital One Quicksilver.',
    caption: 'Search 178 cards and add the ones you already have. No card numbers or bank login.',
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
              On the cart or checkout page of any online store, AI Checkout shows which of the cards in your
              wallet earns the most, with the reward, the issuer rule behind it and its conditions. The math
              runs on your device; no model and no account are involved at checkout.
            </p>
          </PageIntro>
          <Card hasBorder className="install">
            <div className="install__head">
              <h2 className="install__title">Install</h2>
              <Badge color="neutral">Coming soon</Badge>
            </div>
            <p>
              The Chrome Web Store listing is not published yet; the install link will appear here when it is.
              Until then you can build the extension from source and load it unpacked.
            </p>
            <Link href={`${REPO}#run-it`} variant="standalone" icon="arrow-right" isExternal>
              Build from source
            </Link>
          </Card>
        </div>

        <Section id="what" title="What it does">
          <ul className="feature-grid">
            <Card as="li" hasBorder className="feature">
              <h3>A badge on your cart, at any store</h3>
              <p>
                Choose the cards you have once. On the cart or checkout page of any U.S. online store a small
                badge shows your best card and its reward (“Use Blue Cash Everyday · $3.00 back”), ranked by
                what the purchase is sure to earn.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Reads only the order summary</h3>
              <p>
                It reads the cart’s order-summary amount and nothing else: never item names, addresses or
                payment fields. When it isn’t sure of the amount it ranks your cards by rate instead of
                guessing. Turn it off for any site.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Shows its reasons, stays on your device</h3>
              <p>
                Open the badge for every card’s estimate with the issuer’s rule and conditions. The comparison
                runs in your browser; usage reports leave it only if you choose to share them.
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
              <strong>The store’s category, matched on your device.</strong> A published store list names more
              than 600 U.S. stores with their bonus category and the evidence behind it (the store’s own
              pages, an issuer’s terms, or public purchase-card data); every other store is compared as a
              general online store. The whole list is downloaded, so no server learns where you shop.
            </li>
            <li>
              <strong>Deterministic math at checkout.</strong> A small engine works in whole cents and basis
              points. It applies only the rules that can apply to this store and payment method, honors
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

        <Section id="scope" title="Covered today">
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
              <h3>Stores</h3>
              <p>
                The cart or checkout page of any https store, read by one generic reader; no store has its own
                code. More than 600 U.S. stores are named with their bonus category, and every other store is
                compared as a general online store.
              </p>
              <p className="muted small">
                U.S. purchases in U.S. dollars. When the amount can’t be read with certainty, your cards are
                ranked by rate and you can type the amount.
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
              The extension uses the catalog bundled with it, or the newer one it downloaded (at install,
              weekly, or when you chose Check for updated terms), and the store list the same way. Its engine
              ranks your cards for the cart the badge read, or for an amount you typed.
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

const DICTIONARY = `${REPO}/blob/main/docs/telemetry/events.md`;

function Privacy(): Rendered {
  return {
    title: 'Privacy · AI Checkout',
    description:
      'What the AI Checkout extension keeps on your device, what it reads on cart pages, the requests it makes for card terms and the store list, and the optional usage reports you can share, stop and delete.',
    body: (
      <>
        <PageIntro eyebrow="Privacy policy" title="Your cards stay on your device">
          <p>
            AI Checkout has no account and no model at checkout. Your cards, settings and purchase inputs stay
            in your Chrome profile, readable only by the extension, and can be encrypted with a passphrase.
            The extension downloads published card terms and a store list, and sends usage reports only if you
            choose to share them, under a random identifier: no name, email or browsing history.
          </p>
          <p className="muted small">
            Last updated 2026-10-20 · Operator: Evan Liu (the AI Checkout project) · Contact:
            SUPPORT_EMAIL_TBD · Extension version 2.1.0
          </p>
        </PageIntro>
        <Section id="does" title="What AI Checkout does">
          <p>
            It tells you which of the credit cards you already own earns the most on the cart or checkout page
            you are looking at. You pick your cards once; at any https store a small badge shows your best
            card and its estimated reward, or, when the cart amount could not be read with certainty, your
            cards ranked by rate. The toolbar popup compares any purchase. There is no bank connection and no
            payment processing: the comparison is arithmetic over published card terms, run on your device.
          </p>
        </Section>
        <Section id="stored" title="What stays on your device">
          <ul className="prose-list">
            <li>
              The cards you picked (as catalog identifiers, never card numbers, security codes or balances)
              and your default card.
            </li>
            <li>
              Card options: bonus categories you chose, answers to optional membership, status and account
              questions (for example a Prime membership or when an account was opened), spending you report
              toward a card’s cap with its date, activation choices, and point values you set.
            </li>
            <li>Badge settings: whether the badge is on, and the sites you turned it off for.</li>
            <li>
              Your latest purchase inputs in the popup (store, amount, date, eligibility choices) and what is
              needed to show or invalidate a saved comparison.
            </li>
            <li>
              After a cart read from the popup: the amount and currency, its kind (total, estimated total or
              subtotal), the matched store, the reader version, the capture time, a random capture identifier,
              the tab and document identifiers, and a hash of the page address used to notice that the page
              changed (a freshness check, not a privacy measure). The address itself is not saved.
            </li>
            <li>The most recent card catalog and store list downloaded (public data).</li>
            <li>
              In builds with usage reporting: your answer to the consent question, the random identifier
              created when you chose Share, and reports waiting to be sent (at most 200). Never encrypted,
              because it holds no wallet data; the identifier is deleted by <strong>Stop sharing</strong> and{' '}
              <strong>Delete my data</strong>.
            </li>
          </ul>
          <p>
            While a tab is open, the extension also keeps in Chrome’s session memory, per tab: the matched
            store and the tab’s hostname (never the page path), the latest cart reading, an amount you typed
            in the badge, your payment-method choice, whether you dismissed the badge, whether a cart or
            checkout page was read, which recommendation was last reported (if you share) and whether you
            suggested the store. It is cleared when the tab closes or Chrome restarts. Nothing is synced to
            other devices.
          </p>
        </Section>
        <Section id="reads" title="The cart badge: what it reads on web pages">
          <p>
            The extension asks for access to every https website, because a cart can be at any store. This is
            exactly what that access is used for.
          </p>
          <ul className="prose-list">
            <li>
              <strong>A packaged script runs on https pages</strong>, in the top frame only, after the page
              has loaded. It first looks at the page’s address and title for a cart or checkout word (cart,
              basket, bag, checkout and their equivalents in other languages). On a page with neither, it
              reads nothing, watches nothing and ends there.
            </li>
            <li>
              <strong>On a cart or checkout page</strong> it reads the visible text of the main content to
              find the order summary (Subtotal, Shipping, Tax, Total) and cart line items, and, to tell the
              currency, the page’s structured data (for example a <code>priceCurrency</code> value), currency
              meta tags and attributes, the country code of the store’s address and the page language. It
              keeps watching the page while you are on the cart so the badge follows quantity changes, up to
              120 readings per page load.
            </li>
            <li>
              <strong>Only the reading leaves the page</strong>, to the extension’s own service worker on your
              device: whether an amount was found, the amount in cents, its kind, the currency and the reader
              version, or a reason code when no amount is shown (an empty cart, another currency, an amount
              that could not be read with certainty). Never item names, addresses, form values, card numbers,
              the page’s text or its address. The script makes no network request.
            </li>
            <li>
              <strong>The store is matched on your device.</strong> The whole published store list is
              downloaded and compared with the tab’s hostname locally, so the service never learns which
              stores you visit. On a payment processor’s page (PayPal, Shop Pay, Klarna and others) no badge
              is shown and nothing is kept.
            </li>
            <li>
              <strong>Isolated badge.</strong> Your card names and amounts appear in a frame on an extension
              page that the store’s page cannot read.
            </li>
            <li>
              <strong>The popup</strong> reads the open tab the same way when you open it or choose{' '}
              <strong>Read cart amount</strong>; it uses the tab’s address in memory to match the store and
              never saves it.
            </li>
            <li>
              <strong>Switch it off</strong> for a site with <strong>Not on this site</strong>, or everywhere
              with the badge switch in Settings.
            </li>
          </ul>
          <p>
            Amounts in another currency are not compared (U.S. dollars only). The extension does not read card
            numbers, security codes, bank credentials, addresses, payment fields or product names, and does
            not request or read your browsing history.
          </p>
        </Section>
        <Section id="requests" title="Network requests">
          <p>
            Card terms and the store list are published as data and downloaded by the extension; nothing it
            downloads is code. The Chrome Web Store build sends:
          </p>
          <ul className="prose-list">
            <li>
              <strong>
                <code>GET /v1/catalog</code> and <code>GET /v1/merchants</code>
              </strong>{' '}
              on <code>https://ai-checkout-api.onrender.com</code>: the published card terms and the store
              list, validated against fixed schemas before use. They are fetched once right after
              installation, then weekly (with one retry a few minutes later if the first attempt failed), and
              whenever you choose <strong>Check for updated terms</strong>. Card terms expire 30 days after
              they were verified; the weekly check keeps them current. These requests carry no cookies, no
              referrer and none of your cards, amounts, settings or page addresses.
            </li>
            <li>
              <strong>Usage reports</strong>, only after you choose Share (next section).
            </li>
          </ul>
          <p>
            Like any web request, each one reveals your IP address, your browser’s user agent and the time of
            the request to the service’s host, which records them in access logs. The service is operated by
            Evan Liu for the AI Checkout project (
            <Link href={REPO} isExternal>
              github.com/evanxliu1/AICheckout
            </Link>
            ), hosted on Render, with its data stored in Supabase. Access logs are kept according to those
            providers’ log retention, which AI Checkout does not control; deleting your data in the extension
            cannot delete them. Opening a card’s issuer link takes you to the issuer’s website under its own
            privacy policy. Chrome and the Chrome Web Store handle installation and updates under Google’s
            terms. A build made from source without a catalog endpoint makes none of these requests and has no
            usage reporting.
          </p>
        </Section>
        <Section id="reports" title="Usage reports (optional)">
          <p>
            After you pick your cards, the extension asks once whether to <strong>Share</strong> usage reports
            to help improve the reader, the store list and the recommendations, or <strong>Not now</strong>.
            The extension works the same either way, and you can change your answer any time under Settings in
            the toolbar popup. Nothing about your use leaves the device before you choose Share.
          </p>
          <ul className="prose-list">
            <li>
              <strong>A random identifier, no name, email or browsing history.</strong> Every report carries
              an identifier created when you chose Share, so repeated reports from one install can be told
              apart. Because it persists and some reports carry exact amounts, this data is pseudonymous: it
              can’t be tied to you by name, but reports from one install can be linked to each other. Each
              report also carries the versions of the extension, card terms and store list in use, the month
              you chose Share and how long ago that was (in ranges).
            </li>
            <li>
              <strong>What is sent</strong> (the full list is the public{' '}
              <Link href={DICTIONARY} isExternal>
                event dictionary
              </Link>
              ): that sharing started and that setup finished with how many cards you picked; the cards you
              own, as catalog identifiers, when sharing starts and whenever you change them; each
              recommendation shown (the recommended card, how many cards you have, the store’s category,
              whether the store is one the list names and the evidence for its category, whether it was a cart
              or checkout page or a popup read, and the exact cart amount read in cents and its kind, or that
              it was not read); the badge expanded or dismissed, a site switched off, the popup opened and
              what its read found, how far an amount you typed was from the one read (a range), and when card
              terms or the store list were refreshed; error codes when a request fails, without messages or
              page content.
            </li>
            <li>
              <strong>Never sent:</strong> a store name, domain or web address, the page’s text, item names,
              card numbers, your name or email, or your browsing history. Reports are built by the extension’s
              service worker from what it already knows; the scripts that run on web pages send nothing
              anywhere.
            </li>
            <li>
              <strong>Two things you send on purpose.</strong> “Suggest this store” (in the popup or the badge
              panel, at a store the list does not name) and “Report a problem” (in the popup, a fixed reason
              and no text field) send the store’s registrable domain (for example <code>example.com</code>)
              with that one request. They work whether you share or not; when you do not share they carry no
              identifier.
            </li>
            <li>
              <strong>How reports travel.</strong> They queue on your device and go to{' '}
              <code>POST /v1/events</code> on the same service every 15 minutes while any wait, at once when
              50 are waiting, when you choose Share and when you tap Suggest or Report; at most 200 wait on
              the device. The service accepts at most 500 reports per identifier per day and stores raw
              reports for <strong>90 days</strong>, then deletes them; aggregate counts with no identifier
              (for example how often a store was suggested) may be kept longer.
            </li>
            <li>
              <strong>Your controls, in Settings.</strong> <strong>Stop sharing</strong> (the toggle off)
              deletes the identifier and anything waiting on the device and sends nothing more; reports
              already sent can then no longer be matched to you and expire within 90 days.{' '}
              <strong>Delete my data</strong> sends your current identifier to{' '}
              <code>POST /v1/events/delete</code>, which deletes every report stored under it, and then stops
              sharing; use it before stopping sharing if you want earlier reports deleted. Choosing Share
              again creates a new identifier. If the service is unavailable, the extension says nothing was
              deleted yet so you can retry.
            </li>
            <li>
              <strong>Purpose and limits.</strong> Reports are used to see whether the reader shows amounts in
              the wild, which stores shoppers want added and whether recommendations are used, and to fix
              errors. They are not sold, not used for advertising, not used to decide creditworthiness or
              lending, and not sent to an AI provider or any third party other than the hosting providers
              named above. AI Checkout’s use and transfer of information received from users adheres to the
              Chrome Web Store User Data Policy, including the Limited Use requirements. If AI Checkout ever
              wanted to use reports for another purpose, it would ask you first and update this policy.
            </li>
          </ul>
        </Section>
        <Section id="vault" title="Optional passphrase protection">
          <p>
            Protection is off by default: saved data is stored unencrypted in the extension’s storage, which
            websites and the extension’s content scripts cannot read, but which someone with access to your
            device could. Turn on <strong>Protect with a passphrase</strong> in Settings to encrypt it with a
            key derived from a passphrase you choose; the passphrase is not saved. While locked, the badge
            only asks you to unlock. The unlock key stays in Chrome’s session memory until you lock, restart
            Chrome, or the extension updates; closing the popup does not lock. The downloaded catalog and
            store list and the usage-reporting state are never encrypted (no wallet data). A forgotten
            passphrase cannot be recovered: delete the saved data and start again.
          </p>
          <p>
            Encryption does not protect a device that is already compromised or a profile someone else is
            using while it is unlocked. Never enter payment credentials.
          </p>
        </Section>
        <Section id="delete" title="Retention and deletion">
          <ul className="prose-list">
            <li>
              Your cards, options, settings and purchase inputs stay in this Chrome profile until you change
              them, delete them or uninstall. A cart read becomes unusable after five minutes and a comparison
              after fifteen; these are freshness limits, not scheduled deletion.
            </li>
            <li>
              <strong>Delete all local data</strong> (expand <strong>Delete saved data</strong> in the popup
              and confirm) clears everything the extension saved, including the downloaded catalog and store
              list and the unlock key; card setup returns. It does not affect a store’s cart, your browser
              history, or reports already sent.
            </li>
            <li>
              <strong>Delete my data</strong> (Settings) deletes the usage reports stored under your
              identifier on the service, as described above.
            </li>
            <li>
              <strong>Uninstalling</strong> removes the extension’s storage from your device; Chrome then
              opens a <Link href="/uninstalled/">page on this site</Link> with no parameters that repeats
              these points. Reports already sent expire within 90 days; to delete them earlier, use{' '}
              <strong>Delete my data</strong> before uninstalling, since the identifier leaves with the
              extension.
            </li>
          </ul>
        </Section>
        <Section id="rights" title="Children and your rights">
          <p>
            AI Checkout is not directed at children under 13 and does not knowingly collect information from
            them. It is offered in the United States only. Everything the extension holds about you is on your
            device, where you can see and delete it. For usage reports, the only data the service holds under
            a person, the controls above let you stop and delete without contacting anyone; because the
            identifier is random and the service holds nothing else about you, no one can find your reports
            from your name or email. AI Checkout does not sell personal information and does not share it for
            cross-context behavioral advertising. For any privacy question, write to SUPPORT_EMAIL_TBD.
          </p>
        </Section>
        <Section id="site" title="This website and changes">
          <p>
            This site sets no cookies, runs no analytics and loads nothing from other domains. It is served by
            the same service on Render, whose access logs record IP address, user agent and request time.
            Changes to what the extension collects or sends are made in this policy and in the extension’s own
            consent and settings text before they take effect, and the date above is updated; material changes
            to usage reporting ask for consent again.
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
      'The badge appears on cart and checkout pages whose address or title names the cart or checkout, once the order summary has loaded, at https stores only. Check Settings → Cart badge (the badge switch and the sites you turned off) and whether you dismissed it in this tab. Payment pages such as PayPal never show it. If a real cart gets no badge, use Report a problem in the popup.',
    ],
    [
      '“Pick your cards to see your best card”',
      'No cards are saved yet. Click the badge to open setup, or dismiss it for this tab with the button beside it.',
    ],
    [
      '“Unlock to see your best card”',
      'Passphrase protection is on and locked. Click the badge or the toolbar button and unlock.',
    ],
    [
      'Rates instead of an amount (“The cart amount was not read”)',
      'The order summary wasn’t found or an amount wasn’t certain, for example a credit that may or may not apply. The ranking by rate is still right for this store; type the amount in the panel to see dollar estimates.',
    ],
    [
      '“This page doesn’t look like a cart or checkout page”',
      'The popup’s read runs on cart and checkout pages only. Type the amount instead.',
    ],
    [
      '“This comparison supports USD only”',
      'AI Checkout compares U.S.-dollar purchases only; a cart in another currency gets no badge.',
    ],
    [
      '“… is a payment page, not the store’s”',
      'PayPal, Shop Pay and similar pages belong to the payment provider, so the store can’t be told. Compare from the store’s own cart page.',
    ],
    [
      'It says subtotal or estimated total',
      'Tax and shipping aren’t included yet, or the total is still an estimate. Enter the final charge once you know it.',
    ],
    [
      'A range instead of one amount, or “Compare the conditions”',
      'A condition is unknown: spend toward a cap, an activation, or how PayPal or buy-now-pay-later will post. Confirm it in Edit cards or the payment selector to narrow the range.',
    ],
    [
      'The store is recognised as another store, or its category looks wrong',
      'The store list matched the site’s address. Use Report a problem in the popup (recognised as another store, or wrong card). The report carries the store’s domain and the reason, nothing else.',
    ],
    [
      '“Another U.S. online store” for a store you’d expect to be named',
      'The list doesn’t name it yet. Tap Suggest this store in the popup or Store not recognised? Suggest it in the badge panel; the store’s domain is sent so it can be added.',
    ],
    [
      '“Checking for updated terms…”',
      'A new install, or terms that expired while you were away: the extension is fetching the current card terms. A few seconds, longer if the service is waking up.',
    ],
    [
      '“Card terms expired” or “Card terms need attention”',
      'Terms are valid for 30 days after they were verified and refreshed weekly in the background. Choose Check for updated terms in the popup. If it still fails you’re offline or the service is down; comparisons resume when a refresh succeeds. Don’t change your computer’s date.',
    ],
    [
      'Offline',
      'Cart reads and comparisons work offline while the saved terms are valid; only refreshes and usage reports need a connection.',
    ],
    [
      'Forgot the passphrase',
      'It can’t be recovered. Open Delete saved data, confirm, and set up your cards again.',
    ],
  ];
  return {
    title: 'Support · AI Checkout',
    description:
      'Getting started with AI Checkout at any store, common issues, usage reports, deleting your data and reporting a problem.',
    body: (
      <>
        <PageIntro eyebrow="Support" title="Help with AI Checkout">
          <p>
            Getting started, common issues and how to report a problem. Contact: SUPPORT_EMAIL_TBD. Extension
            version 2.1.0.
          </p>
        </PageIntro>
        <Section id="start" title="Getting started">
          <ol className="prose-list">
            <li>
              After installing, a setup tab opens. Search for each card you have by name or issuer, pick your
              default card, then save. For some cards it also asks which bonus categories you chose or about a
              membership, status or account the bonus depends on (“Not sure” shows a range), and what a point
              is worth to you. No card number, login or passphrase is needed.
            </li>
            <li>
              It then asks once whether to <strong>Share</strong> usage reports or <strong>Not now</strong>.
              The extension works the same either way; change your answer any time under Settings → Usage
              reports in the toolbar popup.
            </li>
            <li>
              Open your cart at any U.S. online store. The badge in the corner shows your best card and its
              estimated reward, or your cards ranked by rate when the amount couldn’t be read with certainty.
              Click it for every card’s estimate, the issuer’s rule, a payment-method choice and an optional
              amount field.
            </li>
            <li>
              For any other purchase, open the toolbar popup, type the amount and choose{' '}
              <strong>Compare my cards</strong>. Opened on a cart, the popup reads it for you.
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
        <Section id="reports" title="Usage reports">
          <p>
            Under <strong>Settings → Usage reports</strong> in the popup: the{' '}
            <strong>Sharing usage data</strong> toggle turns sharing on (a new random identifier is created)
            or off (<strong>Stop sharing</strong>: the identifier and anything waiting are deleted and nothing
            more is sent). <strong>Delete my data</strong> asks the service to delete every report stored
            under your current identifier, then stops sharing; use it before stopping sharing if you want
            earlier reports gone. Reports expire after 90 days in any case. What a report contains is in the{' '}
            <Link href="/privacy/">privacy policy</Link>.
          </p>
        </Section>
        <Section id="delete" title="Delete your data">
          <p>
            Expand <strong>Delete saved data</strong> in the popup, confirm, and choose{' '}
            <strong>Delete all local data</strong>: your cards, options, settings, purchase inputs, the
            downloaded terms and store list and the unlock key; card setup returns. It does not affect a
            store’s cart or your browser history, and it does not delete usage reports already sent (use{' '}
            <strong>Delete my data</strong> for those). Uninstalling removes the extension’s storage from your
            device; reports already sent expire within 90 days, so use Delete my data first to delete them
            earlier.
          </p>
        </Section>
        <Section id="limits" title="Known limitations">
          <ul className="prose-list">
            <li>
              {CARD_COUNT} cards from ten U.S. issuers; U.S. stores and U.S. dollars only. Other cards,
              benefits and countries are out of scope.
            </li>
            <li>
              Estimates follow the issuers’ terms; how a purchase actually posts (its merchant category,
              PayPal or buy-now-pay-later) can change the reward, so the extension cannot guarantee one.
            </li>
            <li>
              The reader shows an amount only when it is sure of it; on some carts that means the rates view
              and an amount you type.
            </li>
            <li>The Chrome Web Store listing is not published yet.</li>
          </ul>
        </Section>
        <Section id="report" title="Report a problem">
          <p>
            In the extension: open the popup on the store’s page and use <strong>Report a problem</strong>{' '}
            with one of the fixed reasons. The report carries the store’s domain, the reason and whether the
            badge showed an amount, plus your random identifier only if you share usage reports. There is no
            text field.
          </p>
          <p>
            On GitHub: open an issue with the extension and Chrome versions, the store and page type, the
            exact message and the steps. Use a made-up amount if it helps.
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

/** The merchant release's `mcc` evidence datasets; the wording follows evals/merchants/db/mcc/NOTICE.md. */
const DATASETS: { dataset: ReactNode; publisher: string; licence: ReactNode }[] = [
  {
    dataset: (
      <>
        Purchase Card (PCard){' '}
        <Link href="https://data.ok.gov/dataset/pcard-fy-2022" isExternal>
          Fiscal Year 2022
        </Link>
        ,{' '}
        <Link href="https://data.ok.gov/dataset/purchase-card-pcard-fiscal-year-2023" isExternal>
          Fiscal Year 2023
        </Link>
        ,{' '}
        <Link href="https://data.ok.gov/dataset/purchase-card-pcard-fiscal-year-2024" isExternal>
          Fiscal Year 2024
        </Link>
      </>
    ),
    publisher: 'State of Oklahoma, Office of Management and Enterprise Services (data.ok.gov)',
    licence: (
      <>
        <Link href="https://creativecommons.org/licenses/by/4.0/" isExternal>
          Creative Commons Attribution 4.0 (CC BY 4.0)
        </Link>
        . This product uses the data; the State of Oklahoma does not endorse it
      </>
    ),
  },
  {
    dataset: (
      <Link href="https://opendata.dc.gov/datasets/DCGIS::purchase-card-transactions" isExternal>
        Purchase Card Transactions
      </Link>
    ),
    publisher:
      'Government of the District of Columbia, Office of the Chief Technology Officer (Open Data DC)',
    licence: (
      <>
        Public domain,{' '}
        <Link href="https://creativecommons.org/publicdomain/zero/1.0/" isExternal>
          CC0 1.0
        </Link>
        ; attribution requested. Data retrieved from the Open Data DC catalog
      </>
    ),
  },
  {
    dataset: (
      <Link
        href="https://catalog.data.gov/dataset/gsa-purchase-card-transactions-apr-june-2020-3rd-qtr-us-bank"
        isExternal
      >
        GSA Purchase Card Transactions, April–June 2020 (3rd quarter, US Bank)
      </Link>
    ),
    publisher: 'U.S. General Services Administration (GSA SmartPay), via catalog.data.gov',
    licence: (
      <Link href="https://creativecommons.org/publicdomain/zero/1.0/" isExternal>
        CC0 1.0
      </Link>
    ),
  },
];

function Credits(): Rendered {
  return {
    title: 'Credits · AI Checkout',
    description:
      'Data sources and licences behind AI Checkout: the public purchase-card datasets that inform store categories, the point valuations, and the design system and fonts.',
    body: (
      <>
        <PageIntro eyebrow="Credits" title="Data sources and licences">
          <p>
            AI Checkout is an open-source project (MIT) by Evan Liu. Card terms come from the issuers’ own
            published pages; the store list and the interface rest on the openly licensed sources below.
          </p>
        </PageIntro>
        <Section id="merchant-data" title="Store categories: public purchase-card data">
          <p>
            Part of the store list’s category evidence (records whose evidence basis is <code>mcc</code>,
            release <code>2026-10-11.mcc.1</code> and later) is derived from openly licensed public
            card-transaction datasets. The datasets themselves are not redistributed. The release records, for
            each store, only aggregates: at most twelve merchant-descriptor and merchant-category description
            fragments with row counts, and description tallies.
          </p>
          <p>
            <strong>Changes made to the source data:</strong> the transactions were pooled across the
            datasets, matched to store records by merchant descriptor, and aggregated to per-store counts by
            merchant category description; no row, amount, cardholder, agency or date is kept or published.
          </p>
          <Table
            caption="Public purchase-card datasets used for store categories"
            isCaptionHidden
            columns={[
              { key: 'dataset', label: 'Dataset', isRowHeader: true, render: (row) => row.dataset },
              { key: 'publisher', label: 'Publisher', render: (row) => row.publisher },
              { key: 'licence', label: 'Licence', render: (row) => row.licence },
            ]}
            rows={DATASETS}
            rowKey={(row) => row.publisher}
            className="harness-table"
          />
          <p>
            Merchant category codes are mapped through the Visa Merchant Data Standards Manual (April 2026,
            marked “VISA PUBLIC”, © 2026 Visa). The Visa manual is referenced, not reproduced. Other category
            evidence comes from each store’s own pages and from card issuers’ published terms; the extension
            names the basis beside each store’s category.
          </p>
        </Section>
        <Section id="valuations" title="Point and mile values">
          <p>
            Where an issuer states no cash value for its points or miles, the catalog compares them at a
            published estimate from{' '}
            <Link
              href="https://www.nerdwallet.com/travel/learn/airline-miles-and-hotel-points-valuations"
              isExternal
            >
              NerdWallet’s airline miles and hotel points valuations
            </Link>{' '}
            (read 2026-10-02). An estimate is the publisher’s opinion, not an issuer fact; the extension
            labels it, and a program with no published value is compared in points.
          </p>
        </Section>
        <Section id="interface" title="Interface, icons and fonts">
          <p>
            The interface implements components to the specs of{' '}
            <Link href="https://helios.hashicorp.design" isExternal>
              Helios
            </Link>
            , HashiCorp’s design system, using its design tokens (<code>@hashicorp/design-system-tokens</code>
            ) and{' '}
            <Link href="https://helios.hashicorp.design/icons/library" isExternal>
              Flight icons
            </Link>{' '}
            (<code>@hashicorp/flight-icons</code>), both MPL-2.0, restyled with AI Checkout’s own Ocean theme.
            AI Checkout is not affiliated with or endorsed by HashiCorp. Fonts: Figtree and Bricolage
            Grotesque from Fontsource (<code>@fontsource-variable/*</code>), SIL Open Font License 1.1,
            bundled with the extension and this site. Card names and store names belong to their owners; AI
            Checkout is not affiliated with any issuer or retailer.
          </p>
          <p>
            <Link
              href={`${REPO}/blob/main/evals/merchants/db/mcc/NOTICE.md`}
              variant="standalone"
              icon="arrow-right"
              isExternal
            >
              The data attribution notice in the repository
            </Link>
          </p>
        </Section>
      </>
    ),
  };
}

function Uninstalled(): Rendered {
  return {
    title: 'Uninstalled · AI Checkout',
    description:
      'What removing the AI Checkout extension deleted from your device, and what happens to usage reports you shared.',
    body: (
      <>
        <PageIntro eyebrow="AI Checkout" title="The extension was removed">
          <p>
            Chrome opens this page after an uninstall. It carries no parameters: nothing about you or your
            install was sent to show it.
          </p>
        </PageIntro>
        <Section id="device" title="Deleted from your device">
          <p>
            Chrome removed the extension’s storage with it: your cards and options, settings, purchase inputs,
            the downloaded card terms and store list, any passphrase-protected record and its unlock key, and,
            if you shared usage reports, the random identifier and any reports waiting to be sent. Nothing of
            the extension stays in your Chrome profile. Your stores’ carts and your browser history were never
            touched.
          </p>
        </Section>
        <Section id="server" title="Usage reports you shared">
          <p>
            If you chose <strong>Share</strong>, reports already sent are stored on the AI Checkout service
            under your random identifier and <strong>expire within 90 days</strong>, after which they are
            deleted. They carry no name, email or browsing history, and no store address unless you tapped
            Suggest this store or Report a problem.
          </p>
          <p>
            Deleting them earlier needs the identifier, which left your device with the extension. That is why{' '}
            <strong>Delete my data</strong> (Settings → Usage reports in the popup) has to be used{' '}
            <em>before</em> uninstalling: it deletes every report stored under the identifier at once. If you
            reinstall, a new identifier is created; the old reports cannot be found again and expire on their
            own. If you never chose Share, nothing of yours is on the service.
          </p>
        </Section>
        <Section id="more" title="More">
          <p>
            <Link href="/privacy/">Privacy policy</Link> · <Link href="/support/">Support</Link> ·{' '}
            <Link href={`${REPO}/issues`} isExternal>
              Tell us why you removed it
            </Link>{' '}
            (optional, a public GitHub issue).
          </p>
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
  credits: Credits,
  uninstalled: Uninstalled,
};

export function page(id: PageId): Rendered {
  const rendered = RENDERERS[id]();
  return { ...rendered, body: <Layout page={id}>{rendered.body}</Layout> };
}
