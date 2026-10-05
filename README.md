<h1 align="center">
  <img src="extension/assets/cart-mark.svg" width="56" alt="" /><br />
  AI Checkout
</h1>

<p align="center">
  A Chrome extension that tells you which card you already own earns the most at checkout.<br />
  An LLM keeps its 178-card catalog current from issuer terms, and a person approves every release.
</p>

<p align="center">
  <a href="https://github.com/evanxliu1/AICheckout/actions/workflows/extension.yml"><img src="https://github.com/evanxliu1/AICheckout/actions/workflows/extension.yml/badge.svg" alt="Application checks" /></a>
  <a href="https://github.com/evanxliu1/AICheckout/actions/workflows/database.yml"><img src="https://github.com/evanxliu1/AICheckout/actions/workflows/database.yml/badge.svg" alt="Database checks" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-1d5fb4" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://ai-checkout-api.onrender.com/">Site</a> ·
  <a href="https://ai-checkout-api.onrender.com/results/">Eval results</a> ·
  <a href="docs/readme/demo.mp4">Demo video</a> ·
  <a href="docs/release/assets/full-stack-demo.mp4">Curation walkthrough</a> ·
  <a href="wiki/system/architecture.md">Architecture</a> ·
  <a href="wiki/index.md">Development wiki</a>
</p>

https://github.com/user-attachments/assets/f6575a3d-7a54-449f-818d-8e5908a4fafb

## Why it's built this way

Turning pages of issuer terms into structured reward rules is extraction, which an LLM does well. Picking a card at checkout is arithmetic over those rules, which should be exact, fast and private. The project is split at that line:

- **No model at checkout.** A pure TypeScript engine ranks your cards in integer cents and basis points, with spending caps and explicit ranges when an input is unknown. It runs offline, needs no API key, and your wallet never leaves the browser.
- **The LLM curates, and it has no write path.** It drafts each card's reward rules from captured issuer pages into a strict schema. Every stated value has to quote the source; quotes are checked against the captured page, and one that doesn't match flags the run for review. Independent agents verify the drafted rules; a person approves each release, and publication is a separate explicit step.
- **The extraction is measured.** An offline eval scores models and prompts on real issuer terms, with held-out issuers and planted prompt injections.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/architecture-dark.svg" />
  <img src="docs/readme/architecture-light.svg" width="100%" alt="Architecture. At checkout, in the browser: a supported cart is read for its order-summary amount, the deterministic rewards engine ranks the cards in your wallet, and the badge and popup show the result; no model runs. On the maintainer side: issuer terms are captured, an LLM extracts rules into a strict schema, quotes are matched against the page and misses are flagged, agents verify and a person signs off, and an immutable catalog release is published. The catalog is bundled with the extension, with an optional refresh from GET /v1/catalog." />
</picture>

On a supported cart (Amazon, Best Buy and Newegg in the US), a badge shows the best card without a click, for example "Use Blue Cash Everyday · $3.00 back". The popup ranks every card you own for that purchase and names any condition it can't check. The 178-card catalog is bundled. Hosted builds can also check `/v1/catalog` for a newer release when you ask; that is the only network request, and it never sends cart or wallet data.

### The curation pipeline

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/curation-dark.svg" />
  <img src="docs/readme/curation-light.svg" width="100%" alt="Curation pipeline: capture issuer pages with dates and hashes; extract with gpt-5.6-luna into strict JSON with stated values quoted, using a versioned prompt; validate with the Zod schema and match quotes to the page, flagging any that don't match; independent agents verify and adjudicate (the model cannot write); a person approves each release, which is published as a separate step, producing an immutable release. Every run leaves a trace with prompt, context and schema hashes that the eval replays." />
</picture>

New cards and refreshes go through an agent-driven pipeline (`tools/catalog-pipeline`): research, capture, extraction, label drafting, then verification and adjudication by separate agents, ending at a ready branch. Publishing is a separate step that a person approves for each release. Details: [curation harness](apps/api/src/curation/README.md) · [card-expansion pipeline](wiki/system/card-expansion-pipeline.md).

## Results

Extraction on real issuer terms for seven cards, scored field by field against agent-verified labels. Prompts were written on four dev cards and frozen before the three held-out cards were run. All rows use the guided.2 prompt except the baseline.

| Configuration | Held-out field accuracy | Rule recall | Planted injections reported |
| --- | --- | --- | --- |
| claude-opus-5-5 | 99.2% | 99.4% | 100% |
| gpt-5.6-luna (xhigh), the curation model | 98.3% | 100% | 100% |
| gpt-5.5 (low) | 97.5% | 100% | 100% |
| gpt-6-astra (low), full pages | 97.2% | 100% | 100% |
| claude-sonnet-5 | 93.2% | 100% | 100% |
| claude-haiku-4-5 | 90.9% | 98.7% | 100% |
| gpt-6-astra (low), two-sentence baseline prompt | 83.1% | 97.4% | 100% |

