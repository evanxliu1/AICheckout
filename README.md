# AI Checkout

A Chrome extension that tells you which card you already own earns the most at checkout, backed by an LLM curation pipeline that keeps the card catalog up to date from issuer terms, with a human approving every change.

<p>
  <img src="docs/release/assets/2-comparison-640x400.png" width="49%" alt="Extension popup comparing Blue Cash Everyday ($3.00) and Quicksilver ($1.50) on a $100 Best Buy purchase" />
  <img src="docs/release/assets/full-stack-evidence.png" width="49%" alt="Review app showing extracted reward facts, each linked to an exact source span" />
</p>

**Live:** [site](https://ai-checkout-api.onrender.com/) · [results](https://ai-checkout-api.onrender.com/results/) · [review app](https://ai-checkout-api.onrender.com/review/) (reviewers only) · [catalog API](https://ai-checkout-api.onrender.com/v1/catalog)

[Shopper demo video](docs/release/assets/shopper-demo.mp4) · [Curation demo video](docs/release/assets/full-stack-demo.mp4) · [Design doc](docs/design.md)

## How it works

```mermaid
flowchart LR
  subgraph Extension
    P[Popup] --> W[Service worker] --> R[Deterministic rewards engine]
    L[Cached catalog] --> R
  end
  S[Issuer terms] --> M[LLM extraction harness] --> V[Schema + citation checks] --> A[Human review] --> D[(Postgres releases)]
  D -->|GET /v1/catalog| L
```

- **At checkout, no model runs.** A pure TypeScript engine ranks your cards using integer cents/basis points, spending caps, and explicit uncertainty ranges. It works offline and needs no API key.
- **The LLM keeps the rules current.** It turns captured issuer terms into a structured draft where every fact cites an exact source span. Validation rejects any quote that doesn't match the source. A reviewer applies and publishes changes as separate steps; the model has no write path.
- **Everything is versioned.** Prompt, context, and schema versions are hashed into every trace. Catalog releases are immutable and published atomically.

## Highlights

| Area | What's there |
| --- | --- |
| LLM harness | Versioned prompt/context/schema, strict structured output with `known`/`unknown`/`conflicting` states, citation span validation, prompt-injection handling, token/time/cost budgets with atomic reservations, once-only execution, and a private trace ledger ([details](apps/api/src/curation/README.md)) |
| Evaluation | Offline scorer and replay tool for saved traces: field agreement, fact precision/recall, unsupported claims, evidence coverage, false "clear" verdicts, cost and latency ([details](evals/curation/README.md)). Measured on real issuer terms for seven cards (agent-verified labels), five models (gpt-5.5 at two efforts), three prompts: the best configurations reach 99% end-to-end field accuracy on dev (gpt-6-astra, guided prompt) and 97–99% on held-out issuers (gpt-6-astra 97%, Claude Opus 5.5 99% in a run added after the original held-out set) with 99–100% rule recall, and every planted prompt injection is reported; a detailed prompt is the largest single lever (65–83% with a two-sentence prompt vs 92–99% with each model's best guided prompt), and model choice still spans up to 29 points at a fixed prompt ([results](docs/evals/results.md)) |
| Backend | Node 24 + Fastify API, Supabase Auth, PostgreSQL with RLS, a private review schema, and transactional publication ([schema](supabase/README.md)) |
| Review app | React UI for source evidence, per-condition decisions, draft diffs against the published catalog, and separate publication ([app](apps/review/README.md)) |
| Extension | React + TypeScript on Manifest V3 with minimal permissions, a cart reader that only runs when you click it, and state that survives popup closure and worker shutdown ([extension](extension/README.md)) |
| Testing | ~670 unit/component tests, Playwright tests against the packaged extension, review app and public site (with axe accessibility checks), SQL policy/concurrency tests, and CI for both stacks |

## Repository

```
extension/                Chrome extension (popup, service worker, cart readers)
packages/rewards-core/    Deterministic rewards engine + catalog schema
packages/catalog-client/  Bounded catalog fetch used by the extension
packages/catalog-review/  Shared curation/review contracts
packages/ui/              React components built to the Helios design system specs
apps/api/                 Fastify API; curation harness in src/curation/
apps/review/              React review app
apps/site/                Public site: overview, results, architecture, privacy, support
evals/curation/           Evaluation corpus, scorer docs, baseline
supabase/                 Migrations, seed, SQL tests
docs/                     Design doc, release materials, verification notes
```

## Run it

Requires Node 24. No accounts or keys are needed for the extension.

```sh
npm ci
npm run lint && npm run typecheck && npm test
npm run build
```

Load `extension/dist` from `chrome://extensions` with Developer mode on. For the API, review app, and local database, see [apps/api](apps/api/README.md) and [supabase](supabase/README.md) (Docker required).

## Status

Working: the extension on catalog v2 with 7 cash-back cards (Citi Double Cash, Wells Fargo Active Cash, Capital One Quicksilver and Savor, Chase Freedom Unlimited, Amex Blue Cash Everyday and Preferred) and 3 checkouts read through bundled site adapters (Amazon US, Best Buy US, Newegg US); the Helios UI across the extension, the review app and the public site; CI; and the hosted [site](https://ai-checkout-api.onrender.com/), [results page](https://ai-checkout-api.onrender.com/results/), [review app](https://ai-checkout-api.onrender.com/review/) and catalog API (Render + Supabase).

Pending: publishing the 7-card catalog on the hosted review app, a deliberate human approval ([publish runbook](docs/release/publish-runbook.md)); until then `/v1/catalog` serves no release and the extension uses its bundled catalog. Next: human verification of the evaluation labels, terms-change detection, and a Chrome Web Store release. See the [roadmap](docs/design.md#roadmap).

## License

MIT

## Credits

`packages/ui` implements components to the specs of [Helios](https://helios.hashicorp.design), HashiCorp's design system, using its design tokens (`@hashicorp/design-system-tokens`) and [Flight icons](https://helios.hashicorp.design/icons/library) (`@hashicorp/flight-icons`), both MPL-2.0. AI Checkout is not affiliated with or endorsed by HashiCorp.
