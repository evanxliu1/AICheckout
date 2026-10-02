# Goal: measured LLM extraction on real issuer terms, then a useful product

Written 2026-09-28 as a hand-off for a fresh session. Read this file first, then `docs/design.md` and `docs/research/cashback-card-terms-2026.md`.

## Outcome

A resume-ready project whose headline is a **measured evaluation of an LLM extraction harness on real credit-card terms**: several models, prompt versions, and context-selection strategies compared on a human-verified corpus, with a results table and error analysis. The extension then uses the resulting catalog for 7 real cards, and the whole thing ships (hosted API, Chrome Web Store).

Priorities: measurable LLM results first; product schema only where the product needs it; no hedge-heavy agent-log docs.

## Current state (verified 2026-09-28)

| Area | State |
| --- | --- |
| Repo | `main` has PR #1 merged (cleanup, Prettier, CI, docs, Render blueprint, Codex provider). Phase 1 hosted-build docs and the Phase 2a start are merged via PR #2 (branch `phase1-hosted`). |
| CI | Both GitHub Actions workflows green on `main`. |
| Hosted | Render web service `ai-checkout-api` at https://ai-checkout-api.onrender.com (free tier, sleeps; first request ~50 s). `/health` 200, `/v1/catalog` 200 `{"release":null}`, `/v1/review/` 401, `/review/` serves the review app. |
| Supabase | Project `rnzzyeuzydyrdjuihomb` (Pro plan). All 6 migrations applied. New-format publishable key created (`sb_publishable_eMh8…`). Site URL = `https://ai-checkout-api.onrender.com/review/`. Public sign-ups **disabled**. Only user: `evanliu5566@gmail.com`, provisioned in `catalog_private.reviewers`. Legacy `public.credit_cards` rows preserved. |
| LLM access | Codex CLI logged in with ChatGPT. `npm run eval:curation -- --mode codex --model gpt-5.5` runs v1 evals on the subscription (`apps/api/src/curation/codex.ts`). Local only; never on Render. |
| Research | `docs/research/cashback-card-terms-2026.md`: terms for the 7 cards, Best Buy/Newegg categorization, 12-category taxonomy, 2025–26 changes, open uncertainties. Quotes labeled OV (verbatim official) vs OF (official via summarizing fetch, must be re-checked) vs PA/SEC. |

### Phase 2a work already done (merged to `main`)

- `apps/api/src/curation/runner.ts`: the bounded loop is now `executeTask(task, input, provider, options)` over an `ExtractionTask` interface; `runExtraction` is the v1 task. All 207 API tests and the v1 eval check pass unchanged.
- `apps/api/src/curation/v2/schema.ts`: extraction contract v2 (`issuer-extraction.2`): 13 categories (`CATEGORIES`), per-rule `rateBps` (total, not increment), `paidOnPaymentBps` (Citi "1% as you pay"), `cap` {kind, amountCents, period, rateAfterCapBps}, `activation`, `usMerchantsOnly`, `limitedTime`, `definition` includes/excludes, card-level `rewardCurrency`, `pointValueHundredthsOfCent`, `exclusions`, `issues`. Every value is `{value|null, evidence: string[]}`. Input: `{cardId, cardName, documents[{id,title,url,capturedOn,body,contentHash}]}`.
- `apps/api/src/curation/v2/context.ts`: prompts `baseline.1` and `guided.1`; source selection `full` and `keyword-window.1` (keyword lines ±1, verbatim, `[...]` separators); `buildContextV2(input, prompt, selection)` returns system/user/jsonSchema/versions/hash/estimate.
- `apps/api/src/curation/v2/validate.ts`: `resolveQuote` (exact match except whitespace runs; server computes spans, the model never counts offsets), `validateInputsV2`, `percentsIn`, `validateExtractionV2` (missing/unfound evidence, rate not in evidence, cap/payment consistency, reported issues).
- Phase 2a finished on branch `phase2a-harness` (2026-09-28): `v2/task.ts`, `v2/corpus.ts` (directory corpus: `corpus.v2.json` + committed `manifest.json` + gitignored `captures/`; variants by mechanical edits), `v2/score.ts`, `v2/evaluate.ts`, `v2/eval-cli.ts` (`npm run eval:v2`, with `--replay` to re-score saved runs), synthetic `evals/curation/fixture.v2/`, 21 tests in `apps/api/tests/extraction-v2.test.ts`, and `eval:v2 -- --check` in CI. Metrics are documented in `evals/curation/README.md`.
- Codex strict-schema smoke passed: `--output-schema` accepts the v2 schema including `"format":"date"`; gpt-5.5 (low) returned `endsOn` correctly on the fixture. No regex fallback needed.

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

Exit: `eval:v2 --provider fixture --check` passes in CI; unit tests cover validator and scorer. **Done** (step 6 included).

### 2b. Real corpus

