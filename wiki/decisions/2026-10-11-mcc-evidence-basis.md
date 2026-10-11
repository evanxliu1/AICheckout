---
type: Decision
title: "Merchant evidence: a fourth basis, `mcc`, from openly licensed public card-transaction datasets"
description: Evan's 2026-10-11 call ("fix the big names, i think we should use MCC codes … that is enough evidence") after the 14.5 audit left Kroger, Whole Foods, Starbucks, Netflix, Best Buy and most other well-known chains at the general rate. A record may rest on `evidence.basis: 'mcc'` when government purchase-card datasets published under CC0 or CC BY code the store, by its merchant descriptor, under a merchant category code that the Visa Merchant Data Standards Manual maps to a catalog category, with at least 10 matched rows and one category holding at least 80% of them. Precedence issuer > mcc > corroborated > definition > default; the coordinator's safeguards; the Oklahoma attribution notice; the Fiserv citations replaced.
status: accepted
tags: [decision, phase-14, merchants, evidence, mcc, licensing]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T22:30:00Z
sources:
  - resource: 2026-10-10-merchant-database-evidence.md
    title: Decision, merchant database scope and evidence
  - resource: 2026-10-11-definition-evidence-basis.md
    title: Decision, the definition basis (the third basis)
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 2, 3, 6)
  - resource: ../system/merchant-pipeline.md
    title: Merchant pipeline (the mcc stage)
  - resource: ../../tools/catalog-pipeline/src/merchants/mcc.ts
    title: runMcc, decide, descriptorFor, pageVeto
  - resource: ../../evals/merchants/db/mcc/manifest.json
    title: Dataset manifest (URLs, licences, hashes, rows)
  - resource: ../../evals/merchants/db/mcc/codes.json
    title: Code map (Visa manual titles → catalog categories)
  - resource: ../../evals/merchants/db/mcc/descriptors.json
    title: Per-store descriptor rules
---

# Merchant evidence: the `mcc` basis (2026-10-11)

## Context
After the 14.5 blind audit, release `2026-10-11.audit.2` had 50 bonus categories among 640 records, and the best-known chains were at the general rate: their store pages are bot walls or marketing copy that the `definition` rule cannot read as a business type, no issuer names them as earning, and public merchant-code lookups are forum threads or forbid citation. Evan, 2026-10-11, in chat: "fix the big names, i think we should use MCC codes … that is enough evidence". A merchant category code is exactly what issuers bonus on, so a store's observed code is the most direct public evidence of its category.

Research the same day (scratchpad, not committed) found no public U.S. merchant → MCC lookup usable under the project's rules (Visa's and Mastercard's APIs need accounts, HeyMax needs registration, crowdsourced sites are non-U.S., forums are refused), but it found **openly licensed per-transaction government purchase-card datasets** that carry the merchant descriptor and the Visa MCC description: Open Data DC (CC0), Oklahoma OMES FY2022–FY2024 (CC BY) and GSA SmartPay (CC0). Indiana's portal (personal, news, nonprofit or academic use only) and Delaware (a public-domain label only in Socrata metadata, no clause in the terms) were excluded on licence doubt; Oklahoma FY2025–FY2026 show no licence. Without Delaware, DC and Oklahoma alone still give 10 or more rows for 22 of the 25 big names.

