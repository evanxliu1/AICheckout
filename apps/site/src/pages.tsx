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

/** Cards per issuer in the bundled catalog v3 (`CATALOG_V3`); tests/pages.test.tsx checks it. */
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
// on 2026-10-20 (milestone 15.6) for extension 2.1.0: the badge at any store, the rates view, card search and
// the popup comparison. The alt text describes the images as they are cropped; keep it in step with them.
// The rates screenshot still shows the earlier spelling "Store not recognised?"; switch its alt text to
// "recognized" when 15.7 regenerates the media.
const SCREENSHOTS = [
  {
    src: '/media/2-badge.png',
    alt: 'Presentation panel “Your best card, on your cart.” beside the actual badge panel “Best card for this cart” next to a neutral sample cart page with a $100.00 total: based on a $100.00 cart estimated total at Sample Kitchen (a fictional store), treated as a restaurant (its own pages; fits Chase’s restaurant definition); an amount field reading 100.00, the payment method “Card entered at checkout”, then Freedom Unlimited $3.00 (3%): 3% on “dining at restaurants, including takeout and eligible delivery services”; otherwise 1.5% on “all other purchases”, activation not mentioned on the issuer’s pages, “Rules that don’t apply here (2)”; below it Double Cash, $1.00 less, $2.00: 2% on “every purchase”, 2% if the balance is paid (1% at purchase), “Rules that don’t apply here (1)”, with the remaining cards below the panel’s scroll edge above the Dismiss for this tab and Not on this site buttons.',
    caption:
      'The badge on a cart, expanded: the best card, the rule in the issuer’s words, and why the store’s category applies.',
  },
  {
    src: '/media/3-rates.png',
    alt: 'Presentation panel “No guess when the amount isn’t certain.” beside the actual badge panel “Best card for this cart” next to a neutral sample cart page whose order summary applies a −$25.00 gift card (total $75.00): the cart amount wasn’t read on this page, each card’s rate doesn’t depend on it, a spend cap could change the order at the cart’s amount; the cards by rate, Blue Cash Everyday 3% back, Double Cash 2% back, Quicksilver 1.5% back, Freedom Unlimited 1.5% back; an optional amount field, the payment method, the line that a tap sends only this store’s domain, a “Store not recognised? Suggest it” link, and the Dismiss for this tab and Not on this site buttons.',
    caption:
      'When the amount isn’t certain (a gift card is applied here), your cards are ranked by rate, not guessed.',
  },
  {
    src: '/media/1-wallet.png',
    alt: 'Presentation panel “Your cards. Your choice.” beside the actual popup card editor: the search field reads “Savor” with three matches listed under Capital One (Savor, Savor Rewards for Students, SavorOne Rewards), above “Cards you own (4)”: Citi Double Cash, Capital One Quicksilver, Chase Freedom Unlimited and American Express Blue Cash Everyday, each with a Remove link.',
    caption: 'Search 178 cards and add the ones you already have. No card numbers or bank login.',
  },
  {
    src: '/media/4-comparison.png',
    alt: 'Presentation panel “The rule in the issuer’s words.” beside the actual popup result “Use Blue Cash Everyday. Saved estimate for a $100.00 Another U.S. online store purchase.” Blue Cash Everyday $3.00 (3%): 3% on “U.S. online retail purchases”; otherwise 1% on “all other eligible purchases”, U.S. merchants only, up to $6,000.00 per year then 1%, activation not mentioned on the issuer’s pages, “Rules that don’t apply here (2)”; below it Double Cash, $1.00 less, $2.00: 2% on “every purchase”, 2% if the balance is paid (1% at purchase), “Rules that don’t apply here (1)”.',
    caption:
      'The popup compares any amount at any store, with each rule quoted from the issuer and its conditions.',
  },
];