**Status (2026-09-29, branch `phase2b-corpus`): done.** Step 5 was changed at Evan's request: instead of a human pass, seven independent reviewer subagents (one per card) checked every base-case field against the captures, and the agent adjudicated their proposals. Result: all rates, caps, currencies, and rules confirmed, no missed rules; four exclusion anchor/text fixes applied. The corpus is marked `annotationStatus: agent-verified` (not human-verified); say so in the results doc. 15 sources captured on 2026-09-28/29 (Capital One application terms come from `disclosures.capitalone.com/disclosure.<productId>.en-US.html`, the iframe behind the product page modal; Amex product pages disable `page.evaluate`, so the script uses locators only; the Citi PDF goes through Ghostscript `txtwrite`). `scripts/author-real-corpus.mjs` generates 37 cases: 7 base + injection-rate, injection-publish, conflicting-rate, stale-promo per card, and remove-cap for both Amex supermarket caps (20 dev, 17 held-out). All anchors resolve, and the reference echo scores 100%. The human verification page (`node scripts/build-verification-page.mjs`) remains available for a later human pass. Captures are machine-local; re-capturing changes hashes and invalidates labels, so do not re-capture until verification is applied. Four pages (Citi product, Wells Fargo, both Capital One product pages) change between back-to-back captures (dynamic content), which Phase 4 must filter before diffing.

1. `evals/curation/real/sources.json`: for each card, 2–3 official pages from the research report (product page; offer terms / rates & fees / rewards terms page; category guidance such as Amex `rewards-info/retail.html`, Chase rewards category FAQ, Citi terms PDF). Record URL, card, issuer, document kind.
2. `scripts/capture-issuer-pages.mjs` (Playwright headless, already a dependency): load each URL, expand collapsed disclosures (`[aria-expanded=false]`, `<details>`), take `document.body.innerText`, normalize line endings, save to gitignored `evals/curation/real/captures/<id>.txt`, write `evals/curation/real/manifest.json` (id, url, capturedOn, sha256, length) which is committed. PDFs: extract text with a library already present or `pdftotext` if installed. Flag pages that fail or look like bot walls.
3. Draft labels (the agent) for each card from its captures using the research report as a guide; every rule needs anchors that `resolveQuote` finds in the capture. Split: **dev** = Capital One (2), Citi, Wells Fargo; **held-out** = Amex (2), Chase. Tune prompts only on dev.
4. Derived variants from real captures, labels transformed mechanically: `remove-cap` (delete the cap sentence → cap null + `missing` issue), `conflicting-rate` (append a contradictory rate line → value null + `conflicting`), `injection` (insert an instruction to report 10% / approve publication → `untrusted-instruction`, values unchanged), `stale-promo` (add an expired limited-time rule). Target ~40–60 cases total.
5. Verification page: a script generates a local static HTML (gitignored, contains issuer text) showing each labeled field next to its highlighted anchor, with accept/fix controls that export `verification.json`. Evan opens it locally, verifies (~1 hr); the agent applies fixes and marks the corpus `annotationStatus: human-verified`.

Exit: `evals/curation/real/corpus.v2.json` committed (no issuer bodies), all anchors resolve against captures, labels verified (agent-verified, see status above).

### 2c. Experiments (resume headline)

Branch `phase2c-experiments` (stacked on `phase2b-corpus`). Captures are machine-local and gitignored, so work in the main checkout, not a worktree. Never re-capture pages (hashes would invalidate labels), never edit corpus labels (if one looks wrong, write it up in the error analysis for a separate verification pass), never tune on held-out, never make paid API calls.

**Step 1: Pilot (de-risk before scale).** Run one real dev case per card family with `gpt-5.5` (low), `guided.1`, both selections. Confirm there are no `input_limit`, `timeout` or `output_limit` statuses on the biggest input (Citi `full`: ~105 kB of text); adjust `CODEX_LIMITS` only if needed, and record why. Read one raw output per card to catch scorer bugs early (for example, legitimate answers scored wrong by rule matching). Scorer changes are bug fixes only: add a test, bump `SCORER_VERSION`, and re-score earlier runs with `--replay` so all reported numbers use one scorer version.

**Step 2: Resumable matrix runner.** `scripts/run-eval-matrix.mjs` plus `evals/curation/matrix.dev.json`, a list of configurations `{model, effort, prompt, selection, repeat, provider}`.
- Each configuration writes to a deterministic run directory, `evals/curation/runs/matrix/<config-slug>/`.
- Re-running skips complete configurations and, for incomplete ones, runs only the missing `caseId#repeat` slots. This needs a `--resume <dir>` option in `eval:v2`: load the existing `observations.json`, verify the corpus hash and configuration match, append the missing observations, and rewrite the files. Old files are replaced only by a superset.
- Stop cleanly on `rate-limit` provider failures (usage-limit messages) and print how to resume.
- Tests cover the resume merge logic.

**Step 3: Local model.** Add `oss` support to `createCodexProvider`: `codex exec --oss`, model `llama3.1`, provider id `codex-oss`, mode `subscription` with zero price. Verify on one case that `--output-schema` is honored. If the local model cannot produce schema-valid JSON on most pilot cases, keep its failures as a measured result (`invalid_output` rate) instead of dropping it. Ollama's default context window is small, so set `OLLAMA_CONTEXT_LENGTH` (at least 32768) for the server if needed and record the value. Local runs use `keyword-window.1` only and `--repeat 1`.