## Options considered
| Question | Options | Chosen (coordinator rules, 2026-10-11, within Evan's call) |
| --- | --- | --- |
| Sources | Every dataset found; only the openly licensed ones | DC (CC0), Oklahoma FY2022–FY2024 (CC BY, attribution required), GSA (CC0). Delaware and Indiana excluded; Oklahoma FY2025–26 excluded. Downloaded locally and gitignored under `evals/merchants/db/mcc-data/`; a committed manifest records URL, publisher, licence with a quote of 25 words or fewer, fetch date, SHA-256 and row count per file. Rows are never committed |
| Matching a store to rows | Model judgement; a committed per-store descriptor rule | A committed, reviewable rule: the record's name as a word-boundary pattern (tokens in order, punctuation optional), with per-store overrides (`patterns`), explicit `excludes` for known collisions (Domino's car washes, Nordstrom cafés, Uber Eats inside Uber), a coordinator `veto` and a `skip`. Evidence-matching data of the eval pipeline, not a store config in the extension |
| Codes | The datasets' descriptions as they are; map to numeric codes | Descriptions are mapped to numeric codes through the **Visa Merchant Data Standards Manual** (April 2026, "VISA PUBLIC") and the codes to catalog categories: 5411 supermarkets; 5300 wholesale clubs; 5912 drugstores; 5812/5813/5814 dining; 5732/5734 electronics; 5311 department stores; 5200/5211/5251 home improvement; 4899 streaming per Visa's streaming guidance; 7832/7922/7929/7941/7991/7996/7998 entertainment; 4111/4112/4121/4131/4784/7523 transit; 5541/5542 gas; 5552 EV charging. The Fiserv code table cited by 15 seed stores is replaced everywhere (its terms forbid deep links) |
| Grant rule | Any row; a majority; a high bar | At least 10 matched rows and the dominant category at 80% or more of them; fuel rows of a separate code (5541, 5542, 5983) are set aside before computing, not counted as conflicts, unless fuel is itself the store's dominant category; minority codes are listed as conflicts in `review.md` |
| Safeguards | None beyond the bar | The superstore/discount/warehouse guard still applies to supermarkets and drugstores (the store's own captured pages may veto; Walmart and Target never get supermarkets from the data: their rows split between discount stores and grocery); the store's own pages or the coordinator may veto (eBay's department-store code is the marketplace platform's); U.S. chain only; a marketplace gets dining only, a processor nothing; the data channel (in-person and card-not-present government purchasing) is disclosed in `review.md`, the pipeline page and the report |
| Precedence | mcc strongest; issuer strongest | `issuer` > `mcc` > `corroborated` > `definition` > `default`. An `issuer` record keeps its basis (the run notes whether the data agrees); a `definition` record whose category the data confirms moves to `mcc` |
| Extension wording | Name the datasets; a generic phrase | "Codes as a supermarket (public card-transaction data)." |
| Schema | A field on the record; a basis | `mcc` in `MERCHANT_EVIDENCE_BASES`, `mcc-dataset` in `MERCHANT_SOURCE_KINDS`; an `mcc` record cites at least one `mcc-dataset` source and sits on a marketplace only for `dining`; Zod, parity cases and a **new** migration replacing `valid_merchant_release_v1` (`20261011220614_merchant_release_mcc_basis`), pgTAP cases |
| Scope | The 25 big names; every record | Every record in the release, deterministically (`pipeline merchants mcc`), then a new release version and a blind audit of every record whose category changed |

## Decision
A record's category may rest on `evidence.basis: 'mcc'` when, over the openly licensed datasets in `evals/merchants/db/mcc/manifest.json`:
1. the rows whose merchant descriptor matches the store's committed descriptor rule (`evals/merchants/db/mcc/descriptors.json`; by default the record's name on word boundaries) number at least 10 after fuel rows of a separate code are set aside;
2. one catalog category, reached through `evals/merchants/db/mcc/codes.json` (description → Visa code → category), holds at least 80% of those rows and is a bonus category;
3. the store is not a processor, is a marketplace only for `dining`, is not vetoed by its own captured pages (supermarkets and drugstores: superstore, discount store, warehouse club and the like, `CATEGORY_EXCLUDED_TYPES`) or by the coordinator;
4. no `issuer` evidence already decides the record.

The record cites the dataset sources that contributed rows (kind `mcc-dataset`, the manifest's fetch date and hash); its evidence file holds one descriptor-and-description quote per dataset; minority codes and cross-issuer conflicts (`issuerConflicts` over the store's mined issuer windows) go to the MCC evidence section of `review.md`.

