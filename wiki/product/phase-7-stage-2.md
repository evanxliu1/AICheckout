---
type: Product
title: Phase 7 Stage 2 plan
description: Ordered milestones that turn the 173-card agent-verified expansion corpus into a published 180-card catalog v3 the extension ranks correctly — points valuation, merchant-specific, chosen, rotating, gated, closed-loop and checkout-method rules, larger limits, wallet search, review app, eval, docs — and leave the project ready for the card-expansion pipeline.
status: draft
tags: [product, plan, phase-7, catalog, engine, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T20:30:00Z
stale_after: 2026-11-01T00:00:00Z
sources:
  - resource: ../system/catalog-expansion.md
    title: Catalog expansion (corpus, known gaps)
  - resource: ../../evals/curation/expansion/corpus.json
    title: expansion.v1 corpus (173 cards, agent-verified)
  - resource: ../../evals/curation/expansion/product-notes.verified.json
    title: Verified product notes (197 hints)
  - resource: ../../evals/curation/expansion/manifest.json
    title: Expansion capture manifest (321 sources, captured 2026-10-02)
---

# Phase 7 Stage 2 plan

Stage 2 makes `expansion.v1` (173 agent-verified cards, merged with PR #17 at `23d3d52`) plus the 7 real cards into one published **catalog v3** of 180 cards that the extension ranks by cash-equivalent value, with current docs and a design for the card-expansion pipeline that comes next. Planned 2026-10-02 from `main` `23d3d52`; nothing here is implemented yet. Decisions: [points valuation](../decisions/2026-10-02-points-valuation-published-estimates.md), [catalog v3](../decisions/2026-10-02-catalog-v3-schema.md). Order after Stage 2: [roadmap](roadmap.md).

## Facts that shape the plan

| Fact | Value (read 2026-10-02) | Consequence |
| --- | --- | --- |
| Capture date of all 321 expansion sources | 2026-10-02 | A catalog citing them has `expiresAt` ≤ **2026-11-01T00:00Z** (30-day source age and validity rules) and must be published before then |
| Hosted release 1 (7 cards) | expires 2026-10-29T00:00Z | Publish v3 by about **2026-10-28**, or `/v1/catalog` returns 503 and extensions fall back to an expired bundled catalog |
| Corpus | 173 cards: 102 points, 71 cash back; 18 points cards with an issuer-stated value; 863 rules (284 `other`), 195 issues on 112 cards; at most 20 rules and 3 sources per card | Points need a valuation; `other` rules and issues need explicit dispositions |
| Product hints | 197: merchant-specific 132, relationship-tier 28, chosen category 13, checkout-method 11, closed-loop 8, rotating 4, automatic top category 1; 78 distinct merchant names | Engine features below; most merchant rules name brands with no site adapter yet |
| Cards without exactly one base rule | 9 (closed-loop store cards, CareCredit and OnePay with two, Upromise with a null and a 125, Marriott Bonvoy Bold and U.S. Bank Shield with none) | Overlay picks the base or marks the card closed-loop; cards with no stated base are held out |
| Size | Naive v3 JSON of 180 cards ≈ 0.48 MB; captures total 6.07 MB, largest 204,334 chars (2 over the 120,000-char body limit) | Raise `MAX_CATALOG_BYTES` to 1 MiB, source body to 250,000 chars, draft sources to 600 |
| Vault | Catalog cache lives inside the encrypted state; `MAX_VAULT_BYTES` 512 KiB | Move the catalog cache out of the vault-protected state |
| Review detail | Returns every attached capture body; response cap 8 MiB; ≤ 30 sources per draft | New summary RPC without bodies; bulk capture attach |
| Eval loader | `loadCorpusV2` manifest ≤ 100 sources | Loader option for the 321-source manifest |
| Local data | Captures and the 180 luna traces are gitignored, in the `../AICheckout-expansion` worktree | Milestones that build quotes, the catalog or scores copy or link them in |

## Milestones

Each milestone is one branch and one PR cut from the latest `main`; independent subagents review before merge (`agent-verified`). Branch names are `stage2-m<N>-<slug>`.

| # | Milestone | Depends on | Evan |
| --- | --- | --- | --- |
| M1 | Catalog v3 contract and migration | — | none (coordinator pushes the migration) |
| M2 | Engine v3 | M1 | none |
| M3 | Reward-program valuation table | — (start now) | none (resolved: decision 2) |
| M4 | Catalog overlay: merchants, brands, choices, gates, rotating, checkout methods, issue dispositions | M1 | none |
| M5 | Catalog builder v3 and the 180-card catalog | M1, M2, M3, M4 | none |
| M6 | Extension state and engine wiring | M1, M2 | none |
| M7 | Extension UI: wallet search, card options, value display, badge | M6 (M5 for real-data browser tests) | none |
| M8 | Review app and API for the large catalog | M1 (M5 for real-data tests) | none |
| M9 | Expansion eval | — (start now) | none (coordinator starts the run; decision 4) |
| M10 | Docs, site, publish | M5–M9 | publish the release in the review app |
| M11 | Card-expansion pipeline readiness | — (draft now, finalize after M5) | approve the design |

Start in parallel: M1, M3, M9, M11 (draft). After M1: M2, M4 and M8 in parallel. Then M5 and M6, then M7, then M10. Target: M5 merged by 2026-10-20, M10 publish by 2026-10-28.

### M1 Catalog v3 contract and migration
- **Scope.** Types and Zod `catalogV3Schema` per the [v3 decision](../decisions/2026-10-02-catalog-v3-schema.md): `programs`, `brands`, `gates`, merchants with `brandIds`, card `programId`, `statedValueHundredthsOfCent`, `acceptance`, `choices`; rule `brandIds`, `choice`, `requires`, `requiredPaymentPaths`, `limitedTime.startsOn`; payment path `venmo`; new rule statuses (`not-accepted`, `not-started`, `choice-not-selected`, `condition-not-met`) and uncertainties (`choice-unknown`, `automatic-category`, `condition-unknown`); limits (300 cards, 600 sources, 100 merchants, 400 brands, 100 programs, 100 gates, 30 rules per card, 1 MiB). Category additions are only the names M4 needs; M1 ships the mechanism and a provisional list that M4 may extend in its own PR.
- **Files.** `packages/rewards-core/src/{types,schema}.ts`, `test-cases.ts` (`catalogV3Cases`), new migration `supabase/migrations/<ts>_catalog_v3.sql` (`valid_catalog_v3`, `valid_catalog` = v1|v2|v3, `drafts.source_document_ids` ≤ 600, `source_documents.body` ≤ 250,000), `packages/catalog-review/src/index.ts` (`MAX_SOURCE_BODY_CHARS`, source ID limits), `scripts/test-catalog-parity.mjs`, `supabase/tests/catalog_v3.test.sql`.
- **Tests.** Parity cases for every invariant (one base for open-loop, none required for closed-loop, brand/gate/program/choice references resolve, issuer-stated value only on points programs, `startsOn ≤ endsOn`, size); pgTAP; `db:test:catalog`.
- **Acceptance.** v1 and v2 cases unchanged and passing; v3 cases agree in Zod and SQL; `npm test`, lint, typecheck, both workflows green.
- **Risks.** The SQL validator grows large; keep the JSON-schema part generated from the same constants the Zod schema uses. Never edit an applied migration.
- **Evan.** None. After merge the coordinator runs `./scripts/db-push.sh` (standing authorization).

### M2 Engine v3
- **Scope.** `compareV3` in `engine-v3.ts`, dispatched from `compareRewards`. Value per unit = shopper override → card stated value → program estimate; cents = `floor(Σ spend × rateBps × value / 1,000,000)` in BigInt. Brand scope (rule applies only where the merchant's `brandIds` intersect); closed-loop cards are `not-accepted` and left out of the ranking elsewhere; chosen categories (known choice applies or blocks, unknown gives a range with `choice-unknown`); automatic top category is a range (`automatic-category`); gates (`no` blocks, unknown gives a range with `condition-unknown`); required payment paths; rotating rules by `startsOn`/`endsOn`. Wallet input gains per-card `choices`, `gates` and wallet-level `valueOverrides` (per program).
- **Files.** `packages/rewards-core/src/{engine,engine-v3,engine-shared,money,types}.ts`, `extension/tests/rewards-v3.test.ts`.
- **Tests.** Table tests per feature, ranking ladders at `amazon-us`, `best-buy-us`, `newegg-us` with fixture cards (Prime Visa vs Amazon Store Card vs BCE; My Best Buy Visa; Cash+ with electronics chosen; PayPal Cashback with `paypal`; Freedom Flex before and after 2026-12-31), points vs cash ordering under overrides.
- **Acceptance.** v2 results byte-identical for `CATALOG_V2` cases; every new status and uncertainty covered; no floats in money paths.
- **Risks.** Range explosion when choices and gates are unknown: the badge must still name one card; keep `rankingMayChange` semantics.

### M3 Reward-program valuation table
- **Scope.** `evals/curation/expansion/reward-programs.json`: every program the 180 cards earn, with value (hundredths of a cent), basis, publisher, URL, date read; card → program map with a ≤ 25-word currency anchor per card. One researcher subagent with web access collects values; an independent subagent re-reads every cited page; an adjudicator settles differences. Numbers, URLs and dates only.
- **Files.** `reward-programs.json`, `scripts/lib/reward-programs.mjs` (Zod), `scripts/check-expansion-quotes.mjs` (scan the new file), tests in `scripts/lib/*.test.mjs`.
- **Acceptance.** Every corpus card maps to one program; every published estimate has URL and date within 30 days; issuer-stated corpus values are carried, not replaced; quote check passes.
- **Risks.** Publishers disagree widely (transferable currencies 1.0–2.0¢); pick one primary publisher (decision 2). Some programs have no published estimate.
- **Evan.** Resolved (decision 2).

### M4 Catalog overlay
- **Scope.** `evals/curation/expansion/catalog-overlay.json` (and `merchants.json` for brands and the three existing merchant profiles with `brandIds`): for every card, the base rule choice where needed, `acceptance`, choices, gates, rotating schedules (Freedom Flex Q1 2027 from its product note with `startsOn` 2027-01-01), checkout-method rules (PayPal Cashback, Venmo, Key Rewards, Bass Pro/Cabela's, Choice Privileges), store-only redemption labels; for every `other` rule a disposition (brand scope, new category, or `not-at-retail`); for every issue a disposition (`modelled`, `field-unstated`, `rule-held-out`, `card-held-out`, `noted`). Final list of new reward categories (for example `electronics` for Cash+ "Electronics stores" at Best Buy and Newegg); add one only when a rule or option names it. Authored by per-issuer subagents, checked by independent verifier subagents, adjudicated; per-issuer notes in `verification/conventions/`.
- **Files.** `catalog-overlay.json`, `merchants.json`, `scripts/lib/catalog-overlay.mjs` (Zod + coverage check), `check-expansion-quotes.mjs`.
- **Acceptance.** Coverage check passes: no undisposed `other` rule, issue or hint; every anchor verbatim and ≤ 25 words, no adjacency run over 25; corpus files byte-identical.
- **Risks.** Largest judgment workload of the stage; keep conventions in the general file so issuers agree. Brand names must not imply affiliation in the UI.

### M5 Catalog builder v3 and the 180-card catalog
- **Scope.** `scripts/build-catalog-v3.mjs` (`npm run catalog:v3`, `catalog:v3:check` in CI) from `real/corpus.v2.json` (7 cards) + `expansion/corpus.json` + overlay + programs + merchants → `packages/rewards-core/src/catalog-v3.ts`; short rule IDs; version `2026-10-02.expansion.1`, `verifiedAt` 2026-10-02, `expiresAt` 2026-11-01. Build report `evals/curation/expansion/catalog-build-report.md` (held-out cards and why, byte size, per-feature counts). Seed regenerated from v3.
- **Tests.** Builder unit tests; golden ranking tests on the real catalog for a dozen wallets at the three merchants; `db:seed:check`.
- **Acceptance.** Catalog parses in Zod and SQL; ≤ 75% of 1 MiB; every held-out card listed with a reason; ladders match hand-computed expectations reviewed by a subagent.
- **Risks.** Size over budget (drop duplicated issuer wording, shorten IDs); the 2026-11-01 expiry.

### M6 Extension state and engine wiring
- **Scope.** App state schema 3 with migration: catalog cache moves to its own unencrypted key (public data; keeps the vault under 512 KiB); wallet cards gain `choices` and `gates`; wallet `valueOverrides`; usage rows per card up to 30. Catalog refresh accepts v3; the bundled fallback is `CATALOG_V3`; the badge `ready` view sends only the owned cards, the merchant and their programs, never the whole catalog.
- **Files.** `extension/src/state/{contracts,service,migrate,catalog,vault-service}.ts`, `background/badge-service.ts`, `badge/contracts.ts`, `packages/catalog-client`.
- **Tests.** Migration 2 → 3 with and without the vault; vault size with a 1 MiB catalog; refresh rules for v3; badge payload size bound.
- **Acceptance.** All existing extension tests pass; a locked vault still shows the catalog-independent prompts; content scripts gain no wallet or catalog code.

### M7 Extension UI
- **Scope.** Wallet search and add over 180 cards in popup and onboarding (combobox with issuer grouping, keyboard and screen-reader support, no network); per-card options (chosen categories, memberships and tiers, activation) shown only for cards that have them; a "Point values" section listing the programs of owned cards with the estimate, publisher, date and an override field; results and badge show units plus cash value with "estimate" labels, `not-accepted` and gate conditions in plain words; Venmo in the payment selector. New shared parts go into `packages/ui` on Helios tokens.
- **Tests.** Component tests; Playwright `popup-a11y`, `badge.spec`, `extension.spec` with axe; CSP check (`style-src 'self'`, no inline styles).
- **Acceptance.** Add any card by typing part of its name; ranking changes when an override or choice changes; axe clean at popup and badge sizes.
- **Risks.** Popup height and badge panel space; bundle size from the bundled catalog (load it once in the worker if the package grows past budget).

### M8 Review app and API for the large catalog
- **Scope.** Migration adding a review summary RPC that returns source metadata without bodies (old RPC kept); API and `@ai-checkout/catalog-review` use it; the review app attaches captures in bulk from a folder of `<source id>.txt` files, hash-checked against the real, merchant and expansion manifests; `StartDraft` offers `CATALOG_V3`; `StructuredEditor` and `ChangesTable` handle v3 with card search and collapsed cards; `/v1/catalog` serves up to 1 MiB.
- **Tests.** Unit and component tests; `e2e/review.spec.mjs` with a 180-card draft and 340 sources on the local stack; `a11y.spec.ts`.
- **Acceptance.** A v3 draft with every source attached publishes on the local stack; the review detail stays under 8 MiB.
- **Evan.** None until M10; the coordinator pushes the migration after merge.

### M9 Expansion eval
- **Scope.** Loader option for the 321-source manifest (no scorer change). Two measurements, reported separately: (a) **pipeline metrics** from committed files: draft → verified correction rate per field and issuer, rules added and removed by verifiers, cards confirmed unchanged (10 of 173), cards dropped (7) and undrafted (21); (b) **re-scored saved luna traces** with `v2-scorer.2`, labelled agreement with labels seeded from luna drafts, an upper bound, plus (c) a **cross-model live run** of a model that neither drafted nor verified the labels. Results to `docs/evals/expansion.{md,json}`; the expansion cards were never used for prompt tuning, and that is stated.
- **Files.** `apps/api/src/curation/v2/corpus.ts` (option), `scripts/score-expansion-traces.mjs`, `scripts/expansion-pipeline-metrics.mjs`, `docs/evals/expansion.*`.
- **Acceptance.** Every number reproducible from saved traces or committed files; the bias disclosure appears next to the luna number; `eval:v2 --check` unchanged.
- **Evan.** Start (or authorize) the cross-model run: `npm run eval:v2 -- --provider codex --model <model> --corpus evals/curation/expansion/corpus.json` from the worktree with the captures.

### M10 Docs, site, publish
- **Scope.** Wiki pages ([rewards engine](../system/rewards-engine.md), [reward rules](../domain/reward-rules.md), [cards](../domain/cards.md), [merchants](../domain/merchants.md), [extension](../system/extension.md), [cart badge](../system/cart-badge.md), [review app](../system/review-app.md), [database](../system/database.md), [evaluation](../system/evaluation.md), [catalog expansion](../system/catalog-expansion.md)); a catalog release runbook in `wiki/ops/`; README and site copy (seven cards → 180); stale package READMEs (decision 5).
- **Publish steps.** (1) Coordinator confirms both migrations on hosted and `main` deployed on Render. (2) Evan, in the hosted review app: start a draft from `CATALOG_V3`, attach all captures from the local capture folders, review, publish with a note, before 2026-10-28. (3) Coordinator checks `GET /v1/catalog` serves `2026-10-02.expansion.1` and a `build:hosted` extension refreshes to it (closes the Phase 3 M6 check).
- **Acceptance.** Linter clean; release live; roadmap marks Stage 2 done.

### M11 Card-expansion pipeline readiness
- **Scope.** Decision record and plan page for the pipeline: a CLI in `tools/catalog-pipeline` (stages research → capture → extract → draft → verify → adjudicate → apply → overlay → build → eval, resumable per batch), the skill `.claude/skills/expand-catalog`, subagent definitions `card-researcher` and `card-verifier` (plus an adjudicator), a hash-only freshness check, the `rate_not_in_evidence` fix for "NX" multiples, and the boundary rule: product code (`extension`, `packages/*`, `apps/*`) never imports `tools/`, enforced by ESLint `no-restricted-imports` and a test. Existing `scripts/*expansion*` move into the CLI in the pipeline phase, not here.
- **Acceptance.** Evan approves the design; the boundary lint rule lands with a failing-import test.
- **Status (2026-10-02).** Drafted on branch `stage2-m11-pipeline-design`: [card-expansion pipeline design](../system/card-expansion-pipeline.md) (adds a `validate` stage, the `v2-validator.2` plan for "NX" multiples, and open questions), [decision record (proposed)](../decisions/2026-10-02-agent-driven-card-pipeline.md), draft `.claude/skills/expand-catalog/SKILL.md` and `.claude/agents/card-{researcher,verifier,adjudicator}.md`, the ESLint boundary rule and `scripts/lib/import-boundary.test.mjs`. Waiting for Evan's approval; finalize after M5.

## Risks across the stage

- **Deadline.** The 2026-11-01 expiry is fixed by the capture date; slipping past 2026-10-28 leaves no valid hosted catalog. Freshness after that uses hash-only checks (decision 1).
- **Rotating rules.** Freedom Flex and Discover Q4 rules end 2026-12-31; any catalog published after 2026-11-01 needs Q1 2027 data (Freedom Flex known; Discover not captured).
- **Label trust.** All labels and the overlay are agent-verified; Evan deferred a human spot-check on 2026-10-02.
- **Estimates as numbers.** Published valuations are opinions; the UI must never present them as issuer facts.

## Decisions on the plan's open questions

Resolved by the coordinator on 2026-10-02 under Evan's instruction to follow the coordinator's recommendations and finish Stage 2 completely; Evan may override any of them.

1. **Freshness after 2026-11-01: yes, hash-only checks.** The pipeline may fetch pages into a temporary folder and compare SHA-256 with the manifest. It never overwrites a capture or a corpus label. Unchanged pages get a new `checkedOn`; changed pages are re-captured as a new dated capture and go back through extraction and verification. The eval corpora (`real.v2.2`, `expansion.v1`) stay frozen.
2. **Valuation publisher: one conservative primary publisher** with per-program published values (cash-like rather than best-case travel redemptions), recorded with URL and retrieval date; M3 picks the publisher with the widest program coverage and documents why. Programs with no published estimate use an issuer-stated value from the captures where one exists; otherwise the card shows points only with a prompt to set a value. Never an assumed 1¢.
3. **Override precedence: the shopper's override wins**, including over an issuer-stated value; it is the shopper's own valuation.
4. **Cross-model eval: gpt-5.5 low guided.2 keyword-window.1 through Codex on all 173 cards.** The coordinator starts it; if the session's permission check blocks the long run, Evan runs the printed command.
5. **Package READMEs: yes**, M10 corrects stale facts in them; they stay package entry points.

## Related

* [Roadmap](roadmap.md)
* [Catalog expansion](../system/catalog-expansion.md)
* [Rewards engine](../system/rewards-engine.md)
* [User directives](user-directives.md)