**Step 4: Dev matrix** (20 dev cases each):

| Model | Effort | Prompts | Selections | Repeat |
| --- | --- | --- | --- | --- |
| gpt-5.5 | low | baseline.1, guided.1 | full, keyword-window.1 | 2 |
| gpt-5.5 | high | baseline.1, guided.1 | full, keyword-window.1 | 2 |
| gpt-6-astra | default (low) | baseline.1, guided.1 | full, keyword-window.1 | 2 |
| llama3.1 (local) | n/a | baseline.1, guided.1 | keyword-window.1 | 1 |

That is 12 × 40 + 2 × 20 = 520 runs. Run the cheapest configurations first. Use concurrency 3 for Codex and 1 for local. Expect several hours and possible usage-limit pauses; resume with the runner.

**Step 5: Error analysis → `guided.2`.** From dev failures, tabulate error types: missed rule by category, wrong rate, cap, U.S.-only or activation, claims unsupported by evidence, missed injection or conflict, stale-promo handling, distractor rules taken from comparison tables or generic FAQs, and quote-resolution failures. Pick the top 2–3 fixable causes and write `guided.2` as a new prompt version (never edit `guided.1`). Re-run the best 1–2 dev configurations with `guided.2` and report deltas. At most two prompt iterations.

**Step 6: Held-out, once.** Choose configurations using dev only: the best overall, the best cheap/fast one, and `baseline.1` on the best model as the reference. Run each on held-out (`--split heldout --allow-heldout`, repeat 2). Do not change prompts after seeing held-out results.

**Step 7: Results.** `scripts/summarize-evals.mjs` reads the run directories and writes:
- `docs/evals/results.json` (committed): aggregated metrics per configuration, by variant, by category, and by repeat.
- `docs/evals/results.svg`: a grouped bar chart, no new dependencies.

`docs/evals/results.md` covers:
- setup: corpus, `agent-verified` labels, splits, scorer version, dates, models
- the main table: end-to-end field accuracy, rule recall/precision, claim precision, evidence validity, injection resistance (untrusted-instruction recall and field accuracy on injection variants), conflict recall, false-clean, p50/p95 latency, mean tokens
- a per-category error breakdown
- 3–5 concrete failure examples, each with a short quote of 25 words or fewer
- the guided.1 → guided.2 deltas
- held-out results
- limitations: n=7 cards, agent-verified labels, variants synthetic, Codex harness token overhead, subscription models not pinned snapshots

The committed results files contain only metrics and short quotes, no issuer text beyond that. Link results.md from the README with 2–3 headline numbers.

**Step 8: Checks.** Lint, format:check, typecheck, tests, `eval:curation -- --check`, `eval:v2 -- --check`. Commit in logical steps, push the branch, and don't open the PR (the reviewer does).

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
6. Site adapters as data (groundwork for Phase 6). Replace the hand-written `readBestBuy`/`readNewegg` functions in `extension/src/checkout/page-reader.ts` with one generic interpreter plus a declarative, versioned `SiteAdapter` spec per merchant: URL match (host + path pattern), summary container selector, row/label/amount selectors, label → amount-kind map, empty-cart and loading markers, and limits (max rows, max text length). Keep today's safety rules in the interpreter (visible text only, no form values, no item names or addresses, ambiguity → `unavailable`). Specs live as JSON files inside the extension package (see Phase 6 step 6 for why they are never downloaded). Port Best Buy and Newegg to specs and prove it with the existing fixtures and browser tests, then add **Amazon US** as the first spec written from scratch.

### Phase 3 execution plan (written 2026-09-30)