- **The prompt is the biggest lever.** On dev, the same models score 65–83% with a two-sentence prompt and 92–99% with their best guided prompt. Model choice still spans up to 29 points at a fixed prompt.
- **Caveats.** Labels are agent-verified, not human-verified. The Opus and luna held-out rows were added after the other held-out results had been seen; no prompt changed for them. Full tables, failure examples and disclosures are in [results](docs/evals/results.md).
- **At catalog scale** (173 cards, including points cards and merchant-specific rules) gpt-5.5 scores 76.2% end to end and about 94% on the rules it finds; most of the drop is missed merchant and partner rules. The corpus and labelling differ, so this is not directly comparable with the table ([expansion eval](docs/evals/expansion.md)). The pipeline's first run, a Wells Fargo refresh, is in [pipeline v1](docs/evals/pipeline-v1.md).

## What's in the repo

| Area | Highlights |
| --- | --- |
| [Extension](extension/README.md) | React + TypeScript on Manifest V3; minimal permissions; site adapters that read only the order-summary amount, never the items; an optional passphrase lock; state that survives popup closure and worker shutdown |
| [Rewards engine](packages/rewards-core) | Pure, deterministic ranking over a Zod-validated catalog: caps, rotating and merchant rules, points valued in cash where a value is published, issuer-stated or set by you, ranges for unknowns |
| [LLM harness](apps/api/src/curation/README.md) | Versioned prompt, context and schema; `known` / `unknown` / `conflicting` states; citation span validation; injection handling; budgets with atomic reservations; once-only runs; a private trace ledger |
| [Evaluation](evals/curation/README.md) | Offline scorer and trace replay: field accuracy, rule precision and recall, unsupported claims, evidence validity, false "clear" verdicts, cost and latency |
| [Review app](apps/review/README.md) | React app for source evidence, per-condition decisions, draft diffs against the published catalog, and separate publication |
| [Backend](supabase/README.md) | Node 24 + Fastify, Supabase Auth, PostgreSQL with row-level security, a private review schema, transactional publication |
| Testing | About 1,200 unit, component and script tests; Playwright against the packaged extension, review app and site with axe accessibility checks; SQL policy and concurrency tests; CI for both stacks |

```
extension/                Chrome extension: popup, service worker, cart badge, site adapters
packages/rewards-core/    Deterministic rewards engine and catalog schema
packages/catalog-client/  Bounded catalog fetch used by the extension
packages/catalog-review/  Shared curation and review contracts
packages/ui/              React components on the Ocean theme
apps/api/                 Fastify API; the curation harness is in src/curation/
apps/review/              Review app
apps/site/                Public site: overview, results, architecture, privacy, support
tools/catalog-pipeline/   Agent-driven card-expansion pipeline CLI
evals/curation/           Evaluation corpora and scorer docs
supabase/                 Migrations, seed, SQL tests
docs/                     Eval results, release and store materials, README diagrams
wiki/                     Development wiki: current state, decisions, architecture, runbooks
```

## Run it locally

Requires Node 24. The extension needs no accounts or keys.

```sh
npm ci
npm run lint && npm run typecheck && npm test
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, and load `extension/dist`. The API, review app and local database need Docker; see [local setup](wiki/ops/local-setup.md).

## Status

| | |
| --- | --- |
| **Working** | The extension on a 178-card catalog from the top 10 U.S. issuers (American Express, Bank of America, Barclays, Capital One, Chase, Citi, Discover, Synchrony, U.S. Bank, Wells Fargo), cash back and points |
| **Live** | [Site](https://ai-checkout-api.onrender.com/), [results](https://ai-checkout-api.onrender.com/results/), [review app](https://ai-checkout-api.onrender.com/review/) (reviewers only) and the [catalog API](https://ai-checkout-api.onrender.com/v1/catalog) on Render and Supabase. Release 3, the renewed 178-card catalog, was published 2026-10-05 and expires 2026-11-04 |
| **Latest** | Catalog freshness: every source was hash-checked on 2026-10-05, 107 cards were re-verified, and the renewed 178-card catalog was published as release 3 on 2026-10-05 ([freshness results](docs/evals/freshness-2026-10.md)) |
| **Next** | More checkout sites through a merchant pipeline, then a Chrome Web Store release. See the [roadmap](wiki/product/roadmap.md) |

## License

[MIT](LICENSE)

## Credits

`packages/ui` implements components to the specs of [Helios](https://helios.hashicorp.design), HashiCorp's design system, using its design tokens (`@hashicorp/design-system-tokens`) and [Flight icons](https://helios.hashicorp.design/icons/library) (`@hashicorp/flight-icons`), both MPL-2.0, restyled with AI Checkout's own Ocean theme. Fonts: Figtree and Bricolage Grotesque from Fontsource (`@fontsource-variable/*`), SIL Open Font License 1.1. AI Checkout is not affiliated with or endorsed by HashiCorp.
