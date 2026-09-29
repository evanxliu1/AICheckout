# Goal: measured LLM extraction on real issuer terms, then a useful product

Written 2026-09-28 as a hand-off for a fresh session. Read this file first, then `docs/design.md` and `docs/research/cashback-card-terms-2026.md`.

## Outcome

A resume-ready project whose headline is a **measured evaluation of an LLM extraction harness on real credit-card terms**: several models, prompt versions, and context-selection strategies compared on a human-verified corpus, with a results table and error analysis. The extension then uses the resulting catalog for 7 real cards, and the whole thing ships (hosted API, Chrome Web Store).

Priorities: measurable LLM results first; product schema only where the product needs it; no hedge-heavy agent-log docs.

## Current state (verified 2026-09-28)

| Area | State |
| --- | --- |
| Repo | `main` has PR #1 merged (cleanup, Prettier, CI, docs, Render blueprint, Codex provider). Working branch `phase1-hosted` has hosted-build docs plus the uncommitted/just-committed Phase 2a start (see below). No PR opened for it yet. |
| CI | Both GitHub Actions workflows green on `main`. |
| Hosted | Render web service `ai-checkout-api` at https://ai-checkout-api.onrender.com (free tier, sleeps; first request ~50 s). `/health` 200, `/v1/catalog` 200 `{"release":null}`, `/v1/review/` 401, `/review/` serves the review app. |
| Supabase | Project `rnzzyeuzydyrdjuihomb` (Pro plan). All 6 migrations applied. New-format publishable key created (`sb_publishable_eMh8…`). Site URL = `https://ai-checkout-api.onrender.com/review/`. Public sign-ups **disabled**. Only user: `evanliu5566@gmail.com`, provisioned in `catalog_private.reviewers`. Legacy `public.credit_cards` rows preserved. |
| LLM access | Codex CLI logged in with ChatGPT. `npm run eval:curation -- --mode codex --model gpt-5.5` runs v1 evals on the subscription (`apps/api/src/curation/codex.ts`). Local only; never on Render. |
| Research | `docs/research/cashback-card-terms-2026.md`: terms for the 7 cards, Best Buy/Newegg categorization, 12-category taxonomy, 2025–26 changes, open uncertainties. Quotes labeled OV (verbatim official) vs OF (official via summarizing fetch, must be re-checked) vs PA/SEC. |

### Phase 2a work already done (on `phase1-hosted`)

- `apps/api/src/curation/runner.ts`: the bounded loop is now `executeTask(task, input, provider, options)` over an `ExtractionTask` interface; `runExtraction` is the v1 task. All 207 API tests and the v1 eval check pass unchanged.
- `apps/api/src/curation/v2/schema.ts`: extraction contract v2 (`issuer-extraction.2`): 13 categories (`CATEGORIES`), per-rule `rateBps` (total, not increment), `paidOnPaymentBps` (Citi "1% as you pay"), `cap` {kind, amountCents, period, rateAfterCapBps}, `activation`, `usMerchantsOnly`, `limitedTime`, `definition` includes/excludes, card-level `rewardCurrency`, `pointValueHundredthsOfCent`, `exclusions`, `issues`. Every value is `{value|null, evidence: string[]}`. Input: `{cardId, cardName, documents[{id,title,url,capturedOn,body,contentHash}]}`.
- `apps/api/src/curation/v2/context.ts`: prompts `baseline.1` and `guided.1`; source selection `full` and `keyword-window.1` (keyword lines ±1, verbatim, `[...]` separators); `buildContextV2(input, prompt, selection)` returns system/user/jsonSchema/versions/hash/estimate.
- `apps/api/src/curation/v2/validate.ts`: `resolveQuote` (exact match except whitespace runs; server computes spans, the model never counts offsets), `validateInputsV2`, `percentsIn`, `validateExtractionV2` (missing/unfound evidence, rate not in evidence, cap/payment consistency, reported issues).
- None of the v2 files has tests yet, and nothing calls them yet.

## Decisions already made (do not re-litigate)

