---
type: Decision
title: "Phase 14.5 blind audit method: a captures-only auditor in blind packets, cant-tell as a label, deterministic comparison with cant-tell outside the denominators, a third-agent adjudication that counts 'neither' against the record, and a generated URL set"
description: Implementer choices of 2026-10-11 for the merchant database audit, taken within the plan's section 7. The auditor is a general-purpose Opus subagent reading `.claude/agents/merchant-auditor.md` (the agent type was not registered in the session); its packets hold only captured store pages, lookup and issuer excerpts and the issuers' definition windows, rebuilt by a script rather than a pipeline stage; `cant-tell` is a legal label and never a disagreement; a wrong bonus category counts whether the auditor refused the category or named another; a disagreement stands after adjudication unless the adjudicator sides with the record, and a missed bonus stands only when it sides with the auditor; the URL match test generates the release-host URLs from the bundled release and freezes the reader set's URLs and the traps in a small JSON file.
status: accepted
tags: [decision, phase-14, merchants, audit, evals]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T12:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (section 7, milestone 14.5)
  - resource: ../../docs/evals/merchant-db-v1.md
    title: Merchant database v1 report
  - resource: ../../.claude/agents/merchant-auditor.md
    title: merchant-auditor agent file
  - resource: ../../evals/merchants/db/audit/score.mjs
    title: The comparison (compareStore, standsAfter)
---

# Phase 14.5 blind audit method (2026-10-11)

## Context
Section 7 of the [plan](../product/phase-14-merchant-database.md) asks for a `merchant-auditor` subagent that labels every non-default record and the 60 frozen held-out domains blind, from the captures only, under the same evidence rule, with the labels written before any record is read; a deterministic comparison with exact Clopper–Pearson bounds; an adjudication of every disagreement by a third agent; and a URL match test set. The plan left the mechanics open.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Where the audit lives | A `pipeline merchants audit` stage with claimed packets and `state.json`; scripts under `evals/merchants/db/audit/` | **Scripts** (`build-packets.mjs`, `check-labels.mjs`, `score.mjs`, `build-url-set.mjs`): the audit runs once per release, needs no work-packet state, and the plan allows either |
| What a packet holds | The verifier's sheets (drafted quotes in context); the raw captures | **Raw captures only**: the store pages in full (8,000 characters each, at most three), lookup and issuer excerpts around the store's name (the batch's `*.windows.<domain>.txt`, or mined from the catalog captures for tier-A stores), and one shared `issuer-definitions.md` with the definition windows of the 12 fixed definition pages. Nothing from drafts, verification, records or `review.md`; the domain is the only identifier. One verified field does reach the packet as a search term: the record's display name (the research name the verifier confirmed, or tier A's homepage metadata) is the needle for the issuer and lookup excerpts around the store's name, never shown as a label |
| Population mapping | Records by host; by the batch apply reports | **Apply reports first** (domain → id), candidates as the fallback, so a record whose candidate host was dropped (clubwyndham-us) still maps. 230 stores: 46 bonus, 120 with brands, 15 processors, the 60 held-out, de-duplicated |
| Unknown facts | Force a value; allow `cant-tell` | **`cant-tell`** on any field, with `basis: null` for the category. A `cant-tell` is never a disagreement; it is counted and reported per field and set. The auditors were not told whether a store with no usable page should be `cant-tell` or `general-merchandise`/`default` on the category; they split (11 `cant-tell`, the rest `default`), which the report states |
| Wrong bonus category | Only a different bonus; also the auditor's refusal | **Both** (`different` and `unsupported`), since a record that asserts a bonus the evidence does not support is the costly error; a `cant-tell` on a bonus record would be reported separately (none occurred) |
| Brands, kind, goods denominators | All stores; only stores the auditor could label | The plan's denominators (brand records, processors, the 60); a `cant-tell` is outside the numerator and reported |
| Adjudication | Coordinator decides; a third subagent decides from both sides' quotes and the sheet | **A third subagent** (general-purpose Opus) reading the auditor's rules, both sides' quotes and the blind sheet, never the records, evidence files or pipeline reasoning; its verdict is `record`, `auditor` or `neither`. After adjudication a record error stands unless the verdict is `record`; a missed bonus stands only when the verdict is `auditor` |
| Auditor model and agent type | Register `merchant-auditor`; run general-purpose | The file is written as a registered agent type (`claude-opus-5-5`, no web tools); this session ran it as general-purpose subagents reading the file, like the 14.3 dry run; `runs.json` records each run's tokens and time as the Agent tool reported them |
| URL test set | One JSON with every URL; generated in the test | **Generated release-host URLs** in `extension/tests/merchant-url-set.test.ts` (6 subdomain forms × 6 paths per host, 23,328 URLs) with the reader set's 367 U.S. cart URLs and 33 traps frozen in `url-test-set.json` (73 KB; the full set would be 2.8 MB). The reference expectation is the longest authored host that is a label-boundary suffix sharing the URL's registrable domain |
| Fixes | Fix before reporting; after | **After**: the pre-fix numbers are committed first (plan section 7), then the release changes in a separate commit with a new version |

## Decision
As chosen; implemented in `evals/merchants/db/audit/` and `.claude/agents/merchant-auditor.md`; the report is [`docs/evals/merchant-db-v1.md`](../../docs/evals/merchant-db-v1.md).

## Consequences
- Blindness rests on the agent file's rules and the labels gate (`filesRead` may name no record, evidence, draft, verification, review or release file; another packet's files are refused), not on a sandbox; the report says so.
- The packets are gitignored (`evals/merchants/db/audit/packets/`); the labels, comparison, adjudication, population, runs and URL set are committed, every quote 25 words or fewer (the gate checks).
- The same scripts re-run for a later release: `build-packets.mjs`, the auditor runs, `score.mjs`, the adjudicator, `score.mjs` again.

## Status
Accepted 2026-10-11 (implementer, within the plan's section 7).
