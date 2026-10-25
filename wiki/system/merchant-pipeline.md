---
type: System Component
title: Merchant pipeline
description: How the merchant database records are built — the frozen two-tier candidate list, the deterministic tier-A builder, the tier-B stages under `pipeline merchants` (research and verify by Claude subagents through work packets, capture with issuer mining, a gpt-5.6-luna draft with prompt merchant-draft.2, a deterministic apply with the evidence and hold-out rules, build and review.md), the deterministic `mcc` basis over public card-transaction datasets, and the blind-audit tooling.
status: stable
tags: [system, merchants, pipeline, phase-14, curation]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 5, 6, 8)
  - resource: ../../tools/catalog-pipeline/src/merchants/cli.ts
    title: pipeline merchants CLI
  - resource: ../../tools/catalog-pipeline/src/merchants/files.ts
    title: Schemas of every pipeline file
  - resource: ../../tools/catalog-pipeline/src/merchants/apply.ts
    title: applyStore (evidence rule, hold-out rule)
  - resource: ../../tools/catalog-pipeline/src/merchants/mcc.ts
    title: The mcc basis
  - resource: ../../tools/catalog-pipeline/src/merchants/candidates.ts
    title: buildCandidates and the tier gates
  - resource: ../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.2.md
    title: Prompt merchant-draft.2 (current)
  - resource: ../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.1.md
    title: Prompt merchant-draft.1 (retired, never edited)
  - resource: ../decisions/2026-10-11-definition-evidence-basis.md
    title: Decision, the definition evidence basis
  - resource: ../../evals/merchants/db/candidates.json
    title: Frozen candidate list
  - resource: ../../docs/evals/merchant-db-v1.md
    title: Merchant database v1 report (seed, audit, mcc basis results)
  - resource: card-expansion-pipeline.md
    title: Card-expansion pipeline (the pattern this follows)
---

# Merchant pipeline

The merchant database ([plan](../product/phase-14-merchant-database.md)) is built from a frozen candidate list in two tiers. Tier A (the long tail) gets deterministic default records with no model. Tier B (brands, bonus-category groups, processors) goes through a small pipeline, `npm run pipeline -- merchants <command>`, that follows the [card pipeline](card-expansion-pipeline.md) pattern: a batch directory with a text-free `state.json`, claimed work packets for the two agent stages, gates on every model output, and a deterministic apply. Models never set `category`: luna proposes a candidate, Claude verifies every field, and `applyStore` applies Evan's evidence rule; the deterministic `merchants mcc` stage then re-checks every record against public card-transaction datasets ([the mcc basis](#the-mcc-basis)). Evidence bases, strongest first: `issuer` > `mcc` > `corroborated` > `definition`, else `default` ([decision](../decisions/2026-10-11-definition-evidence-basis.md), [mcc decision](../decisions/2026-10-11-mcc-evidence-basis.md)). A disputed `evidence` downgrades a record to default; any other disputed field holds the whole record out; there is no adjudicator. The bundled release is `2026-10-11.mcc.3` (640 records); how it was built and what the audit measured is in [`docs/evals/merchant-db-v1.md`](../../docs/evals/merchant-db-v1.md).

## Facts