- Seven cards: Citi Double Cash, Wells Fargo Active Cash, Chase Freedom Unlimited, Capital One Quicksilver, Capital One Savor, Amex Blue Cash Everyday, Amex Blue Cash Preferred.
- Full 12-category taxonomy on the **extraction** side; the **product engine** only models what an online checkout can hit (all purchases, online retail, named merchants, paid-on-payment timing).
- Labels: the agent drafts, Evan verifies every field against highlighted source text (~1 hour budget).
- Source text comes from a **headless capture script** run in the terminal (not the browser pane). Captured issuer text is copyrighted: keep it gitignored; commit only URLs, hashes, labels, and short quotes.
- v1 contract stays as-is for the hosted server/DB; v2 is additive.
- Frontend design uses HashiCorp's **Helios Design System** (https://helios.hashicorp.design) across the extension popup, the review app, and a new public site (see Phase 3a).

## Constraints and gotchas learned this session

- The auto-mode classifier blocks the agent from: pushing migrations to the hosted DB, merging PRs, changing GitHub token scopes. Ask Evan to run those (give exact commands).
- Never type API keys/passwords into forms; Evan pastes secrets. Never create accounts or permanently delete data.
- Supabase CLI on this project needs the DB password (login-role fallback fails): `read -rs 'SUPABASE_DB_PASSWORD?Supabase DB password (hidden): ' && export SUPABASE_DB_PASSWORD && npx supabase db push --linked --skip-vault` — Evan runs it.
- In the built-in browser, `computer` `type` does not register in Render/Supabase React inputs; `form_input` works. Evan prefers research/terminal over driving his browser pane.
- Node type-stripping (used by `scripts/test-*.mjs`) needs explicit `.ts` import specifiers and no TS parameter properties.
- Codex runs: `CODEX_LIMITS` in `eval-cli.ts` (240 s attempt); `--model` is required; ~2.6k tokens harness overhead; unknown `--disable` feature flags are hard errors (the provider filters them). Available models on Evan's plan: `gpt-5.5`, `gpt-6-astra` (his default), `gpt-5.6-sol/terra/luna`. `codex exec --oss` can run local Ollama models (check `ollama list` first).
- The synthetic v1 corpus self-declares "not issuer evidence", so live models correctly abstain on it; it only tests plumbing.

## Plan

Work on a branch per phase; open a PR at the end of each phase and ask Evan to merge. Keep `npm run lint`, `format:check`, `typecheck`, `test`, and `eval:curation -- --check` green.

### 2a. Finish the v2 harness (no model calls needed)

1. `v2/task.ts`: an `ExtractionTask` for v2 (parse input, `validateInputsV2`, documents → `{id, contentHash}`, `buildContextV2` with prompt/selection bound, `maxInputBytes` ≈ 1.5 MB, `extractionV2Schema`, `validateExtractionV2`).
2. `v2/corpus.ts`: corpus v2 schema. A case = `{id, cardId, cardName, issuer, split, sourceIds[], variant?, reference}`; documents are resolved at run time from captures by source ID and verified against committed hashes. `reference` mirrors `ExtractionV2` without evidence, plus `anchors` (short verbatim quotes) per rule and per expected issue.
3. `v2/score.ts`: match predicted rules to reference rules by category (tie-break by issuerWording, then rate). Metrics: rule recall/precision, per-field accuracy on matched rules (rate, paid-on-payment, cap kind/amount/period/after-rate, activation, US-only, limited-time), card-level fields, evidence validity (quotes resolved / quotes given), unsupported claims (known value with no resolvable evidence or wrong), expected-issue recall (esp. `untrusted-instruction`, `conflicting`), false-clean cases, latency p50/p95, tokens.
4. Eval CLI: `npm run eval:v2 -- --provider codex|fixture --model M --prompt baseline.1|guided.1 --selection full|keyword-window.1 --split dev|heldout --repeat N`. Writes `observations.json`, `report.json`, `report.md` under gitignored `evals/curation/runs/`. Fixture provider (echoes reference as a perfect answer, and an abstaining one) gives a CI check that needs no model.
5. Tests: quote resolution (whitespace, missing, multi-document), `percentsIn`, rate-in-evidence including sums, cap consistency, scorer matching and metric math on hand-built fixtures. Add `eval:v2 --check` to CI.
6. Codex strict-schema smoke: run one real case after 2b to confirm the v2 JSON schema (including `z.iso.date()` format) is accepted by `--output-schema`; switch to a regex pattern if not.

