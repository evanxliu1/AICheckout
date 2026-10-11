---
type: System Component
title: Merchant pipeline (Phase 14.3)
description: How the merchant database records are built. The frozen candidate list in two tiers, the deterministic tier-A builder, and the tier-B stages under `pipeline merchants` (research and verify by Claude subagents through work packets, capture, a gpt-5.6-luna draft through Codex with prompt merchant-draft.1, a deterministic apply that applies the evidence rule and holds any disputed record out, the build and review.md). Built 2026-10-11 (UTC) in milestone 14.3; the dry run's numbers are under Dry run.
status: stable
tags: [system, merchants, pipeline, phase-14, curation]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T02:00:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 5, 6, 8)
  - resource: ../../tools/catalog-pipeline/src/merchants/cli.ts
    title: pipeline merchants CLI
  - resource: ../../tools/catalog-pipeline/src/merchants/files.ts
    title: Schemas of every pipeline file
  - resource: ../../tools/catalog-pipeline/src/merchants/apply.ts
    title: applyStore (evidence rule, hold-out rule)
  - resource: ../../tools/catalog-pipeline/src/merchants/candidates.ts
    title: buildCandidates and the tier gates
  - resource: ../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.1.md
    title: Prompt merchant-draft.1
  - resource: ../../evals/merchants/db/candidates.json
    title: Frozen candidate list
  - resource: card-expansion-pipeline.md
    title: Card-expansion pipeline (the pattern this follows)
---

# Merchant pipeline (Phase 14.3)

The merchant database ([plan](../product/phase-14-merchant-database.md)) is built from a frozen candidate list in two tiers. Tier A (the long tail) gets deterministic default records with no model. Tier B (brands, bonus-category groups, processors) goes through a small pipeline, `npm run pipeline -- merchants <command>`, that follows the [card pipeline](card-expansion-pipeline.md) pattern: a batch directory with a text-free `state.json`, claimed work packets for the two agent stages, gates on every model output, and a deterministic apply. Models never set `category`: luna proposes a candidate, Claude verifies every field, and `applyStore` applies Evan's evidence rule. A disputed field holds the whole record out; there is no adjudicator.

## Facts

| Item | Value |
| --- | --- |
| Candidate list | [`evals/merchants/db/candidates.json`](../../evals/merchants/db/candidates.json) (`merchant-candidates.1`, frozen 2026-10-11): 692 candidates, tier A 380, tier B 312, 60 held out and marked, 1 moved to B by the brand-name gate (`doordashstore.com`). Groups: catalog brands 126, supermarkets 40, dining 30, drugstores 10, streaming 25, entertainment 20, home improvement 10, wholesale clubs 5, department stores 20, electronics 15, transit 15, processors 15, legacy 3, top stores 361, held-out-only 20 (a domain may be in several groups) |
| List sources | [`candidate-groups.json`](../../evals/merchants/db/candidate-groups.json) (hand-authored tier-B domains by group, processor and legacy record ids and hosts, brand ids), the U.S. eligible domains of the frozen [`retail-frame-3.json`](../../evals/merchants/retail-frame-3.json), the frozen [`pipeline-heldout-domains.json`](../../evals/merchants/pipeline-heldout-domains.json); each with its SHA-256 in the list. Domain names only |
| Batches | `evals/merchants/db/batches/<batch>/`: `batch.json`, `state.json`, `research.json`, `sources.json`, `manifest.json`, `drafts/<domain>.json`, `verification.json`, `apply-report.json` committed; `captures/`, `traces/`, `packets/` gitignored |
| Records and evidence | `evals/merchants/db/records/<id>.json`, `evidence/<id>.json` (quotes of 25 words or fewer with source id and kind), cited sources in `release-config.json`; `npm run merchants` builds `merchants-v1.ts` and `release.json`; `review.md` lists deviations only |
| Draft model | gpt-5.6-luna, `xhigh`, visible output tokens, 600 s per store, through `createCodexProvider` (`apps/api/src/curation/codex.ts`); prompt [`merchant-draft.1`](../../tools/catalog-pipeline/src/merchants/prompts/merchant-draft.1.md), hashed into the draft files and `state.json`. Refused under `CI` or `RENDER` |
| Agents | [`merchant-researcher`](../../.claude/agents/merchant-researcher.md) and [`merchant-verifier`](../../.claude/agents/merchant-verifier.md), both `claude-opus-5-5`; up to 25 stores per packet |
| Issuer evidence | Mined deterministically from the catalog's issuer captures (main checkout, or `AICHECKOUT_ISSUER_CAPTURES`): word-boundary name match, the newest capture per source id, at most 5 per store, copied into the batch's captures under the catalog's source id with windows around the matches for the drafter |
| Tests | [`tools/catalog-pipeline/tests/merchants-pipeline.test.ts`](../../tools/catalog-pipeline/tests/merchants-pipeline.test.ts): apply rule, hold-out rule, research and verification schemas, tier gates, candidates file, tier-A names, issuer mining, review.md, agent files |