Implemented deterministically in `runMcc` ([mcc.ts](../../tools/catalog-pipeline/src/merchants/mcc.ts)): `derivePattern`/`descriptorFor` (the rule), `candidates` (anchor-prefix routing so "LOWES 1234" reaches "LOWE ?S"), `decide` (the grant rule, pure), `pageVeto` (the guard), the dataset readers (streaming CSV; a minimal .xlsx reader for GSA), the manifest check (hashes and row counts are verified on every run and written on the first). Datasets 2026-10-11: DC 639,306 rows; Oklahoma FY2022 382,724, FY2023 408,063, FY2024 421,889 (36 monthly files, each a distinct month; the Oracle `ROWID` column repeats across months and is not a key); GSA Q3 2020 6,913.

## Consequences
- Release `2026-10-11.mcc.1` (then `mcc.2` with the re-audit's one adjudicated fix, doordash-us `physicalGoods` false): 640 records, 91 bonus categories (`mcc` 64, `definition` 14, `issuer` 13), up from 50; the 25 big names: 18 now carry a category (Kroger, Whole Foods, Aldi, Safeway, Publix, Starbucks, Chipotle, Domino's, Panera, Pizza Hut, DoorDash, Uber Eats, Grubhub, Netflix, Best Buy, Newegg, Sam's Club, Nordstrom), Walgreens keeps `issuer`; Costco stays at the default (wholesale-club rows are 76% of its usable rows: costco.com orders code as general merchandise in 20 rows against 22 wholesale-club rows); Peacock (0 rows in DC and Oklahoma) and Paramount+ (2) have too few rows; H-E-B, Food Lion and McDonald's have no record (held out in 14.4 on disputed hosts) and Rite Aid is defunct.
- 23 `definition` records moved to `mcc` with the same category (the data confirmed every one); no granted category contradicted an existing one.
- Refused by the rule, for Evan: eBay vetoed (its 2,170 department-store rows are the platform's code; eBay is a marketplace by its own pages); Instacart, Uber and Ticketmaster are marketplaces outside dining (Uber codes 100% taxicabs); Target 63% discount stores vs grocery; Walmart discount stores; Apple, Coach, Regal, Six Flags, Topgolf and Discovery+ under 80%.
- `review.md` gains "MCC evidence: public card-transaction datasets, for Evan" (every store with 10+ rows: rows, dominant category, share, minority codes and issuer conflicts, outcome); `results.json` holds the per-store tallies.
- The extension's evidence line reads "Codes as … (public card-transaction data)."; Best Buy and Newegg are `electronics` again, on evidence this time.
- **Attribution (CC BY):** the project uses the Purchase Card (PCard) FY2022–FY2024 datasets of the State of Oklahoma Office of Management and Enterprise Services, published on data.ok.gov under Creative Commons Attribution; the notice is in [`evals/merchants/db/mcc/NOTICE.md`](../../evals/merchants/db/mcc/NOTICE.md), the pipeline page and the report, and Phase 15 carries it into the listing and site credits.
- The 15 Fiserv lookup citations (airlines and hotel brands in batches b01, b05, b06, b07, b09, b11) were replaced in `research.json`, `sources.json` and `manifest.json` by the Visa manual (same brands in its airline and lodging code tables; the PDF's hash and length; the extracted text as the gitignored capture); `refusedLookup` refuses `fiserv.dev` at research, apply and build. The verify packets' recorded input hashes predate the replacement.
- The blind audit (14.5 method) re-ran on the 64 changed records with an `mcc-evidence` section in each sheet and the `mcc` rule in the auditor's brief; results in [the report's addendum](../../docs/evals/merchant-db-v1.md#addendum-the-mcc-basis-2026-10-11).
- Limits, disclosed: government purchasing is in-person and card-not-present, not consumer online checkout (costco.com is the one observed divergence); the Oklahoma descriptions are truncated at 40 characters; the DC file is refreshed monthly, so its hash dates the fetch; descriptor rules can collide on common names (the review table and the audit are the check).

## Status
Accepted 2026-10-11 (Evan's call; the coordinator's rules 1–6 as written in the handoff). Supplements the [2026-10-10 evidence decision](2026-10-10-merchant-database-evidence.md) and the [definition basis](2026-10-11-definition-evidence-basis.md).