| Item | Value |
| --- | --- |
| Candidate list | [`evals/merchants/db/candidates.json`](../../evals/merchants/db/candidates.json) (`merchant-candidates.1`, frozen 2026-10-11): 692 candidates, tier A 380, tier B 312, 60 held out and marked, 1 moved to B by the brand-name gate (`doordashstore.com`). Groups: catalog brands 126, supermarkets 40, dining 30, drugstores 10, streaming 25, entertainment 20, home improvement 10, wholesale clubs 5, department stores 20, electronics 15, transit 15, processors 15, legacy 3, top stores 361, held-out-only 20 (a domain may be in several groups) |
| List sources | [`candidate-groups.json`](../../evals/merchants/db/candidate-groups.json) (hand-authored tier-B domains by group, processor and legacy record ids and hosts, brand ids), the U.S. eligible domains of the frozen [`retail-frame-3.json`](../../evals/merchants/retail-frame-3.json), the frozen [`pipeline-heldout-domains.json`](../../evals/merchants/pipeline-heldout-domains.json); each with its SHA-256 in the list. Domain names only |
| Batches | `evals/merchants/db/batches/<batch>/`: `batch.json`, `state.json`, `research.json`, `sources.json`, `manifest.json`, `drafts/<domain>.json`, `verification.json`, `apply-report.json` committed; `captures/`, `traces/`, `packets/` gitignored |
| Records and evidence | `evals/merchants/db/records/<id>.json`, `evidence/<id>.json` (quotes of 25 words or fewer with source id and kind), cited sources in `release-config.json`; `npm run merchants` builds `merchants-v1.ts` and `release.json`; `review.md` lists deviations only |
| MCC data | `evals/merchants/db/mcc/`: `manifest.json` (datasets: URL, publisher, licence quote, fetch date, per-file SHA-256 and rows), `codes.json` (dataset description → Visa code → category; the Visa manual cited), `descriptors.json` (per-store patterns, excludes, vetoes, skips), `results.json` (per-store tallies and outcomes), `NOTICE.md` (CC BY attribution); the datasets themselves under the gitignored `evals/merchants/db/mcc-data/` |
| Draft model | gpt-5.6-luna, `xhigh`, visible output tokens, 600 s per store, through `createCodexProvider` (`apps/api/src/curation/codex.ts`); prompt [`merchant-draft.2`](../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.2.md) (it asks for a business-type quote from the store's pages and a `definition` quote from each issuer document that states what the category includes; [`merchant-draft.1`](../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.1.md) is retired, never edited), hashed into the draft files and `state.json`. The drafter sees each issuer capture as the windows around the store's name plus `definitionWindows` (sentences with a category word and definition wording, ±200 characters, at most 8), up to 8,000 characters. Refused under `CI` or `RENDER` |
| Agents | [`merchant-researcher`](../../.claude/agents/merchant-researcher.md) and [`merchant-verifier`](../../.claude/agents/merchant-verifier.md), both `claude-opus-5-5`; up to 25 stores per packet |
| Issuer evidence | Mined deterministically from the catalog's issuer captures (main checkout, or `AICHECKOUT_ISSUER_CAPTURES`): word-boundary name match (hyphens inside the name optional, so "Wal-Mart" names Walmart), the newest capture per source id, at most 5 per store, copied into the batch's captures under the catalog's source id with windows around the matches for the drafter. Every non-processor store also gets the fixed set of issuer category-definition pages (`DEFINITION_PAGES`, 12 pages; coverage table below), named or not; the drafter sees their definition sentences |
| Tests | [`tools/catalog-pipeline/tests/merchants-pipeline.test.ts`](../../tools/catalog-pipeline/tests/merchants-pipeline.test.ts): apply rule, hold-out rule, research and verification schemas, tier gates, candidates file, tier-A names, issuer mining, review.md, agent files |

## Commands

| Command | Does |
| --- | --- |
| `merchants candidates [--check]` | Rebuilds the list from its three sources; `--check` fails when the committed file differs (the list is frozen; a change is deliberate) |
| `merchants tier-a [--only d,d] [--limit N]` | Renders each tier-A homepage logged out (robots.txt recorded), names the record from `og:site_name`, `application-name` or `<title>`, else the domain label; a bot wall, error page or empty render falls back to the label and is marked `(blocked)` in `tier-a-manifest.json`; writes default records. Refuses held-out domains |
| `merchants init <batch> --stores d,d [--development]` | A tier-B batch of at most 25 candidates; refuses tier-A, unknown and held-out domains unless `--allow-heldout` (never with `--development`) |
| `merchants claim research\|verify --batch B [--release]` | Writes `packets/<stage>.<n>.json` (inputs hashed, one output) |
| `merchants accept research\|verify --batch B --agent-run <id> [--model] [--duration-ms] [--tokens] [--dry-run]` | Runs the gate; records packet, run, model, duration and tokens in `state.json` |
| `merchants run capture --batch B` | `sources.json` from the research (store pages, lookups), `scripts/capture-issuer-pages.mjs` into the batch's captures (1.5 s between pages), then issuer mining into `manifest.json`. A page the script cannot fetch (SSL or HTTP/2 errors, timeouts) is a dropped source, not a failed stage (plan section 6): the manifest omits it, the log names stores left without a store page, and the stage is done when the manifest exists |
| `merchants run draft --batch B [--only d]` | One Codex call per store; gate: Zod, quotes verbatim in the named capture and at most 25 words, catalog brands, the store's own sources; tokens and time per store in `state.json` |
| `merchants run apply --batch B` | `applyStore` per store; records, evidence and cited sources written; `verifiedAt` raised to the newest cited capture; `apply-report.json` |
| `merchants run build [--batch B]`, `merchants review` | `scripts/build-merchants-v1.mjs` and `review.md` (bonus categories with their quotes, brands, processors, services, disabled, downgraded, **candidates the evidence rule refused** with the rule's reason and the drafter's notes, held out). Build refuses a release whose cited lookup is a forum thread |
| `merchants mcc [--version <v>]` | The `mcc` basis over every record: verifies the dataset hashes and row counts, pools each record's rows by its descriptor rule, decides, writes records, evidence, cited dataset sources, `mcc/results.json` and the manifest's hashes; `--version` sets the release version. About 7 s over 1.86 M rows |
| `merchants status [--batch B] [--json]` | Stage statuses, agent models, tokens and time, draft tokens and model time, records and held-out counts, open packets |

## Definition pages by category

`DEFINITION_PAGES` (`capture.ts`) are attached to every non-processor store so each bonus category in `ISSUER_CATEGORY_WORDS` has at least one issuer definition in front of the drafter. Coverage checked 2026-10-11 over the catalog captures (a page counts when a sentence of its capture names the category's words with definition wording and no exclusion):

| Category | Pages with a definition sentence |
| --- | --- |
| supermarkets | amex-rewards-info-retail, boa-cash-back-category-choices, boa-customized-cash-rewards-pricing, chase-rewards-category-faq, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories, wells-fargo-choice-privileges-rewards-terms |
| dining | amex-rewards-info-retail, boa-customized-cash-rewards-pricing, chase-rewards-category-faq, citi-strata-rewards-terms, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories |
| drugstores | amex-rewards-info-retail, boa-cash-back-category-choices, boa-customized-cash-rewards-pricing ("drug stores and pharmacies"), chase-rewards-category-faq, discover-cashback-calendar, us-bank-edward-jones-triple-rewards-categories |
| streaming | amex-rewards-info-retail, boa-cash-back-category-choices, chase-rewards-category-faq, citi-strata-rewards-terms, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories, wells-fargo-autograph-categories |
| gas | amex-rewards-info-retail, boa-cash-back-category-choices, boa-customized-cash-rewards-pricing, chase-rewards-category-faq, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories |
| ev-charging | boa-cash-back-category-choices, boa-customized-cash-rewards-pricing, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories |
| transit | amex-rewards-info-retail, boa-cash-back-category-choices, chase-rewards-category-faq, citi-strata-rewards-terms, discover-cashback-calendar, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories |
| department-stores | amex-rewards-info-retail, chase-rewards-category-faq, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories, wells-fargo-choice-privileges-rewards-terms |
| home-improvement | boa-cash-back-category-choices, boa-customized-cash-rewards-pricing, chase-rewards-category-faq, discover-cashback-calendar, us-bank-edward-jones-triple-rewards-categories, wells-fargo-choice-privileges-rewards-terms |
| wholesale-clubs | boa-cash-back-category-choices, boa-customized-cash-rewards-pricing, discover-cashback-calendar, wells-fargo-choice-privileges-rewards-terms |
| electronics | boa-cash-back-category-choices, chase-rewards-category-faq, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants |
| entertainment | boa-cash-back-category-choices, chase-rewards-category-faq, citi-strata-rewards-terms, discover-cashback-calendar, us-bank-cash-plus-product, us-bank-cash-plus-sample-merchants, us-bank-edward-jones-triple-rewards-categories |

No category is without a page. The check is lexical, so a page listed for a category may define it only in passing (electronics and wholesale clubs rest on quarterly-category pages); the drafter's quote and the verifier decide. `general-merchandise` has no definition by design.

## Gates

- **Research** (`researchGate`): strict schema (no category, code, kind, goods flag or brand key can exist), every batch store once, the packet domain among its hosts, no public-suffix or platform host (`hostGate`), store pages on the store's hosts, lookup pages on another host and never a forum or community thread. `refusedLookup` refuses `fiserv.dev` at research, apply and build (the Visa manual is the code reference).
- **Draft** (`draftGate`): schema (at most 16 quotes; `supports` is `kind`, `physicalGoods`, `brand`, `category` or `definition`), quotes found verbatim (whitespace-insensitive) in `captures/<sourceId>.txt`, 25 words or fewer, brand ids from `CATALOG_V3`, source ids of that store only. Also re-run at `accept verify`. A catalog-brand store whose drafts fail three gates gets a default draft from research for the verifier.
- **Verify** (`verifyGate`): every store, all seven fields (`name`, `hosts`, `kind`, `physicalGoods`, `brandIds`, `candidateCategory`, `evidence`) decided, a reason for every dispute, one verdict per drafted quote (`quotes[]`, indices 0..n-1, `fields.evidence` disputed exactly when a quote is), `filesRead` naming every draft, sheet and capture input. `claim verify` writes `verify/catalog-lists.json` (brand ids and names, categories) and one sheet `verify/<domain>.md` per store (the drafted kind, goods flag, candidate and brands, then each drafted quote with ±300 characters of its capture), and lists issuer captures as their `*.windows.<domain>.txt` excerpts, so the verifier reads about 2 KB per store; verbatim and length checks stay mechanical (draft gate).
- **Apply** (`applyStore`, pure). Disputed quotes are dropped and the rule runs on the confirmed quotes; when they satisfy no basis the record ships on `general-merchandise`, `default`, no sources, with `downgraded: { reason }` (the disputed quotes' reasons) in `apply-report.json` and a Downgraded table in `review.md`; any other disputed field holds the record out. A category comes from the drafted `candidateCategory` only through one of three bases (`issuer` wins over `corroborated` over `definition`):
  - `issuer`: an `issuer-terms` quote that passes `issuerQuoteEarns`: one clause names the store or its domain label, has earning wording, names the candidate category's issuer words from `ISSUER_CATEGORY_WORDS`, and has no exclusion, limit, "only" or `CONDITIONAL_WORDING` (may, qualify, if, eligible); curly apostrophes normalised. An inclusion list under the category counts ("Includes the following streaming providers: … Netflix") when the category comes before its opener and the store after it; a hedged list ("Examples of … include") does not.
  - `corroborated`: a `store-page` and an `mcc-lookup` quote; a lookup quote counts only when it names the category's words and never from a forum-thread URL (`FORUM_URL`, dropped at apply).
  - `definition` (`definitionBasis`): a `store-page` `category` quote naming the business type (`BUSINESS_TYPE_WORDS`; a bare navigation word is none) plus an issuer `definition` quote whose clause names the category's issuer words with no exclusion wording and no `CALENDAR_WORDING` (months, quarters, a rate) (`definitionQuoteCovers`; a hedged definition does not cover); the store's **full store-page captures** name no kind of store the category excludes (`EXCLUDED_STORE_TYPES` / `CATEGORY_EXCLUDED_TYPES`: every category minus its own type plus per-category extras, such as superstores, discount stores and warehouse clubs for supermarkets and drugstores; membership or members-only wording excludes supermarkets; pharmacy words do not exclude supermarkets nor grocery words drugstores; furnishings stores are not home improvement); no sentence of the store's mined issuer windows names the store with exclusion wording about that category or its excluded kinds (`issuerExcludes`, read within the drafted category by direction around "include"/"such as", `clauseExcludes`); and the store is a `merchant` (a `marketplace` only for `dining` under a definition whose covering clause has unconditional delivery wording). Cites the store pages and the issuer page.
  - Otherwise `general-merchandise`, `default`, no sources. A missing store or issuer capture refuses. A refused candidate is reported with its reason (`refused` in `apply-report.json`, also beside a `downgraded` entry); cross-issuer conflicts of a granted category (`issuerConflicts`: an issuer sentence naming the store that excludes the category or lists it under another category's words, page chrome excluded) go to `conflicts` and a Conflicts table in `review.md`. Sources no record cites leave `release-config.json`.
  - A processor is forced to no goods, no brands, default; a processor drafted with goods or brands is held out.
- **Seed-run rules** ([decision](../decisions/2026-10-11-seed-run-rules.md)): a null candidate gives a default record with brands; the goods flag is the verifier's stated value; hosts a verifier cannot confirm are dropped and the record kept, and a host is dropped only on negative wording about it; a domain that redirects to another business's site is held out; `exclusions.json` lists out-of-scope stores; U.S. Bank fast food counts as dining; coordinator field corrections live in `overrides.json`.
- **Record ids**: the candidate's fixed id (legacy, processors), else `<label>-us` (`<label>` for processors); a `.us` id is not doubled, a subdomain store keeps its label (`music-apple-us`) and a non-.com suffix stays in the id (`pandora-net-us`).
- **Tier gates** (`candidates.ts`): `hostGate` (offline public-suffix and platform lists), `brandNameGate` (a tier-A label equal to a normalised catalog brand name moves to tier B), unknown brand ids and duplicated hosts refused. The tier-A builder skips `GENERIC_TITLE` titles (Welcome, Home, Sign in) and excluded domains.

## Blind audit

The audit of a release is run by scripts under `evals/merchants/db/audit/` ([method](../decisions/2026-10-11-merchant-audit-method.md), [report](../../docs/evals/merchant-db-v1.md)): `build-packets.mjs` writes `population.json` (committed) and gitignored packets of up to 25 stores whose sheets hold only the captured store pages, lookup and issuer excerpts around the store's name and the 12 definition pages' definition windows; one `merchant-auditor` run per packet ([agent file](../../.claude/agents/merchant-auditor.md), `claude-opus-5-5`, no web; run as general-purpose subagents reading the file when the type is not registered) writes `labels/packet-<n>.json`, gated by `check-labels.mjs` (domains in order, ids, quotes verbatim and ≤ 25 words, a bonus with basis and quotes, `filesRead` naming no record, evidence, draft, verification, review or release file); `score.mjs` compares with `release.json` (wrong bonus, missed bonus, wrong brand, kind, goods; `cant-tell` outside the numerators; Clopper–Pearson bounds from `evals/reader/stats.mjs`) and writes `comparison.json` and `adjudication-input.json`; a third subagent writes `adjudication.json` (`record`, `auditor` or `neither` per disagreement) and `score.mjs` runs again; `runs.json` records every run's tokens. `build-url-set.mjs` freezes the reader set's U.S. cart URLs and the traps in `url-test-set.json` for `extension/tests/merchant-url-set.test.ts`, which also generates every release host with subdomains and paths. Tests: `evals/merchants/db/audit/tests/audit.test.mjs` (`npm run test:scripts`). Fixes from an adjudicated audit are applied by `apply-adjudication.mjs` (`fixes.json`, shown in `review.md` under Audit fixes). Results: [report](../../docs/evals/merchant-db-v1.md).

## The mcc basis

`pipeline merchants mcc` ([mcc.ts](../../tools/catalog-pipeline/src/merchants/mcc.ts), [decision](../decisions/2026-10-11-mcc-evidence-basis.md)) runs after the seed and the audit fixes, over every record. An `mcc` grant replaces a `corroborated` or `definition` basis; `issuer` records keep theirs.

| Step | What |
| --- | --- |
| Datasets | Openly licensed government purchase-card transactions, fetched 2026-10-11 to the gitignored `mcc-data/`: Open Data DC "Purchase Card Transactions" (CC0; 639,306 rows, 2009–2026, monthly refresh so the hash dates the fetch), Oklahoma OMES "Purchase Card (PCard)" FY2022, FY2023, FY2024 (CC BY; 382,724 + 408,063 + 421,889 rows in 36 monthly files; the `ROWID` column repeats across months and is no key; descriptions truncated at 40 characters), GSA SmartPay Q3 2020 (CC0; 6,913 rows, the one quarterly file data.gov served). Excluded: Delaware (public-domain label only in portal metadata), Indiana (personal, news, nonprofit or academic use only), Oklahoma FY2025–26 (no licence). Every run verifies each file's SHA-256 and row count against `manifest.json`; a dataset's release-source hash is the file's hash, or the hash of the per-file hashes joined in path order |
| Matching | A record's rows are those whose merchant descriptor (upper case, non-alphanumerics to single spaces) matches its descriptor rule: by default the record's name as a word-boundary pattern with punctuation and spaces optional (`derivePattern`: "Best Buy" → `BEST ?BUY`, "Domino's" → `DOMINO ?S`; fewer than four letters gives none); `descriptors.json` overrides patterns (Whole Foods `WHOLEFDS`, Sam's Club, Costco, AMC, Grubhub, Disney+), adds excludes (Domino's car washes, Nordstrom cafés, Uber Eats inside Uber), vetoes (eBay) or skips. Rows reach candidates through anchor prefixes so "LOWES 1234" meets `LOWE ?S` |
| Codes | `codes.json`: each dataset description maps to a Visa code (titles from the Visa Merchant Data Standards Manual, April 2026, marked VISA PUBLIC, SHA-256 recorded) and the code to a category: 5411 supermarkets; 5300 wholesale clubs; 5912 drugstores; 5812/5813/5814 dining; 5732 (the datasets' "ELECTRONIC SALES")/5734 electronics; 5311 department stores; 5200/5211/5251 home improvement; 4899 streaming (Visa: subscription streaming merchants use 4899); 7832/7922/7929/7941/7991/7996/7998 entertainment; 4111/4112/4121/4131/4784/7523 transit; 5541/5542 gas; 5552 EV charging; 5310, 5331, 5399, 5262, 5499, 5968, 5815–5818 and anything unmapped are general merchandise |
| Grant (`decide`) | Fuel rows (5541, 5542, 5983) are set aside unless fuel is the store's dominant category over every row; then at least 10 usable rows and one bonus category at 80% or more; minority descriptions are conflicts. Outcomes: `granted`, `too-few-rows`, `not-dominant`, `no-bonus-code` |
| Safeguards | A processor gets nothing; a marketplace only `dining` (Instacart's 19 grocery rows, Uber's 2,493 taxicab rows and Ticketmaster's 27 entertainment rows are refused); `pageVeto`: for supermarkets and drugstores the record's full store-page captures (the batch's) must not call it a superstore, discount store, warehouse club, membership store or the like (`CATEGORY_EXCLUDED_TYPES`); a `veto` in `descriptors.json` (eBay: the department-store code is the marketplace platform's); `issuer` records keep their basis (`kept-issuer`, with whether the data agrees); `issuerConflicts` over the store's mined issuer windows are listed. Walmart and Target need no veto: Walmart's rows are discount stores, Target's split 63/37 between discount stores and grocery |
| Online check | Rows whose descriptor shows an online channel (`ONLINE_WORDING`: WWW, COM, ONLINE, CNP, APP, a toll-free phone number, GIFT/GFT/RELOAD/CASHSTAR, or the store's own host) are tallied apart (`isOnline`); five or more of them with a dominant category other than the store's refuse the grant (`online-disagrees`: Starbucks's gift cards and reloads, Bambu Lab's own store host at 5399). 4899 backs `streaming` only through `streamingVeto`: no physical goods, no cable, satellite, internet or phone provider in the name or descriptors (`TELECOM_WORDING`), and readable pages that show a streaming service (`STREAMING_PAGE_WORDING`). A delivery marketplace granted dining lists every definition-page sentence that excludes or conditions delivery (`deliveryExclusions`) |
| Output | Records (`basis: 'mcc'`, the ids of the datasets with a row of the granted category as `sourceIds`), evidence files (one "MERCHANT \| DESCRIPTION" quote per dataset from that dataset's own rows, batch `mcc-2026-10`), the dataset sources in `release-config.json`, `results.json` (rows, fuel rows, usable rows, per-dataset and per-description tallies, top descriptors, dominant category and share, conflicts, issuer conflicts, outcome, previous basis, changed); `review.md` gains "MCC evidence: public card-transaction datasets, for Evan" (every store with 10+ rows). A re-run that no longer grants an `mcc` record returns it to the default |

- **Attribution.** The Oklahoma datasets are CC BY; the notice is [`NOTICE.md`](../../evals/merchants/db/mcc/NOTICE.md), shown on the site's [`/credits/`](public-site.md) page.
- **Channel.** The rows are government purchasing, in person and card-not-present, not consumer online checkout; `review.md` and the report disclose it.

## Gotchas

- Headless Chromium is bot-walled by many store homepages (2026-10-11: chewy.com 403, crocs.com 429); the record still gets a default name from the label, marked `(blocked)` in `tier-a-manifest.json`.
- The agent types `merchant-researcher`, `merchant-verifier` and `merchant-auditor` are registered per session; a session started before the files existed runs a general-purpose subagent that reads the agent file first, and records the pinned model it ran on.
- Batch captures are gitignored and live in the checkout that ran `run capture`; a removed worktree takes them along, and the next session re-captures the store pages (the manifest's hashes and dates change) and re-mines the issuer captures. `state.json` does not mark `verify` stale when drafts are rewritten; reset it by hand before `claim verify`.
- Issuer captures exist only in the main checkout; in a worktree set `AICHECKOUT_ISSUER_CAPTURES=/Users/evanliu/Projects/AICheckout`. Copies land in the batch's gitignored `captures/`.
- `candidates.json` is 692 candidates against the plan's "about 500": the tier-B groups were authored to the plan's sizes (310 unique) and the U.S. frame contributes 361. The list is frozen.

## Related

* [Phase 14 plan](../product/phase-14-merchant-database.md)
* [Card-expansion pipeline](card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
* [Rewards engine: merchant release contract](rewards-engine.md#merchant-release-contract-phase-141)
* [Live model runs](../ops/live-model-runs.md)
* [Decision: 14.3 details](../decisions/2026-10-11-merchant-pipeline-14-3-details.md)
* [Decision: seed-run rules](../decisions/2026-10-11-seed-run-rules.md)
* [Decision: audit method](../decisions/2026-10-11-merchant-audit-method.md)
* [Merchant database v1 report](../../docs/evals/merchant-db-v1.md)