## Commands

| Command | Does |
| --- | --- |
| `merchants candidates [--check]` | Rebuilds the list from its three sources; `--check` fails when the committed file differs (the list is frozen; a change is deliberate) |
| `merchants tier-a [--only d,d] [--limit N]` | Renders each tier-A homepage logged out (robots.txt recorded), names the record from `og:site_name`, `application-name` or `<title>`, else the domain label; a bot wall, error page or empty render falls back to the label and is marked `(blocked)` in `tier-a-manifest.json`; writes default records. Refuses held-out domains |
| `merchants init <batch> --stores d,d [--development]` | A tier-B batch of at most 25 candidates; refuses tier-A, unknown and held-out domains (`--allow-heldout` is for 14.4, never with `--development`) |
| `merchants claim research\|verify --batch B [--release]` | Writes `packets/<stage>.<n>.json` (inputs hashed, one output) |
| `merchants accept research\|verify --batch B --agent-run <id> [--model] [--duration-ms] [--tokens] [--dry-run]` | Runs the gate; records packet, run, model, duration and tokens in `state.json` |
| `merchants run capture --batch B` | `sources.json` from the research (store pages, lookups), `scripts/capture-issuer-pages.mjs` into the batch's captures (1.5 s between pages), then issuer mining into `manifest.json` |
| `merchants run draft --batch B [--only d]` | One Codex call per store; gate: Zod, quotes verbatim in the named capture and at most 25 words, catalog brands, the store's own sources; tokens and time per store in `state.json` |
| `merchants run apply --batch B` | `applyStore` per store; records, evidence and cited sources written; `verifiedAt` raised to the newest cited capture; `apply-report.json` |
| `merchants run build [--batch B]`, `merchants review` | `scripts/build-merchants-v1.mjs` and `review.md` |
| `merchants status [--batch B] [--json]` | Stage statuses, agent models, tokens and time, draft tokens and model time, records and held-out counts, open packets |

## Gates