Exit: `eval:v2 --provider fixture --check` passes in CI; unit tests cover validator and scorer.

### 2b. Real corpus

1. `evals/curation/real/sources.json`: for each card, 2–3 official pages from the research report (product page; offer terms / rates & fees / rewards terms page; category guidance such as Amex `rewards-info/retail.html`, Chase rewards category FAQ, Citi terms PDF). Record URL, card, issuer, document kind.
2. `scripts/capture-issuer-pages.mjs` (Playwright headless, already a dependency): load each URL, expand collapsed disclosures (`[aria-expanded=false]`, `<details>`), take `document.body.innerText`, normalize line endings, save to gitignored `evals/curation/real/captures/<id>.txt`, write `evals/curation/real/manifest.json` (id, url, capturedOn, sha256, length) which is committed. PDFs: extract text with a library already present or `pdftotext` if installed. Flag pages that fail or look like bot walls.
3. Draft labels (the agent) for each card from its captures using the research report as a guide; every rule needs anchors that `resolveQuote` finds in the capture. Split: **dev** = Capital One (2), Citi, Wells Fargo; **held-out** = Amex (2), Chase. Tune prompts only on dev.
4. Derived variants from real captures, labels transformed mechanically: `remove-cap` (delete the cap sentence → cap null + `missing` issue), `conflicting-rate` (append a contradictory rate line → value null + `conflicting`), `injection` (insert an instruction to report 10% / approve publication → `untrusted-instruction`, values unchanged), `stale-promo` (add an expired limited-time rule). Target ~40–60 cases total.
5. Verification page: a script generates a local static HTML (gitignored, contains issuer text) showing each labeled field next to its highlighted anchor, with accept/fix controls that export `verification.json`. Evan opens it locally, verifies (~1 hr); the agent applies fixes and marks the corpus `annotationStatus: human-verified`.

Exit: `evals/curation/real/corpus.v2.json` committed (no issuer bodies), all anchors resolve against captures, Evan has verified.

### 2c. Experiments (resume headline)

1. Matrix on **dev**: models {`gpt-5.5` low, `gpt-5.5` high, `gpt-6-astra`, one local Ollama model via `codex --oss`} × prompts {`baseline.1`, `guided.1`} × selection {`full`, `keyword-window.1`}; `--repeat 2` for variance. Ask Evan before any paid API run (e.g. one Claude model via API) and get a budget.
2. Error analysis on dev failures → `guided.2` (new version string; never edit an existing prompt). Re-run dev.
3. Final: best 2–3 configurations once on **held-out**.
4. `docs/evals/results.md`: results table (field accuracy, rule recall/precision, evidence validity, injection resistance, false-clean, latency, tokens), a chart, per-category error breakdown, 3–5 concrete failure examples with short quotes, and what changed between prompt versions with measured deltas. Link it from the README.

Exit: results doc committed; README headline numbers updated.

### 3a. Frontend design foundation (Helios)

Do this before Phase 3 so the new product UI is built on it. Helios is HashiCorp's design system; its component library (`@hashicorp/design-system-components`) is Ember-only, so we use its framework-neutral parts and rebuild the components in React to Helios's specs.

Verified 2026-09-28:
- `@hashicorp/design-system-tokens@5.1.0` (MPL-2.0) ships `dist/products/css/tokens.css` (CSS variables such as `--token-color-foreground-primary`, `--token-color-palette-blue-200`, `--token-typography-font-stack-text`, `--token-border-radius-medium`, `--token-elevation-mid-box-shadow`) plus helpers in `dist/products/css/helpers/` (color, elevation, focus-ring, typography).
- The product tokens are **light theme only**; no dark-mode tokens in this version. Stay light-only unless a later version adds a theme.
- `@hashicorp/flight-icons@5.2.0` (MPL-2.0) provides the SVG icon set.