function Home(): Rendered {
  return {
    title: 'AI Checkout: the best card you already own, at checkout',
    description:
      'A Chrome extension that shows which of the credit cards you already own earns the most at an online checkout, using rules from the issuers’ published terms.',
    body: (
      <>
        <div className="hero">
          <PageIntro eyebrow="Chrome extension" title="See which of your cards earns the most at checkout">
            <p>
              On the cart or checkout page of any U.S. online store, AI Checkout shows which card in your
              wallet earns the most, with the estimated reward, the issuer’s rule behind it and its
              conditions. The comparison runs on your device. There’s no account, and no AI model runs at
              checkout.
            </p>
          </PageIntro>
          <Card hasBorder className="install">
            <div className="install__head">
              <h2 className="install__title">Install</h2>
              <Badge color="neutral">Coming soon</Badge>
            </div>
            <p>
              AI Checkout isn’t in the Chrome Web Store yet. The install link will appear here when the
              listing is published. Until then, you can build the extension from source and load it unpacked.
            </p>
            <Link href={`${REPO}#run-it-locally`} variant="standalone" icon="arrow-right" isExternal>
              Build from source
            </Link>
          </Card>
        </div>

        <Section id="what" title="What it does">
          <ul className="feature-grid">
            <Card as="li" hasBorder className="feature">
              <h3>A badge on your cart at any store</h3>
              <p>
                Pick the cards you own once. On the cart or checkout page of any U.S. online store, a small
                badge shows your best card and its estimated reward, for example “Use Blue Cash Everyday ·
                $3.00 back”. Cards are ranked by the reward the purchase is certain to earn.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Reads only the order summary</h3>
              <p>
                The badge takes only the order-summary amount and its currency from the page. It doesn’t
                collect item names, addresses or payment fields. If it isn’t certain of the amount, it ranks
                your cards by rate instead of guessing. You can turn it off for any site.
              </p>
            </Card>
            <Card as="li" hasBorder className="feature">
              <h3>Shows its reasons</h3>
              <p>
                Open the badge to see every card’s estimate with the issuer’s rule and conditions. The
                comparison runs in your browser, and usage reports leave your device only if you choose to
                share them.
              </p>
            </Card>
          </ul>
        </Section>

        <Section id="how" title="How it decides">
          <ol className="steps">
            <li>
              <strong>Card rules come from issuer terms.</strong> Each card’s earning rules (category, rate,
              spending cap, activation, U.S.-only and named merchants) come from a catalog built from the
              issuers’ published terms. A language model drafts each change and quotes the terms for every
              value. Automated checks match each quote against the captured page, verifier agents review the
              drafted rules, and a person approves each catalog release before it’s published.{' '}
              <Link href="/architecture/">How the catalog is maintained</Link>
            </li>
            <li>
              <strong>The store’s category is matched on your device.</strong> A published store list names
              more than 600 U.S. stores with their bonus category and the evidence for it: the store’s own
              pages, an issuer’s terms or public purchase-card data. Every other store is compared as a
              general online store. The extension downloads the whole list, so no server learns where you
              shop.
            </li>
            <li>
              <strong>The math is deterministic.</strong> A small engine calculates in whole cents and basis
              points. It applies only the rules that can apply to this store and payment method, honors
              spending caps and the rate after a cap, and counts a reward paid when you pay your bill (such as
              Citi’s second 1%) with a note that says so. Points and miles are compared in cash, at the
              issuer’s stated value or a published estimate. An estimate is the publisher’s opinion, not an
              issuer fact. A program with no published value is compared in points.
            </li>
            <li>
              <strong>Unknowns stay visible.</strong> If the extension doesn’t know how much of a cap you’ve
              used, whether a bonus is activated, or how PayPal or buy-now-pay-later will post, it shows a
              range and ranks by the lower end.
            </li>
          </ol>
        </Section>

        <Section id="screens" title="Screenshots">
          <p className="muted">
            Screenshots of the extension with sample inputs on a fictional store page. Amounts are estimates,
            not earned rewards.
          </p>
          <ul className="screens">
            {SCREENSHOTS.map((shot) => (
              <li key={shot.src}>
                <figure>
                  <img src={shot.src} alt={shot.alt} width="1280" height="800" loading="lazy" />
                  <figcaption>{shot.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="scope" title="Coverage">
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
                The cart or checkout page of any https store, read by one generic cart reader with no
                store-specific code. More than 600 U.S. stores are named with their bonus category, and every
                other store is compared as a general online store.
              </p>
              <p className="muted small">
                U.S. purchases in U.S. dollars only. When the amount can’t be read with certainty, your cards
                are ranked by rate and you can type the amount.
              </p>
            </div>
          </div>
        </Section>
        <Section id="measured" title="How accurately the model reads card terms">
          <p>
            The extraction step was measured on real issuer terms: first on seven cards across six models and
            three prompts, then on {expansionFile.corpus.cases} cards from the catalog expansion, where it
            scores lower. <Link href="/results/">Read the results and their limitations</Link>
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
    'The model has no tools and no write path. Applying a draft and publishing a release are separate steps that need a signed-in reviewer session.',
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
      'How AI Checkout divides the work: a language model drafts catalog changes for review and approval, and a deterministic engine in the extension computes rewards on your device.',
    body: (
      <>
        <PageIntro eyebrow="Architecture" title="Two systems, one contract">
          <p>
            AI Checkout uses a language model only where the problem is language: reading issuer terms. The
            extension’s arithmetic and ranking are deterministic. The two systems share only published data:
            the card catalog, which a person approves before each release, and the store list.
          </p>
        </PageIntro>
        <SystemsDiagram />
        <Section id="flow" title="How a catalog release reaches the extension">
          <ol className="prose-list">
            <li>Issuer terms pages are captured and stored with a content hash.</li>
            <li>
              The extraction harness asks a model for every earning rule, with a verbatim quote for each
              value.
            </li>
            <li>Schema and citation checks reject any value whose quote isn’t in the captured page.</li>
            <li>
              Verifier agents check the drafted rules against the captured pages, and a person approves the
              release. Publishing is a separate, explicit step.
            </li>
            <li>PostgreSQL stores each release immutably, and publication is a single transaction.</li>
            <li>
              The API serves the current catalog release at <code>GET /v1/catalog</code> and the store list at{' '}
              <code>GET /v1/merchants</code>.
            </li>
            <li>
              The extension uses the catalog bundled with it or a newer one it downloaded (at install, weekly,
              or when you choose Check for updated terms), and the store list the same way. Its engine ranks
              your cards for the cart amount the badge read or for an amount you typed.
            </li>
          </ol>
        </Section>
        <Section id="engine" title="The rewards engine">
          <p>
            A pure TypeScript engine calculates in integer cents and basis points. It applies a rule only if
            the rule can apply at this merchant and with this payment method, honors spending caps and the
            rate after a cap, never lets a card fall below its base reward, and turns anything it doesn’t know
            into a range. Cards are ranked by the reward they are guaranteed to earn. The extension, the API
            and the database (in SQL) enforce the same catalog contract.
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
            The offline evaluator re-scores saved traces against reference labels for field accuracy, rule
            recall, claim precision, evidence validity, issue recall and false-clean verdicts.{' '}
            <Link href="/results/">See the results</Link>
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
    title: 'Privacy policy · AI Checkout',
    description:
      'What the AI Checkout extension keeps on your device, what it reads on cart pages, the requests it makes for card terms and the store list, and the optional usage reports you can share, stop and delete.',
    body: (
      <>
        <PageIntro eyebrow="AI Checkout" title="Privacy policy">
          <p>
            AI Checkout is a Chrome extension published by Evan Liu (“we”, “us”). This policy covers the
            Chrome Web Store build of the extension, version 2.1.0, and the AI Checkout service it connects
            to.
          </p>
          <p className="muted small">
            Last updated 2026-11-06 · Operator: Evan Liu (the AI Checkout project) · Contact:
            evanliu7788@gmail.com
          </p>
        </PageIntro>
        <Section id="summary" title="Summary">
          <ul className="prose-list">
            <li>
              Your cards, settings and purchase inputs stay in your Chrome profile. There’s no account, and no
              AI model runs at checkout.
            </li>
            <li>
              On a cart or checkout page, the extension reads the order-summary amount and its currency. It
              doesn’t collect item names, addresses or payment fields, and it doesn’t save the page’s web
              address.
            </li>
            <li>
              The extension downloads published card terms and a store list. These requests carry none of your
              cards, amounts, settings or page addresses.
            </li>
            <li>
              Usage reports are optional and off until you choose Share. They carry a random identifier: no
              name, email or browsing history. You can stop sharing at any time, and delete reports sent under
              your identifier while you still share. Two buttons, Suggest this store and Report a problem,
              send a store’s domain when you tap them, even without Share.
            </li>
            <li>We don’t sell your information or use it for advertising.</li>
          </ul>
        </Section>
        <Section id="does" title="What AI Checkout does">
          <p>
            AI Checkout tells you which of the credit cards you already own earns the most on the cart or
            checkout page you’re viewing. You pick your cards once. On the cart or checkout page of any https
            store, a small badge shows your best card and its estimated reward. When the cart amount can’t be
            read with certainty, the badge ranks your cards by rate instead. The toolbar popup compares any
            purchase. The comparison is arithmetic over published card terms and runs on your device. There’s
            no bank connection and no payment processing.
          </p>
        </Section>
        <Section id="stored" title="Information stored on your device">
          <p>
            The extension saves the following in its own Chrome storage. Each time it starts, it restricts
            that storage to its own pages and service worker, so websites and the extension’s content scripts
            can’t read it. Your cards and inputs are unencrypted unless you turn on passphrase protection.
          </p>
          <ul className="prose-list">
            <li>
              The cards you picked (as catalog identifiers, never card numbers, security codes or balances)
              and your default card.
            </li>
            <li>
              Card options: bonus categories you chose, answers to optional membership, status and account
              questions (for example a Prime membership or when an account was opened), spending you report
              toward a card’s cap with its date, activation choices and point values you set.
            </li>
            <li>
              Badge settings: whether the badge is on, and the sites you turned it off for with{' '}
              <strong>Not on this site</strong> (their hostnames).
            </li>
            <li>
              Your latest purchase inputs in the popup (store, amount, date and eligibility choices) and
              what’s needed to show or invalidate a saved comparison (catalog version, revision and
              timestamps).
            </li>
            <li>
              After a cart read from the popup: the amount and currency, its kind (total, estimated total or
              subtotal), the matched store, the reader version, the capture time, a random capture identifier,
              the tab and document identifiers, and a hash of the page address used to notice that the page
              changed (a freshness check, not a privacy measure). The address itself isn’t saved.
            </li>
            <li>The most recent card catalog and store list downloaded (public data).</li>
            <li>
              In builds with usage reporting: your answer to the consent question, the random identifier
              created when you chose Share, reports waiting to be sent (at most 200), and the time sharing
              started (or, if you never shared, when you first answered or tapped Suggest or Report), from
              which only a month and an age range are ever sent. This state is never encrypted because it
              holds no wallet data. <strong>Stop sharing</strong>, <strong>Delete my data</strong> and{' '}
              <strong>Delete all local data</strong> delete the identifier and waiting reports.
            </li>
          </ul>
          <p>
            While a tab is open, the extension also keeps the following in Chrome’s session memory for that
            tab: the matched store and the tab’s hostname (never the page path), the latest cart reading, an
            amount you typed in the badge, your payment-method choice, whether you dismissed the badge,
            whether a cart or checkout page was read, which recommendation was last reported (if you share)
            and whether you suggested the store. Session memory is cleared when the tab closes or Chrome
            restarts. Nothing is synced to other devices.
          </p>
        </Section>
        <Section id="reads" title="Information read on web pages">
          <p>
            The extension asks for access to every https website because a cart can be at any store. It uses
            that access only as described here.
          </p>
          <ul className="prose-list">
            <li>
              <strong>On every https page.</strong> A packaged script runs in the top frame after the page
              loads. It checks the page’s address and title for a cart or checkout word (such as cart, basket,
              bag or checkout, or an equivalent in another language). On a page with neither, it reads nothing
              from the page and observes none of its content. It only notices when the address changes without
              a reload, as on single-page stores, and checks the new address the same way.
            </li>
            <li>
              <strong>On a cart or checkout page.</strong> The script reads the visible text of the main
              content to find the order summary (Subtotal, Shipping, Tax, Total) and cart line items. To
              determine the currency, it also reads the page’s structured data (for example a{' '}
              <code>priceCurrency</code> value), currency meta tags and attributes, the country code of the
              store’s web address and the page language. It keeps watching the page while you’re on the cart
              so the badge follows quantity changes, up to 120 readings per page load.
            </li>
            <li>
              <strong>What leaves the page.</strong> Only the reading goes to the extension’s own service
              worker on your device: whether an amount was found, the amount in cents, its kind, the currency
              and the reader version, or a reason code when no amount is shown (for example an empty cart,
              another currency or an amount that couldn’t be read with certainty). It never includes item
              names, addresses, form values, card numbers, the page’s text or its address. The script makes no
              network request.
            </li>
            <li>
              <strong>The store is matched on your device.</strong> The extension downloads the whole
              published store list and compares the tab’s hostname with it locally, so the service never
              learns which stores you visit. On a payment processor’s page (PayPal, Shop Pay, Klarna and
              others), no badge is shown and nothing is kept.
            </li>
            <li>
              <strong>Isolated badge.</strong> Your card names and amounts appear in a frame on an extension
              page that the store’s page can’t read. Clicks on it count only while it’s fully visible.
            </li>
            <li>
              <strong>The popup.</strong> When you open the popup or choose <strong>Read cart amount</strong>,
              it reads the open tab the same way, with the same packaged script. On an http page, it reads
              only when you choose <strong>Read cart amount</strong>; the badge never runs there. The popup
              uses the tab’s address in memory to match the store and never saves it.
            </li>
            <li>
              <strong>Turning it off.</strong> To turn the badge off for a site, choose{' '}
              <strong>Not on this site</strong>. To turn it off everywhere, use the badge switch in Settings.
            </li>
          </ul>
          <p>
            Amounts in another currency aren’t compared (U.S. dollars only). The extension doesn’t read card
            numbers, security codes, bank credentials, addresses, payment fields or product names, and it
            doesn’t request or read your browsing history.
          </p>
        </Section>
        <Section id="requests" title="Information sent to the AI Checkout service">
          <p>
            Card terms and the store list are published as data, and nothing the extension downloads is code.
            The Chrome Web Store build makes these requests to{' '}
            <code>https://ai-checkout-api.onrender.com</code>:
          </p>
          <ul className="prose-list">
            <li>
              <strong>
                <code>GET /v1/catalog</code> and <code>GET /v1/merchants</code>
              </strong>{' '}
              download the published card terms and the store list, which the extension validates against
              fixed schemas before use. They run right after installation and again a few minutes later, then
              weekly (with one retry a few minutes later if a weekly attempt fails), and whenever you choose{' '}
              <strong>Check for updated terms</strong>. Card terms expire 30 days after they were verified;
              the weekly check keeps them current. These requests carry no cookies, no referrer and none of
              your cards, amounts, settings or page addresses.
            </li>
            <li>
              <strong>Usage reports</strong> are sent only after you choose Share, except for the two things
              you send on purpose. Both are described in the next section.
            </li>
          </ul>
          <p>
            Like any web request, each request reveals your IP address, your browser’s user agent and the time
            of the request to the service’s host, which records them in access logs. Evan Liu operates the
            service for the AI Checkout project (
            <Link href={REPO} isExternal>
              github.com/evanxliu1/AICheckout
            </Link>
            ). It’s hosted on Render, with its data stored in Supabase. Access logs are kept according to
            those providers’ log retention, which AI Checkout doesn’t control, and deleting your data in the
            extension can’t delete them. If you open a card’s issuer link, the issuer’s website and its own
            privacy policy apply. Chrome and the Chrome Web Store handle installation and updates under
            Google’s terms. A build made from source without a catalog endpoint makes none of these requests
            and has no usage reporting.
          </p>
        </Section>
        <Section id="reports" title="Usage reports (optional)">
          <p>
            After you pick your cards, the extension asks once whether to <strong>Share</strong> usage reports
            or choose <strong>Not now</strong>. Reports help improve the cart reader, the store list and the
            recommendations. The extension works the same either way, and you can change your answer at any
            time in Settings in the toolbar popup. Apart from the two things you send on purpose (described
            below), nothing about your use leaves the device before you choose Share.
          </p>
          <ul className="prose-list">
            <li>
              <strong>A random identifier, no name, email or browsing history.</strong> Every report carries
              an identifier that’s created when you choose Share, so repeated reports from one install can be
              told apart. Because the identifier persists and some reports carry exact amounts, this data is
              pseudonymous: it can’t be tied to you by name, but reports from one install can be linked to
              each other. Each report also carries its own random report identifier, the time it was built,
              the versions of the extension, card terms, store list and cart reader in use, the versions of
              the consent text and of the dictionary, and the month you chose Share with how long ago that was
              (as a range: 0, 1–6, 7–13, 14–29, 30–59 or 60+ days).
            </li>
            <li>
              <strong>What reports contain.</strong> The public{' '}
              <Link href={DICTIONARY} isExternal>
                event dictionary
              </Link>{' '}
              lists every field. Reports say that sharing started and that setup finished, with how many cards
              you picked; the cards you own, as catalog identifiers, when sharing starts and whenever you
              change them; each recommendation shown (in the badge or the popup and in which view, the
              recommended card, how many cards you have, the store’s category, whether the store is one the
              list names and the evidence for its category, whether it was a cart or checkout page or a popup
              read, the exact cart amount read in cents and its kind, or that it wasn’t read, and whether an
              unanswered card question could change the ranking); the badge expanded or dismissed (with its
              view), a site switched off and the popup opened (with what its read found), each with whether
              the list names the store; how far an amount you typed was from the one read (as a range); each
              refresh of card terms or the store list (what started it, whether it worked, and the versions
              before and after); and error codes when a request fails, with where it happened, without
              messages, addresses or page content.
            </li>
            <li>
              <strong>What an automatic report never contains:</strong> a store name, domain or web address,
              the page’s text, item names, card numbers, your name or email, or your browsing history. The
              extension’s service worker builds reports from what it already knows. The scripts that run on
              web pages send nothing anywhere.
            </li>
            <li>
              <strong>Two things you send on purpose.</strong> “Suggest this store” (in the popup or the badge
              panel, at a store the list doesn’t name) and “Report a problem” (in the popup, with a fixed
              reason and no text field) send the store’s registrable domain (for example{' '}
              <code>example.com</code>) with that one request. They also send the page kind (Suggest) or the
              reason and what the badge showed (Report), plus the versions, month and age range described
              above. They work whether you share or not. When you don’t share, they carry no identifier, so
              they cannot be deleted on request and expire with the 90-day retention.
            </li>
            <li>
              <strong>How reports are sent and kept.</strong> Reports wait on your device (at most 200) and go
              to <code>POST /v1/events</code> on the same service every 15 minutes while any are waiting, at
              once when 50 are waiting, when you choose Share, and when you tap Suggest or Report. The service
              accepts at most 500 reports per identifier per day and keeps raw reports for{' '}
              <strong>90 days</strong>. A scheduled job on the service deletes older reports once a day (03:17
              UTC), and the service also deletes them each time it receives, deletes or summarizes reports, so
              a report is gone within about a day after it turns 90 days old. Aggregate counts with no
              identifier (for example how often a store was suggested) may be kept longer. Reports are
              reviewed as these aggregate counts and as the list of suggested store domains with their counts.
            </li>
            <li>
              <strong>Your controls in Settings.</strong> <strong>Stop sharing</strong> (turning the toggle
              off) deletes the identifier and any waiting reports on the device and sends nothing more.
              Reports already sent can then no longer be deleted from the extension and expire after 90 days.{' '}
              <strong>Delete my data</strong> sends your current identifier to{' '}
              <code>POST /v1/events/delete</code>, which deletes every report stored under it, and then stops
              sharing. To delete earlier reports, use it before you stop sharing. Choosing Share again creates
              a new identifier. If the service is unavailable, the extension tells you that nothing was
              deleted yet so you can try again.
            </li>
          </ul>
        </Section>
        <Section id="use" title="How we use and share information">
          <p>
            Reports are used to see whether the cart reader shows amounts on real stores, which stores
            shoppers want added and whether recommendations are used, and to fix errors. Reports are not sold,
            not used for advertising, not used to decide creditworthiness or lending, and not sent to an AI
            provider or any third party other than the hosting providers named above. AI Checkout’s use and
            transfer of information received from users adheres to the Chrome Web Store User Data Policy,
            including the Limited Use requirements. If we ever want to use reports for another purpose, we’ll
            ask you first and update this policy.
          </p>
        </Section>
        <Section id="vault" title="Optional passphrase protection">
          <p>
            Protection is off by default. Saved data is stored unencrypted in the extension’s storage, which
            websites and the extension’s content scripts can’t read but someone with access to your device or
            Chrome profile could. To encrypt it, turn on <strong>Protect with a passphrase</strong> in
            Settings. The extension then encrypts your saved data with a key derived from a passphrase you
            choose; the passphrase isn’t saved. While the data is locked, the badge only asks you to unlock.
            The unlock key stays in Chrome’s session memory until you choose{' '}
            <strong>Lock saved inputs</strong>, restart Chrome, or the extension reloads or updates. Closing
            the popup doesn’t lock. Format metadata (a random identity, salt, revision and the encrypted
            record’s length) stays unencrypted, and so do the downloaded catalog and store list and the
            usage-reporting state, which hold no wallet data.
          </p>
          <p>
            While the data is unlocked, someone using your Chrome profile can see your inputs. Encryption
            doesn’t protect a device that’s already compromised, earlier unencrypted copies or backups made
            outside the extension. A forgotten passphrase can’t be recovered; use{' '}
            <strong>Delete saved data</strong> to start again. Never enter payment credentials in the
            extension.
          </p>
        </Section>
        <Section id="delete" title="Data retention and deletion">
          <ul className="prose-list">
            <li>
              Your cards, options, settings and purchase inputs stay in this Chrome profile until you change
              them, delete them or uninstall the extension. A cart read becomes unusable after five minutes
              and a comparison after fifteen. These are freshness limits, not scheduled deletion.
            </li>
            <li>
              <strong>Delete all local data</strong> (expand <strong>Delete saved data</strong> in the popup
              and confirm) clears everything the extension saved, including the downloaded catalog and store
              list, the unlock key and the usage-reporting state (your answer, the identifier and waiting
              reports). While you’re sharing, it first sends your identifier to{' '}
              <code>POST /v1/events/delete</code>, exactly as <strong>Delete my data</strong> does, and clears
              this device only after the service confirms the deletion. If the service can’t be reached or
              refuses, nothing is cleared and the extension offers <strong>Try again</strong> or{' '}
              <strong>Clear this device anyway</strong>, which keeps the reports already sent until they
              expire. Card setup then starts again, and nothing is shared until you choose Share again.
              Deleting doesn’t affect a store’s cart, your browser history or issuer records.
            </li>
            <li>
              <strong>Delete my data</strong> (in Settings) deletes the usage reports stored under your
              identifier on the service, as described above.
            </li>
            <li>
              <strong>Uninstalling</strong> removes the extension’s storage from your device. Chrome then
              opens a <Link href="/uninstalled/">page on this site</Link>, with no parameters, that repeats
              these points. Reports already sent are deleted within about a day after they turn 90 days old.
              To delete them sooner, use <strong>Delete my data</strong> or{' '}
              <strong>Delete all local data</strong> before you uninstall, because the identifier is removed
              with the extension.
            </li>
          </ul>
        </Section>
        <Section id="rights" title="Your choices and rights">
          <p>
            Everything the extension holds about you is on your device, where you can see it in the popup and
            delete it. For usage reports, the only data the service holds under an identifier, the controls
            above let you stop sharing and delete reports without contacting anyone. Because the identifier is
            random and the service holds nothing else about you, no one can find your reports from your name
            or email; <strong>Delete my data</strong> is the way to delete them. AI Checkout doesn’t sell
            personal information and doesn’t share it for cross-context behavioral advertising.
          </p>
        </Section>
        <Section id="children" title="Children">
          <p>
            AI Checkout is not directed at children under 13 and doesn’t knowingly collect information from
            them. It’s offered in the United States only.
          </p>
        </Section>
        <Section id="site" title="This website">
          <p>
            This site sets no cookies, runs no analytics and loads nothing from other domains. It’s served by
            the same service on Render, whose access logs record IP address, user agent and request time.
          </p>
        </Section>
        <Section id="changes" title="Changes to this policy">
          <p>
            Before a change to what the extension collects or sends takes effect, we update this policy and
            the extension’s consent and settings text, and change the date at the top of this page. Material
            changes to usage reporting ask for your consent again.
          </p>
        </Section>
        <Section id="contact" title="Contact us">
          <p>
            For questions about this policy or your data, email evanliu7788@gmail.com. To report a security
            vulnerability, see <Link href="/support/">Support</Link>.
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
      'The badge appears at https stores, on cart and checkout pages whose address or title names the cart or checkout, after the order summary loads. In the popup, check Settings → Cart badge (the badge switch and the sites you turned off), and check whether you dismissed the badge in this tab (dismissal lasts until the tab closes). Payment pages such as PayPal never show it. If a real cart gets no badge, use Report a problem in the popup.',
    ],
    [
      '“Pick your cards to see your best card”',
      'No cards are saved yet. Click the badge to open setup, or use the button beside it to dismiss it for this tab.',
    ],
    [
      '“Unlock to see your best card”',
      'Passphrase protection is on and your data is locked. Click the badge or the toolbar button, and then unlock.',
    ],
    [
      'Rates instead of an amount (“The cart amount was not read”)',
      'The order summary wasn’t found or the amount wasn’t certain, for example because of a credit that may or may not apply. The ranking by rate is still correct for this store. To see dollar estimates, type the amount in the panel.',
    ],
    [
      '“This page doesn’t look like a cart or checkout page”',
      'The popup reads cart and checkout pages only. Type the amount instead.',
    ],
    [
      '“This comparison supports USD only”, or no badge on a cart in another currency',
      'AI Checkout compares U.S.-dollar purchases only.',
    ],
    [
      '“… is a payment page, not the store’s”',
      'PayPal, Shop Pay and similar checkout pages belong to the payment provider, so the store can’t be identified. Compare from the store’s own cart page.',
    ],
    [
      'The amount is labeled subtotal or estimated total',
      'Tax and shipping aren’t included yet, or the store’s total is still an estimate. When you know the final charge, enter it.',
    ],
    [
      'A range instead of one amount, or “Compare the conditions”',
      'A condition is unknown: your spend toward a cap, an activation, or how PayPal or buy-now-pay-later will post. To narrow the range, confirm the condition in Edit cards or the payment selector.',
    ],
    [
      'The wrong store is matched, or its category looks wrong',
      'The store list matched the site’s address. In the popup, use Report a problem and choose “The store was recognized as another store” or “The recommended card looks wrong”. The report carries the store’s domain, the reason and what the badge showed.',
    ],
    [
      '“Another U.S. online store” for a store you expected to be named',
      'The store list doesn’t name it yet. Choose Suggest this store in the popup, or Store not recognized? Suggest it in the badge panel. The store’s domain is sent so the store can be added.',
    ],
    [
      '“Checking for updated terms…”',
      'The extension is downloading the current card terms, after a new install or because the saved terms expired. This takes a few seconds, or longer if the service is starting up.',
    ],
    [
      '“These card terms have expired” or “Card terms need attention”',
      'Card terms are valid for 30 days after they were verified and are refreshed weekly in the background. In the popup, choose Check for updated terms. If that fails, you’re offline or the service is unavailable; comparisons resume after a refresh succeeds. Don’t change your computer’s date.',
    ],
    [
      'Offline',
      'Cart reads and comparisons work offline while the saved terms are valid. Only refreshes and usage reports need a connection.',
    ],
    [
      'A saved cart amount changed or expired',
      'Read the cart again and confirm the current amount. Navigating, changing quantities and time limits invalidate a read.',
    ],
    [
      'Reported spend became unknown',
      'Spend you reported on an earlier day is no longer assumed current. Update it in Edit cards; the extension can’t see your transactions.',
    ],
    [
      '“Your saved inputs changed in another window”',
      'Reopen the popup to load the saved inputs before you change them again.',
    ],
    [
      'Forgot the passphrase',
      'It can’t be recovered. Open Delete saved data, confirm, and set up your cards again.',
    ],
    ['“Saved data could not be read”', 'Use Delete all local data, and then pick your cards again.'],
  ];
  return {
    title: 'Support · AI Checkout',
    description:
      'Get started with AI Checkout, fix common issues, manage usage reports, delete your data and report a problem.',
    body: (
      <>
        <PageIntro eyebrow="Support" title="AI Checkout help">
          <p>
            Set up the extension, fix common issues and report a problem. For anything else, email
            evanliu7788@gmail.com. This page describes extension version 2.1.0.
          </p>
        </PageIntro>
        <Section id="start" title="Get started">
          <ol className="prose-list">
            <li>
              After you install the extension, a setup tab opens. Under <strong>Add a card</strong>, type part
              of a card or bank name and pick each card you own. Choose your default card, and then choose{' '}
              <strong>Save cards</strong>. For some cards, setup also asks which bonus categories you chose,
              about a membership, status or account that a bonus depends on (“Not sure” shows a range), and
              what a point is worth to you. You don’t need a card number, a login or a passphrase.
            </li>
            <li>
              Setup then asks once whether to <strong>Share</strong> usage reports or choose{' '}
              <strong>Not now</strong>. The extension works the same either way. To change your answer later,
              go to <strong>Settings → Usage reports</strong> in the toolbar popup.
            </li>
            <li>
              Open your cart at any U.S. online store. A badge in the bottom-right corner shows your best card
              and its estimated reward, or your cards ranked by rate when the amount can’t be read with
              certainty. Click the badge to see every card’s estimate, the issuer’s rule, a payment-method
              choice and an optional amount field.
            </li>
            <li>
              To compare any other purchase, open the toolbar popup, type the amount, confirm the eligibility
              assumption and choose <strong>Compare my cards</strong>. If you open the popup on a cart, it
              reads the amount for you.
            </li>
          </ol>
          <p>
            To change your cards later, open the toolbar popup and choose <strong>Edit cards</strong>. Points
            and miles are compared in cash at a published estimate unless the issuer states a value or you set
            your own under <strong>Point values</strong>.
          </p>
        </Section>
        <Section id="issues" title="Troubleshooting">
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
        <Section id="reports" title="Manage usage reports">
          <p>
            In the popup, go to <strong>Settings → Usage reports</strong>. The{' '}
            <strong>Sharing usage data</strong> toggle turns sharing on, which creates a new random
            identifier, or off. Turning it off (<strong>Stop sharing</strong>) deletes the identifier and any
            waiting reports and sends nothing more. <strong>Delete my data</strong> asks the service to delete
            every report stored under your current identifier, and then stops sharing. To delete earlier
            reports, use it before you stop sharing. In any case, the service deletes each report within about
            a day after it turns 90 days old. For what a report contains, see the{' '}
            <Link href="/privacy/">privacy policy</Link>.
          </p>
        </Section>
        <Section id="delete" title="Delete your data">
          <p>
            In the popup, expand <strong>Delete saved data</strong>, confirm, and choose{' '}
            <strong>Delete all local data</strong>. If you share usage reports, the extension first asks the
            service to delete the reports stored under your identifier (as <strong>Delete my data</strong>{' '}
            does) and clears this device only after that succeeds. If the service can’t be reached, nothing is
            cleared, and you can choose <strong>Try again</strong> or{' '}
            <strong>Clear this device anyway</strong>. With Clear this device anyway, reports already sent
            stay on the service until they expire after 90 days.
          </p>
          <p>
            Deleting clears your cards, options, settings, purchase inputs, the downloaded terms and store
            list, the unlock key, and the usage-reporting identifier and answer. Card setup then starts again.
            It doesn’t affect a store’s cart or your browser history. Uninstalling the extension also removes
            its storage from your device, but reports already sent stay until they expire, so use Delete my
            data or Delete all local data first if you want them deleted sooner.
          </p>
        </Section>
        <Section id="limits" title="Known limitations">
          <ul className="prose-list">
            <li>
              {CARD_COUNT} cards from ten U.S. issuers, and U.S. stores and U.S. dollars only. Other cards,
              benefits and countries aren’t covered.
            </li>
            <li>
              Estimates follow the issuers’ terms. How a purchase actually posts (its merchant category, or
              payment through PayPal or buy-now-pay-later) can change the reward, so the extension can’t
              guarantee one.
            </li>
            <li>
              The cart reader shows an amount only when it’s certain of it. On some carts, that means you see
              the rates view and type the amount.
            </li>
            <li>The Chrome Web Store listing isn’t published yet.</li>
          </ul>
        </Section>
        <Section id="report" title="Report a problem">
          <p>
            In the extension, open the popup on the store’s page, choose <strong>Report a problem</strong> and
            pick one of the fixed reasons (“The amount shown is wrong”, “No badge appeared on a cart or
            checkout page”, “The store was recognized as another store”, “The recommended card looks wrong” or
            “Something else”). The report carries the store’s domain, the reason and whether the badge showed
            an amount. It includes your random identifier only if you share usage reports. There’s no text
            field.
          </p>
          <p>
            On GitHub, open an issue with the extension and Chrome versions, the store and page type (cart or
            checkout), the exact message and the steps to reproduce it. Use a made-up amount if that helps.
          </p>
          <AlertInline color="critical" title="Don’t include personal information" role="none">
            <p>
              GitHub issues are public. Never include your passphrase, card numbers, bank credentials, full
              cart addresses, product lists, your home address or unredacted screenshots.
            </p>
          </AlertInline>
          <p>
            To report a security vulnerability, don’t open a public issue. Report it privately through{' '}
            <Link href={`${REPO}/security/advisories/new`} isExternal>
              GitHub private vulnerability reporting
            </Link>{' '}
            (see the{' '}
            <Link href={`${REPO}/blob/main/SECURITY.md`} isExternal>
              security policy, SECURITY.md
            </Link>
            ).
          </p>
          <p>
            <Link href={`${REPO}/issues`} variant="standalone" icon="arrow-right" isExternal>
              Open an issue on GitHub
            </Link>
          </p>
          <p className="muted small">
            Support is provided on a best-effort basis, with no guaranteed response time.
          </p>
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
      'Data sources and licenses behind AI Checkout: the public purchase-card datasets that inform store categories, the point valuations, and the design system and fonts.',
    body: (
      <>
        <PageIntro eyebrow="Credits" title="Data sources and licenses">
          <p>
            AI Checkout is an open-source project (MIT license) by Evan Liu. Card terms come from the issuers’
            own published pages. The store list and the interface use the openly licensed sources below.
          </p>
        </PageIntro>
        <Section id="merchant-data" title="Store categories: public purchase-card data">
          <p>
            Part of the store list’s category evidence (records whose evidence basis is <code>mcc</code>, in
            release <code>2026-10-11.mcc.1</code> and later) is derived from openly licensed public
            card-transaction datasets. The datasets themselves aren’t redistributed. For each store, the
            release records only aggregates: at most twelve merchant-descriptor and merchant-category
            description fragments with row counts, and description tallies.
          </p>
          <p>
            <strong>Changes made to the source data:</strong> the transactions were pooled across the
            datasets, matched to store records by merchant descriptor, and aggregated to per-store counts by
            merchant category description. No row, amount, cardholder, agency or date is kept or published.
          </p>
          <Table
            caption="Public purchase-card datasets used for store categories"
            isCaptionHidden
            columns={[
              { key: 'dataset', label: 'Dataset', isRowHeader: true, render: (row) => row.dataset },
              { key: 'publisher', label: 'Publisher', render: (row) => row.publisher },
              { key: 'licence', label: 'License', render: (row) => row.licence },
            ]}
            rows={DATASETS}
            rowKey={(row) => row.publisher}
            className="harness-table"
          />
          <p>
            Merchant category codes are mapped through the Visa Merchant Data Standards Manual (April 2026,
            marked “VISA PUBLIC”, © 2026 Visa). The Visa manual is referenced, not reproduced. Other category
            evidence comes from each store’s own pages and from card issuers’ published terms. The extension
            shows the evidence basis beside each store’s category.
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
            (read 2026-10-02). An estimate is the publisher’s opinion, not an issuer fact. The extension
            labels it as an estimate, and a program with no published value is compared in points.
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
            bundled with the extension and this site. Card names and store names belong to their owners. AI
            Checkout is not affiliated with any issuer or retailer.
          </p>
          <p>
            <Link
              href={`${REPO}/blob/main/evals/merchants/db/mcc/NOTICE.md`}
              variant="standalone"
              icon="arrow-right"
              isExternal
            >
              Data attribution notice (NOTICE.md on GitHub)
            </Link>
          </p>
        </Section>
      </>
    ),
  };
}

function Uninstalled(): Rendered {
  return {
    title: 'AI Checkout was removed · AI Checkout',
    description:
      'What removing the AI Checkout extension deleted from your device, and what happens to usage reports you shared.',
    body: (
      <>
        <PageIntro eyebrow="AI Checkout" title="AI Checkout was removed">
          <p>
            Chrome opens this page when you remove the extension. The page address carries no parameters, so
            nothing about you or your install was sent to show it.
          </p>
        </PageIntro>
        <Section id="device" title="What was deleted from your device">
          <p>
            Chrome removed the extension’s storage with it: your cards and options, settings, purchase inputs,
            the downloaded card terms and store list, any passphrase-protected record and its unlock key, and,
            if you shared usage reports, the random identifier and any reports waiting to be sent. Nothing
            from the extension remains in your Chrome profile. The extension never changed your stores’ carts
            or your browser history.
          </p>
        </Section>
        <Section id="server" title="Usage reports you shared">
          <p>
            If you chose <strong>Share</strong>, reports already sent are stored on the AI Checkout service
            under your random identifier and <strong>expire after 90 days</strong>. A scheduled job on the
            service deletes expired reports once a day, so each report is gone within about a day after it
            turns 90 days old. Reports carry no name, email or browsing history, and no store address unless
            you tapped Suggest this store or Report a problem.
          </p>
          <p>
            Deleting reports sooner requires the identifier, which was removed from your device with the
            extension. That’s why <strong>Delete my data</strong> (Settings → Usage reports in the popup) or{' '}
            <strong>Delete all local data</strong> has to be used <em>before</em> uninstalling: either one
            deletes every report stored under the identifier at once. If you reinstall, the extension creates
            a new identifier; the old reports can’t be found again and expire on their own. If you never chose
            Share, the service holds nothing under an identifier. A store suggestion or problem report you
            sent was stored without one and expires after 90 days.
          </p>
        </Section>
        <Section id="more" title="More information">
          <p>
            <Link href="/privacy/">Privacy policy</Link> · <Link href="/support/">Support</Link> ·{' '}
            <Link href={`${REPO}/issues`} isExternal>
              Tell us why you removed it
            </Link>{' '}
            (optional; creates a public GitHub issue)
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