- **Research** (`researchGate`): strict schema (no category, code, kind, goods flag or brand key can exist), every batch store once, the packet domain among its hosts, no public-suffix or platform host (`hostGate`), store pages on the store's hosts, lookup pages on another host and never a forum or community thread (added after the dry run; its netflix lookup predates the gate).
- **Draft** (`draftGate`): schema, quotes found verbatim (whitespace-insensitive) in `captures/<sourceId>.txt`, 25 words or fewer, brand ids from `CATALOG_V3`, source ids of that store only. Also re-run at `accept verify`.
- **Verify** (`verifyGate`): every store, all seven fields (`name`, `hosts`, `kind`, `physicalGoods`, `brandIds`, `candidateCategory`, `evidence`) decided, a reason for every dispute, `filesRead` naming every draft, sheet and capture input. `claim verify` writes `verify/catalog-lists.json` (brand ids and names, categories) and one sheet `verify/<domain>.md` per store (each drafted quote with ±300 characters of its capture), and lists issuer captures as their `*.windows.<domain>.txt` excerpts, so the verifier reads about 2 KB per store; verbatim and length checks stay mechanical (draft gate).
- **Apply** (`applyStore`, pure): a disputed `evidence` → the record ships on `general-merchandise`, `default`, no sources, with `downgraded: { reason }` in `apply-report.json` and a Downgraded table in `review.md`; any other disputed field → held out. Category from the drafted `candidateCategory` only with an `issuer-terms` quote that passes `issuerQuoteEarns` (one clause names the store or its domain label, has earning wording, names the candidate category's issuer words from `ISSUER_CATEGORY_WORDS`, and has no exclusion, limit or "only" wording; curly apostrophes normalised) (`issuer`), or a `store-page` and an `mcc-lookup` quote (`corroborated`); otherwise `general-merchandise`, `default`, no sources. Sources no record cites any more leave `release-config.json`. A processor is forced to no goods, no brands, default; a processor drafted with goods or brands is held out. Record ids: the candidate's fixed id (legacy, processors), else `<label>-us` (`<label>` for processors).
- **Tier gates** (`candidates.ts`): `hostGate` (offline public-suffix and platform lists), `brandNameGate` (a tier-A label equal to a normalised catalog brand name moves to tier B), unknown brand ids and duplicated hosts refused.

## Dry run (development batch `dev-2026-10`)

Run 2026-10-11 (UTC) on kroger.com, cvs.com, netflix.com, instacart.com, costco.com, delta.com, paypal.com, wholefoodsmarket.com, ubereats.com and lowes.com (none held out). Subagents were general-purpose Opus runs reading the agent files (the new agent types were not registered in that session).

| Stage | Measured |
| --- | --- |
| Research (Opus) | 95,707 tokens, 233 s for 10 stores; 1 store with a lookup page (netflix, a forum thread); classification.codes skipped (terms) |
| Capture | 22 store and lookup pages (delta 444 and a lowes page 403 bot-walled); 39 issuer captures mined from 338 catalog captures |
| Draft (gpt-5.6-luna `xhigh`) | 10 of 10 after one prompt tuning: 97,286 input / 2,478 output tokens, 353 s model time, 5–123 s per store; the quote gate refused 3 non-verbatim quotes (an added period, a layout-interrupted sentence, two dropped words) |
| Verify (Opus) | run 1 (brief without the issuer-exclusion row): 155,321 tokens, 170 s, 9 of 10 confirmed; run 2 (final brief): 385,449 tokens excluding cache reads (6.97M cached), 306 s, 5 of 10 confirmed, 62 quotes checked |
| Apply (after the review fixes) | 9 records, all `default`: `kroger-us`, `netflix-us`, `instacart-us` (brand `instacart`, marketplace), `ubereats-us` (marketplace, no goods) downgraded on disputed `evidence` (Citi quotes are a gas-exclusion list; BoA Online Shopping example and a statement credit; a co-brand bonus; Chase's separate food-delivery category); `cvs-us` default because its Amex quote is a definition line with no earning words; `delta-us` default with brand `delta` and no goods; `paypal` processor; `wholefoodsmarket-us` with brand `whole-foods-market`; `lowes-us`. 1 held out: costco (`hosts`: costcobusinessdelivery.com in no capture). No store reached `issuer` or `corroborated`: **0 non-default categories** in the release after the dry run. Clause splitting ignores abbreviations (U.S., e.g., Inc.) and colons, so "Earn 6% at U.S. supermarkets like Kroger" counts; a definition line such as Amex's "The U.S. drugstore list is: CVS Pharmacy…" still does not, because it states no earning. Before the fixes the same run gave 5 records (cvs `issuer` on the definition line) and 5 held out |
| Build | release `2026-10-11.dev.1`, 26 records; `review.md` lists 0 bonus categories, 6 brand records, 15 processors, 3 services, 4 downgraded and 1 held-out store |

What the apply rule changed against the drafts: every drafted category fell to `default`. Under the tightened `issuerQuoteEarns` none of the 20 issuer quotes is an earning statement naming the store and its category in one clause (they are exclusion lists, definitions, other categories, credits or co-brand bonuses), and no store had both a store page and a lookup. Evan may loosen the bar (an issuer's category definition covering the business type plus the store's own pages); `applyStore` decides `basis` in one place so a further basis can be added. The verifier's convention questions for Evan: does an issuer's dedicated food-delivery category support `dining`; may `name` and `hosts` be settled from issuer captures when the store page is bot-walled (delta); should kroger, lowes and paypal carry their co-brand cards as brands (none is a catalog brand today).

**Projected full seed:** tier B 312 stores ≈ 13 research and 13 verify packets: research ≈ 3.0M Claude tokens at the dry run's rate; verify measured at ≈ 38.5k tokens per store (385k for 10, cache reads excluded) when the verifier read every capture in full (about 60 KB per store); with the sheets, windows and brand list added after the review it should read about 2–4 KB per store, so the expected verify cost is roughly 5–8k tokens per store (≈ 2–2.5M for tier B), not re-measured (a re-verify of the dev batch would cost another run). Luna ≈ 3.0M input / 80k output tokens and about 3 hours of model time; tier A 380 homepage renders with no model.

## Gotchas

- Headless Chromium is bot-walled by many store homepages (2026-10-11: chewy.com 403, crocs.com 429 in the tier-A smoke test); the record still gets a default name from the label. 14.4 should expect many `(blocked)` names and may add a `request: true`-style static fetch.
- The agent types `merchant-researcher` and `merchant-verifier` are registered per session; a session started before the files existed runs a general-purpose subagent that reads the agent file first (the dry run did), and records the pinned model it ran on.
- Issuer captures exist only in the main checkout; in a worktree set `AICHECKOUT_ISSUER_CAPTURES=/Users/evanliu/Projects/AICheckout` (the dry run did). Copies land in the batch's gitignored `captures/`.
- `candidates.json` is 692 candidates against the plan's "about 500": the tier-B groups were authored to the plan's sizes (310 unique) and the U.S. frame contributes 361. Evan may trim tier A; the list is frozen once 14.4 starts.

## Related

* [Phase 14 plan](../product/phase-14-merchant-database.md)
* [Card-expansion pipeline](card-expansion-pipeline.md)
* [Merchants](../domain/merchants.md)
* [Rewards engine: merchant release contract](rewards-engine.md#merchant-release-contract-phase-141)
* [Live model runs](../ops/live-model-runs.md)
* [Decision: 14.3 details](../decisions/2026-10-11-merchant-pipeline-14-3-details.md)