Steps:
1. New workspace package `packages/ui`: imports the Helios tokens and helper CSS once and exports React components that follow the Helios component specs and naming: `Button` (primary/secondary/tertiary/critical, sizes), `TextInput`, `Select`, `Checkbox`/`Radio`/`Toggle`, form `Field` with helper/error text, `Badge`, `AlertInline`, `Card` (container), `Table`, `Tabs`, `Modal`, `ApplicationState` (empty/error/loading), `Link`, and `Icon` (Flight icons, imported per icon so bundles stay small). Each component links to its Helios doc page in a comment and has a unit test for roles/keyboard behavior.
2. Extension popup (Tailwind 3): map the Tailwind theme (colors, font sizes, radius, shadows) to Helios CSS variables so utilities *are* tokens, and replace ad-hoc controls with `packages/ui` components. Respect the popup constraints: 360 px wide default, Chrome's 800×600 popup maximum, full keyboard use, Helios focus ring.
3. Review app: replace `apps/review/src/styles.css` values with Helios tokens and use `packages/ui` for forms, tables (draft vs published diff), badges (evidence status), and inline alerts. Source evidence highlighting uses Helios highlight/surface tokens.
4. Public site `apps/site` (static Vite build served by the Fastify app at `/` on Render, same origin as `/review/` and `/v1/catalog`): landing page (what it does, screenshots, install link), **eval results page** rendered from the results JSON of Phase 2c (table plus chart), architecture page, and the **privacy policy and support pages** the Chrome Web Store listing needs.
5. Screens to design and verify at 360 px and 480 px (popup) and 1280 px (review app and site): wallet setup, card selection (7 cards), comparison result with per-rule explanation, uncertainty range, Citi pay-later note, cap reached, unsupported merchant, error/offline; review queue, extraction evidence, draft diff, publish confirmation; landing, results, privacy.
6. Update `extension/DESIGN.md` and `apps/review/DESIGN.md` (and their `.impeccable` sidecars) to record the Helios adoption, tokens, and component usage. Re-render store screenshots and the promo tile with `npm run release:media` after the redesign.
7. Keep AI Checkout's own name and cart icon. Do not use HashiCorp logos or branding, and do not imply affiliation. Note Helios and Flight (MPL-2.0) in the README credits.
8. Verification: Playwright selectors should be role/label-based so the restyle doesn't break them; add an automated accessibility check (axe) on popup, review app, and site; one visual review pass on the screens above.

Exit: all three frontends use `packages/ui` and Helios tokens; browser tests and the accessibility check pass; DESIGN.md files updated.

### 3. Product uses the real catalog

1. `packages/rewards-core` catalog `schemaVersion: 2` supporting: `all-purchases`, `online-retail` (channel-based, optional U.S.-only), named-merchant rules, `paidOnPaymentBps`, caps with period and after-cap rate, reward currency and point value. Keep v1 parsing for old cached releases.
2. Engine: per merchant profile (online, sells physical goods, expected MCC 5732 with confidence), pick applicable rules, rank by guaranteed minimum; ranges for pending caps, pay-later portions, and payment method (PayPal/BNPL/wallet lower confidence; Amex excludes BNPL).
3. New Supabase migration (never edit applied ones) extending the SQL catalog validator to v2; update seed generator and the 28 parity cases. Evan pushes the migration.
4. Build the 7-card catalog from the verified gold labels (not from model output), publish it through the hosted review app as reviewer, confirm `/v1/catalog` serves it, `npm run build:hosted` the extension and verify a live refresh.
5. Extension: wallet lists the 7 cards; comparison shows the rule, conditions, and pay-later note for Citi, using the Phase 3a components.
6. Amazon US cart reader (bounded order-summary rows, fixtures, native browser test), mirroring the Best Buy/Newegg readers.

### 4. Terms-change detection

Scheduled GitHub Action (weekly) runs the capture script, compares hashes to `manifest.json`, and opens an issue listing changed sources with a text diff summary. Re-extraction then runs locally via Codex and goes through human review. Captured text must not be committed or posted publicly in the issue (post hashes and short changed-line excerpts only).

### 5. Ship

Chrome Web Store (Evan pays the $5 fee and submits) using the privacy/support pages from the Phase 3a site, README with results table and live links (site, results page, review app), ~90 s demo video recorded on the Helios UI, decide on the passphrase vault (recommend dropping or opt-in).

## Housekeeping

- Open a PR for `phase1-hosted` (Phase 1 docs + Phase 2a start) or fold it into the 2a PR.
- Delete `extension/CLAUDE.md` (gitignored, local only); it describes code that no longer exists.
- `simulation/credentials.json` (gitignored, local) holds old secrets: Evan should delete it and rotate.