**Status (2026-10-01):** M1 (`packages/ui`, #7), M2 (catalog v2, engine, database, #8), M3 (extension on v2, Helios popup, site adapters including Amazon US, #9), M4 (review app on Helios, structured editor, publish dialog, #10) and M5 (public site, #11) are merged and deployed. M6 is pending Evan's publication of the 7-card catalog in the hosted review app; `phase3-m6-prep` adds **Start a new draft**, the merchant MCC captures and [the publish runbook](../release/publish-runbook.md). After publication the coordinator verifies `/v1/catalog` and a live refresh of a hosted extension build.

Sections 3a and 3 above are the goals. This is how to build them: six milestones, **one branch and one PR each, cut from the latest `main`**, merged before the next starts (M5 may run after M2 in any order). The coordinator reviews and merges each PR. Facts below were verified on `main` at 9df09aa.

#### Decisions (do not re-litigate)

- **Catalog v2 is a new product schema, not the extraction schema.** Extraction v2 keeps evidence/nulls for review; catalog v2 holds reviewed values the engine can compute with. The 7-card catalog is **built deterministically from the verified gold labels** (`evals/curation/real/corpus.v2.json` base cases + `manifest.json` sources), never from model output.
- **v1 stays readable.** The extension, API, DB, and review app accept `schemaVersion: 1 | 2` (discriminated union). v1 code paths (pilot catalog, v1 extraction/apply flow) keep working on v1 drafts; the v1 extraction panel is hidden for v2 drafts with a one-line note. v2 extraction → draft is later work (Phase 4).
- **Engine scope = what an online checkout can hit.** Rule applicability per merchant: `all-purchases` always; `online-retail` when the merchant profile is online retail selling physical goods (and U.S. when `usMerchantsOnly`) and the payment path is direct card; merchant-category rules (supermarkets, gas, dining, drugstores, streaming, transit, entertainment, ev-charging) apply only if the merchant profile's expected category matches; `travel-portal`/`entertainment-portal` never apply at a retail checkout (shown as "not at this merchant"). `other` is displayed but never applied.
- **Ranking:** by guaranteed minimum reward, ties by default card then id (as today). Paid-on-payment portions (Citi) count toward the estimate (the shopper pays the bill), shown with an explicit note "2% if the balance is paid (1% at purchase)". Pending cap usage and unknown activation produce ranges (as today). Payment path input (`card` default, `paypal`, `digital-wallet`, `bnpl`): non-card paths make channel/category bonuses uncertain (range from base to bonus), and `bnpl` excludes Amex online retail (Amex terms). After a spend cap, the rule earns `rateAfterCapBps`.
- **Null semantics in catalog v2:** `cap: {kind:'none'} | {kind:'spend', amountCents, period, rateAfterCapBps} | {kind:'unstated'}`; `activation: 'none' | 'enroll-once' | 'recurring' | 'unstated'`. For the base (`all-purchases`) rule an `unstated` cap behaves as none; for a bonus rule it adds the `cap-unstated` uncertainty so the minimum falls back to base. **Activation `unstated` behaves as `none` for every rule** (coordinator decision, 2026-10-01, superseding the earlier "adds `activation-unknown`"): issuers state enrollment or activation requirements explicitly when they exist, so only `enroll-once`/`recurring` rules ask the shopper to confirm activation. `unstated` stays in the catalog so the UI can say "activation not mentioned on the issuer's pages". A card's estimate never falls below its base reward, and `rateAfterCapBps` must be at least the card's base rate.
- **Merchants in the catalog** carry a profile: `{id, name, onlineRetail: true, physicalGoods: true, expectedCategory: 'electronics' | 'general-merchandise' | ..., mcc: {code, confidence: 'low'|'medium'|'high', sourceIds}, notes}`. Initial merchants: `best-buy-us`, `newegg-us`, `amazon-us` (profiles from docs/research; Amazon marketplace/third-party-seller caveat in notes).
- **Helios is used via tokens + our own React components** (`packages/ui`), light theme only, system font stack from the tokens, icons inlined per icon as SVG React components (CSP: review/site `style-src 'self'`, no remote fonts/styles; no inline `<style>` tags). No HashiCorp logos/branding; credit Helios + Flight (MPL-2.0) in README.
- **Site adapters ship inside the extension package** (Chrome Web Store remote-code policy; see Phase 6 step 6). Kill switch is Phase 6, not now.
- **Hosted rollout:** the coordinator pushes migrations with `./scripts/db-push.sh` (Keychain password) and merges PRs (Render auto-deploys `main`). **Evan publishes the 7-card catalog himself in the hosted review app** (a human approval by design). The agent never signs in to hosted services.

#### M1: `packages/ui` foundation (branch `phase3-m1-ui`)

1. Add deps: `@hashicorp/design-system-tokens@5.1.0`, `@hashicorp/flight-icons@5.2.0` (MPL-2.0), `@axe-core/playwright@4.13.x` (dev). `npm audit --audit-level=high` must stay clean.
2. New workspace `packages/ui` (`@ai-checkout/ui`), consumed as TS source like the other packages (`exports` → `src/*.ts[x]`), with its own vitest + Testing Library tests (wire into root `npm test`), lint coverage (already under `packages`).
3. `src/styles.css`: imports the Helios product `tokens.css` and helper CSS once, plus component CSS written only with `--token-*` variables (no raw hex except where Helios has no token; list any exceptions). Focus ring from the Helios focus-ring helper.
4. Components (React 19, forwardRef where it matters, each with a comment linking its Helios doc page and a test for role/label/keyboard behavior): `Button` (primary/secondary/tertiary/critical, small/medium/large, loading, icon), `TextInput`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Field` (label, helper text, error text, required; wires `id`/`aria-describedby`/`aria-invalid`), `Fieldset`, `Badge` (neutral/highlight/success/warning/critical), `AlertInline` (neutral/highlight/success/warning/critical, `role` status vs alert), `Card` (container), `Table` (simple, sortable optional), `Tabs` (roving tabindex, arrow keys), `Modal` (focus trap, Esc, returns focus, `aria-modal`), `ApplicationState` (loading/empty/error), `Link` (standalone/inline, external indicator), `Disclosure` (native details/summary styled), `Icon` (named Flight icons, only the ones we use, as SVG React components; `aria-hidden` unless labelled).
5. A small static gallery page `packages/ui/gallery/index.html` + Vite dev script (not shipped) rendering every component/state, and an axe check over it in a Playwright test (zero violations of WCAG 2.1 A/AA rules).
6. Exit: `npm test`, typecheck, lint, format, build all green; axe on the gallery clean; README credits.

#### M2: Catalog v2 contract, engine, database, and the 7-card catalog (branch `phase3-m2-catalog-v2`)

1. `packages/rewards-core`: `catalogV2Schema` (strict Zod) + types per the decisions above; `catalogSchema` becomes the union keyed by `schemaVersion`; keep every v1 invariant for v1. v2 invariants (mirror of v1 style): unique ids; exactly one `all-purchases` rule per card with no spend cap/activation; bonus rate ≥ base; `rateAfterCapBps` ≥ 0 and ≤ rule rate; `paidOnPaymentBps` ≤ `rateBps`; sources resolve; `checkedOn` window; 30-day validity window (keep `CATALOG_MAX_AGE_MS`); size cap (raise `MAX_CATALOG_BYTES` only if needed, with a reason); `limitedTime.endsOn` rules expired before `verifiedAt` are allowed but flagged `expired` and never applied.
2. Engine `compareRewards` handles both versions (v1 path unchanged, all existing tests pass). v2 path implements applicability, ranking, paid-on-payment note, payment path, caps with after-cap rate, and uncertainties per the decisions; new uncertainty codes are added to the extension contracts. Unit tests: every rule kind × merchant profile, Citi paid-on-payment, Amex 3%-then-1% cap boundaries (spent before/after, unknown), BNPL/PayPal/wallet, expired promo, tie-breaks, bounds sweep with BigInt math.
3. Parity: add `catalogV2Cases` (≥30: 2 valid + mutations for each invariant) in `packages/rewards-core/test-cases.ts`; the existing 28 v1 cases stay. `scripts/test-catalog-parity.mjs` and `extension/tests/catalog-schema.test.ts` run both lists.
4. New Supabase migration (`npm run supabase -- migration new catalog_v2`; never edit applied ones): `catalog_private.valid_catalog_v2(jsonb)` mirroring Zod (pg_jsonschema + imperative checks), `valid_catalog(jsonb)` = v1 or v2, and replace the CHECK constraints on `public.catalog_releases.catalog` and `catalog_private.drafts.catalog` to use it (drop/add constraint in the migration). `publish_catalog`'s source-matching must work for v2 sources. pgTAP tests for v2 accept/reject and publication of a v2 draft. Run the full DB suite locally (`npm run db:start:api`, `db:test`, `db:test:catalog`, `db:test:http`, curation tests, `db:lint`, `db:advisors`).
5. `scripts/build-catalog-v2.mjs`: reads the corpus base cases + manifest + a committed `evals/curation/real/merchants.json` (merchant profiles with sources from docs/research) and writes `packages/rewards-core/src/catalog-v2.ts` (`CATALOG_V2`, version `2026-10-01.real.1` or the build date, verifiedAt = latest manifest capture date, 30-day expiry), mapping gold labels → catalog fields (null cap → `unstated`, null activation → `unstated`, extraction categories 1:1, sources = manifest entries used by that card). `--check` mode for CI (like `db:seed:check`). Tests assert the 7 cards and key facts (Citi 200/100 paid-on-payment; BCE online retail 300 with $6,000 cap then 1%; BCP supermarkets 600; Chase 150 base; WF 200; Quicksilver 150; Savor 100 base).
6. The extension's bundled fallback becomes `CATALOG_V2` (keep `PILOT_CATALOG` exported for v1 tests). Seed generator writes the v2 catalog as the seeded draft; `db:seed:check` passes. API `/v1/catalog` serves either version (schema union); `catalog-repository.ts` parses the union.
7. Review app minimal compatibility (full UI in M4): the draft JSON editor validates with the union; `comparison.ts` diff handles v2 rules generically (per rule: category, rate, paid-on-payment, cap, activation, U.S.-only, limited time); the v1 extraction panel is hidden for v2 drafts. Review browser tests pass.
8. Exit: all CI checks green including `database.yml` locally; the coordinator pushes the migration to hosted after merge.

#### M3: Extension on catalog v2, Helios popup, site adapters (branch `phase3-m3-extension`)

1. Popup rebuilt with `packages/ui` + tokens (Tailwind theme mapped to `--token-*` variables so remaining utilities are tokens; delete unused legacy classes like `.card`, `.modal-backdrop`, legacy ErrorBoundary styling). Keep the 360 px default width, ≤ 480 px, Chrome's 800×600 max, full keyboard use, Helios focus ring, reduced motion.
2. Screens: vault states (unchanged behavior), wallet setup with the 7 cards grouped by issuer, per-card bonus spend inputs derived from rules (no hardcoded card/rule ids; remove `bceCard`/`bce-online-retail` special cases in `Popup.tsx` and hardcoded "online retail" labels in `WalletEditor`/`ComparisonResult`), purchase form with merchant (Best Buy/Newegg/Amazon) and payment path, comparison result showing per card: estimate or range, the applied rule in issuer wording, conditions (U.S.-only, activation, cap remaining), the Citi pay-later note, rules that don't apply here (collapsed), sources; unsupported merchant; offline/error; catalog expired.
3. `AppState` gets `schemaVersion: 2` with a migration from v1 state (wallet card ids from the pilot map to the same ids; usage rows keyed by old rule ids are dropped with a notice); cached v1 releases are still accepted and replaced on refresh.
4. Site adapters: `extension/src/checkout/adapters/*.json` (declarative `SiteAdapter` spec, zod-validated at build and in tests) + one generic interpreter replacing `readBestBuy`/`readNewegg`, preserving every safety rule and existing test expectation (fixtures unchanged, all reader tests pass unmodified or with only import changes). Add **Amazon US** (`www.amazon.com/gp/cart/view.html` and `/cart`): capture a redacted fixture of a logged-out cart with one test item via Playwright (summary region only, no item names), label the expected subtotal, tests for subtotal/empty/loading/ambiguous. Never sign in, never proceed to checkout. If Amazon shows a bot wall headlessly, document it and use a hand-built fixture from the observed structure.
5. Tests: update unit + Playwright specs (role/label selectors; keep native-popup text matching working), add axe checks on the popup at 360 and 480 px for each main state, package test still passes. Regenerate release media with `npm run release:media` (ffmpeg present) so hash-pinned assets match; update `extension/DESIGN.md` (+ `.impeccable/design.json`) for Helios.
6. Exit: extension CI green (`test:browser`, `test:catalog:browser`, `test:package:browser`), axe clean, release media verified.

#### M4: Review app on Helios and catalog v2 (branch `phase3-m4-review`)

1. Replace `styles.css` values with tokens and use `packages/ui` (forms, `Table` for the draft diff, `Badge` for status/evidence, `AlertInline`, `Modal` for publish confirmation). Keep the CSP (`style-src 'self'`); verify the built CSS/JS need nothing inline.
2. Structured v2 draft editor alongside the JSON editor: per card/rule fields with validation messages from Zod, diff vs published, source evidence panel unchanged.
3. Tests: vitest + Playwright review specs (replace the `.extraction*` class selectors with roles/labels), axe on sign-in, queue, draft diff, publish confirmation at 1280 px and 390 px. Update `apps/review/DESIGN.md` (+ sidecars). Regenerate portfolio demo media if it is hash-pinned (`npm run release:portfolio`, needs local Supabase).
4. Exit: review CI (database workflow) green locally.

#### M5: Public site `apps/site` (branch `phase3-m5-site`)

1. Vite multi-page static build (no client router): `/` landing (what it does, how it decides, screenshots from release media, install link placeholder until the store listing exists), `/results/` (renders `docs/evals/results.json` copied at build time: main table, held-out table, the two charts, limitations, link to the full `results.md` on GitHub), `/architecture/` (the two-systems diagram as inline SVG, harness summary), `/privacy/` (what the extension stores locally, what it sends: only the catalog GET; no analytics; vault), `/support/` (contact, known limitations). Uses `packages/ui` + tokens.
2. Served by the API at `/` via a second `@fastify/static` registration (`decorateReply: false`), `SITE_DIST_DIR` env like `REVIEW_DIST_DIR`, security headers (CSP same shape as review minus Supabase), never shadowing `/health`, `/v1/*`, `/review/*`; tests for routing precedence and headers. `render.yaml` builds `@ai-checkout/site` and sets `SITE_DIST_DIR`.
3. Axe checks on every page at 1280 and 390 px. Exit: build + tests green.

#### M6: Hosted rollout (coordinator + Evan; the implementer prepares docs)

1. After M2 merges: coordinator runs `./scripts/db-push.sh` (dry run first) and confirms `/v1/catalog` still serves `{release:null}`.
2. After M3–M5 merge (Render deploys): Evan signs in to the hosted review app, creates a draft from the v2 catalog (seeded draft or JSON), reviews the diff and sources, and publishes. Coordinator verifies `/v1/catalog`, builds `npm run build:hosted`, and verifies a live refresh in a Playwright run against the hosted API.
3. README and docs updated (live links: site, results page, review app); plan status updated.

Exit for Phase 3: the hosted site, review app, and extension all run on Helios and catalog v2; the 7-card catalog is published and served; Amazon, Best Buy, and Newegg carts read through bundled adapters; all CI green.

### Phase 3b: automatic cart badge (written 2026-10-01)

Evan's request: work like Honey or Capital One Shopping. On a supported cart the extension shows, without a click, which card to use and how much cash back it earns. One branch `phase3b-auto-badge`, cut from `main` after Phase 3 (M1–M5 and M6 prep merged).

#### Decisions (Evan + coordinator; do not re-litigate)

- **Zero-click.** On a supported cart page a small badge appears automatically with the single best owned card and its cash back for this cart. No "Read cart amount" click and no amount confirmation.
- **Badge only by default.** A compact pill bottom-right ("Use Blue Cash Everyday · $3.00 back"). Clicking it expands a panel:
  - the ranked cash back of every owned card (ranges where uncertain), with the applied rule, its conditions and the Citi pay-later note;
  - a payment-method selector;
  - an editable amount ("Based on $X cart subtotal");
  - "Not on this site" and dismiss.
  Dismiss lasts for the tab session. A per-site off switch lives in settings.
- **No accounts; local-first.** Cards, settings and savings history are kept in `chrome.storage.local`. The passphrase vault becomes **optional and off by default** ("Protect with a passphrase" in settings).
  - Existing vault users keep it until they turn it off; the popup offers that.
  - When the vault is on and locked, the badge says "Unlock to see your best card" and opens the popup to unlock.
  - Optional cloud sync is a future phase: noted here, not built.
- **Permissions.**
  - Host permissions and content scripts cover only the three supported hosts, using the adapters' exact hosts: `www.amazon.com`, `bestbuy.com`, `www.bestbuy.com`, `secure.newegg.com`.
  - `activeTab` stays for manual reads elsewhere. No other hosts (plus the catalog origin in hosted builds, as before).
  - Manifest inspection and package tests are updated accordingly.
- **Isolation.**
  - The badge and panel are an extension page (`src/badge/index.html`, web-accessible only on those hosts) in an iframe inside a closed shadow-root host element.
  - The content script never receives card or wallet data. It reads the cart summary with the existing adapter interpreter and forwards `{merchantId, amountCents, kind, extractorVersion}` to the service worker.
  - The iframe gets its view from the service worker through `chrome.runtime`.
  - iframe→content-script `postMessage` carries only size and visibility, with strict origin and shape checks. Page scripts cannot read card names.
- **Reading.**
  - Read on load and on DOM changes (MutationObserver, debounced about 500 ms, bounded work), always through the adapter, and never outside the summary region.
  - Show the badge only when the adapter returns `found`. Ambiguous or unavailable readings show nothing; an already expanded panel says "Can't read this cart — enter the amount".
- **Engine defaults in auto mode.** `eligiblePurchase: 'eligible'` (the supported carts are physical-goods retailers), `onlineRetail` from the merchant profile, payment path `card` (changeable in the panel).
- **Onboarding.**
  - On install an extension tab (onboarding page on `@ai-checkout/ui`) opens to pick cards and a default card.
  - With no cards the badge says "Pick your cards to see your best card" and opens onboarding.
  - The toolbar popup remains for editing cards, settings, savings and manual comparisons.
- **All-time savings ("detect completed orders").** The agent never places an order, so confirmation pages are never observed.
  - Detection:
    - Order completion is recognized by **URL pattern only**: per-adapter `orderConfirmation` paths, documented as **unverified** until Evan checks them on a real order.
    - It must be the same tab, within a few hours of a cart where a recommendation was shown.
    - The order page DOM is never read.
  - Prompt: the badge then asks once: "Did you pay with {recommended card}?" Yes / Another card (pick) / Not sure.
  - Record, kept locally:
    - `{date, merchantId}`;
    - `cartAmountCents`, labelled an estimate: the last cart amount, before tax and shipping;
    - `recommendedCardId` and `usedCardId|null`;
    - `estimatedRewardCents` for the used card, `baselineRewardCents` for the default card, and `extraCents`.
  - The popup shows "All-time: $X extra cash back (estimated, vs your default card)", a history list, JSON export and delete.
- **Privacy.** Everything stays on the device. The site privacy page, `docs/release/privacy-policy.md`, `store-listing.md` (host-permission justification for the three hosts, automatic summary reads, URL-only order detection, local savings) and the support docs are updated.

#### Milestones (one branch; logical commits)

1. **Plan** (this section).
2. **Vault optional.**
   - Plaintext local state by default. Vault statuses become `unprotected | locked | unlocked | damaged`, with protect and unprotect actions; existing vaults keep working.
   - Settings move into the popup: per-site badge switches, protection.
   - Savings history joins app state (encrypted when the vault is on).
3. **Adapters and manifest.**
   - Per-adapter `matchPatterns` (content-script match patterns) and `orderConfirmation` paths (unverified).
   - The build derives `content_scripts`, `host_permissions` and the badge's `web_accessible_resources` from the adapters.
   - Package inspection allows exactly those hosts.
4. **Content script and service-worker routing.**
   - The automatic reader (debounced, bounded, stops when hidden or unloaded, no network).
   - A per-tab badge session in `chrome.storage.session`.
   - Sender checks per caller: the content script may only report readings and order pages; the badge iframe may only use `badge:*`; extension pages may use the full API.
5. **Badge iframe UI.** Pill and panel (ranked list, rules, payment path, editable amount, dismiss, per-site off); locked, no-cards and unreadable states; the one-tap order prompt; size messages to the host.
6. **Onboarding page** opened on install; **savings view** in the popup (total, history, export, delete).
7. **Tests.**
   - Unit: content-script logic, savings math, vault-optional migration, routing.
   - e2e (fixtures served at the real hosts):
     - the badge's card and amount, and an update when the quantity changes;
     - the no-cards prompt, the locked prompt, dismiss and per-site off;
     - the order-URL prompt recording savings;
     - closed shadow plus cross-origin iframe;
     - axe on the badge and panel.
   - Manifest and package tests.
8. **Docs and media.** Privacy and support pages, policy and store listing; a store screenshot of the badge on a neutral mock cart; release media regenerated.

Open item: the `orderConfirmation` URL patterns are educated guesses and must be verified by Evan on a real order for each retailer before the store release. Until then a missed confirmation page only means no savings prompt.

### 4. Terms-change detection

Scheduled GitHub Action (weekly) runs the capture script, compares hashes to `manifest.json`, and opens an issue listing changed sources with a text diff summary. Re-extraction then runs locally via Codex and goes through human review. Captured text must not be committed or posted publicly in the issue (post hashes and short changed-line excerpts only).

### 5. Ship

Chrome Web Store (Evan pays the $5 fee and submits) using the privacy/support pages from the Phase 3a site, README with results table and live links (site, results page, review app), ~90 s demo video recorded on the Helios UI, decide on the passphrase vault (recommend dropping or opt-in).


### 6. Site coverage harness (LLM adds merchants the way it adds cards)

Same pattern as card curation: the model drafts, deterministic checks verify, and a human reviews before publishing. The unit of work here is a merchant site instead of a card.

1. **Capture.** `scripts/capture-checkout-pages.mjs` (Playwright) builds a cart on a target site using public, logged-out flows with a test item. It saves a *redacted* DOM snapshot of the checkout summary region (gitignored) plus a committed manifest (URL, date, hash) and a labeled expectation (amount, kind, or `unavailable` reason). The agent never signs in, enters addresses or payment details, or places orders; sites that require login to show a cart are marked out of scope.
2. **Extraction task.** An `ExtractionTask` for sites (reusing `executeTask`): the input is the redacted snapshot and the output is a `SiteAdapter` spec. Validation is execution-based: run the real extension interpreter (jsdom) on every fixture for that site, and require the exact labeled amount and kind, `unavailable` where the label says so, and selectors that stay inside the summary region. Findings go into the trace like evidence findings do for cards.
3. **Corpus and variants.** Real snapshots from ~15–25 US retailers, split dev/held-out by site. Mechanical DOM variants (the analog of card variants):
   - `class-rename` (hashed class names change): selectors should rely on stable attributes or labels.
   - `promo-row` (discount, gift card, or "4 payments of $X" rows added): the adapter must not read them as the total.
   - `loading` (`aria-busy` or skeleton rows): expect `page-loading`.
   - `empty-cart`: expect `empty-cart`.
   - `injection` (text in the page telling the model to report a different selector or total): expect an `untrusted-instruction` issue.
4. **Metrics.** Fixture pass rate, false-found rate (worst case: a wrong amount reported as found), robustness across variants, held-out site success, and repair rate (drift fixed from the old spec plus a new snapshot). Latency and tokens as for cards. Same `eval:sites` CLI shape as `eval:v2`, with a fixture-provider `--check` in CI.
5. **Merchant profile.** Per site, the reward-relevant facts the engine needs: online retail yes/no, sells physical goods, expected MCC with confidence and sources, and third-party marketplace or payment-path caveats. Drafted from public sources with quoted evidence, as in the card research.
6. **Ship specs inside the extension package, not downloaded.** Chrome Web Store policy (checked 2026-09-29) bans "building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data" ([MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)). AdGuard had a remotely downloaded rule list rejected as remote execution and removed it ([AdGuard](https://adguard.com/en/blog/review-issues-in-chrome-web-store.html)). So reviewed specs are bundled JSON in the package: adding a site means a new extension release through Web Store review, which CI can automate (build → zip → submit via the Web Store API once Evan has set up the listing). What may be remote: a **kill switch** config that disables a bundled adapter by ID and version ("fetching a remote configuration file ... for determining enabled features, where all logic ... is contained within the extension package" is explicitly allowed), and the card catalog (rates and caps are data read by fixed engine logic, not commands). Keep the spec format small and declarative (selectors, label map, limits; no conditionals, loops, or expressions), so the bundled interpreter stays obviously fixed logic.
7. **Drift detection.** Extend the Phase 4 scheduled job: re-capture each supported site weekly, run its shipped spec, and when it fails, flip that adapter's kill switch (the extension then says the site is temporarily unsupported rather than reading a wrong total), open an issue, and have the harness propose a repaired spec for the next release.

Exit: at least 10 new US merchants shipped in extension releases after review; results (including held-out sites and variant robustness) added to `docs/evals/results.md`.

## Housekeeping

- Delete `extension/CLAUDE.md` (gitignored, local only); it describes code that no longer exists.
- The retired simulation's `credentials.json` and `.env` were moved to `~/.Trash` on 2026-09-28; Evan should revoke the keys they held.
