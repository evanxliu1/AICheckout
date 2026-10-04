# Pipeline v1 acceptance run: Wells Fargo refresh batch

Phase 8 milestone 6, run on 2026-10-04 from one chat request ("Expand Wells Fargo as a new batch") through the
`expand-catalog` skill and the `tools/catalog-pipeline` CLI. The batch is `wells-fargo-2026-10` on branch
`catalog-wells-fargo-2026-10`. It covers the six Wells Fargo cards already in `expansion.v1`, re-derived from new
dated captures in the batch's own folder. Every number below comes from the batch's committed files:
`pipeline/state.json`, `pipeline/eval.json`, `extraction-summary.json`, `verification/wells-fargo.json` and
`pipeline/proposed-catalog-build-report.md`. Timings and agent tokens come from the coordinator's run log.

**All accuracy numbers here are agreement between agents, not human-checked accuracy.** The batch's labels are
agent-verified, as are the frozen `expansion.v1` labels it is compared with.

## Outcome

- All 6 cards went through research, capture, extract, draft, verify, adjudicate, apply, overlay, build and eval.
  None was dropped or held out.
- The batch's catalog change is **not** in what ships. `CATALOG_V3` stays `2026-10-02.expansion.1`, the published
  release 2. The proposed build `2026-10-04.wells-fargo.1` is kept as `pipeline/proposed-catalog-build-report.md`.
- The refresh changes no rate, cap or category. Most of what it does change is a more consistent application of the
  frozen conventions, plus one label disagreement (below). Whether to publish it is Evan's decision.
- Publishing is blocked for now. The review app's bundled manifests do not know 5 of the batch's 11 source hashes
  (`pipeline handoff`), so publishing any pipeline batch first needs a product change.

## Run metrics

| Measure | Value |
| --- | --- |
| Wall clock, request to ready branch | 2026-10-04T17:10Z → about 21:15Z, roughly 4 h 05 min. About 2 h 50 min of it was a Codex service hang during extraction (below), and the session was suspended while the laptop was closed (about 19:15–20:45Z) |
| Items that needed Evan | 0. The researcher raised 2 questions (refresh Active Cash too? OneKeyCash as cash back?); the session resolved both from the request and the frozen conventions, since neither is a scope question |
| Usage-limit pauses | 0 |
| Restarts | Extraction: 3 full-batch or single-card rounds timed out (14 attempts in total); then 1 card, then 5 cards, succeeded after the service recovered. Capture: 2 rounds for the 4 flagged pages. No agent restart |
| Stalled agents | 0 during the run (the build milestones before it had several on the loaded machine) |

### Model time and tokens per card, by stage

Extraction is Codex (gpt-5.6-luna `xhigh`), and the minutes are the successful runs only. Agent stages are Claude Code
subagents, one packet for all 6 cards, so the per-card figures are the packet total divided by 6. Agent tokens are the
subagent's total as reported by Claude Code. Codex tokens are input/output.

| Stage | Model | Packet total | Per card |
| --- | --- | --- | --- |
| research | claude-opus-5-5 | 837 s, 35,808 tokens | 140 s, 5,968 tokens |
| extract | gpt-5.6-luna `xhigh` | 25.8 model-min, 52,531 in / 11,100 out | 4.3 min (3.4–5.4), 8,755 in / 1,850 out |
| verify | claude-opus-5-5 | 275 s, 124,905 tokens | 46 s, 20,818 tokens |
| adjudicate | claude-fable-5-1 | 206 s, 82,488 tokens | 34 s, 13,748 tokens |
| overlay | claude-opus-5-5 | 168 s, 75,242 tokens | 28 s, 12,540 tokens |
| capture, draft, apply, build, eval | none | about 12 min capture (2.5 s between pages); the rest seconds | — |

The failed extraction attempts used about 2.5 h of wall clock and no tokens.

## Defects caught by each deterministic gate

| Gate | Caught |
| --- | --- |
| capture | 4 sources (One Key and One Key+ terms and account agreement) returned an error page ("cannot process your request"), flagged `capture-flagged` twice, including with the browserless `request` hint. They were dropped; the batch keeps the same 11 sources `expansion.v1` used |
| extract | 14 timed-out attempts were recorded as failures. Nothing was drafted from them, and `next` routed the cards back to the session after 2 failed rounds |
| research, verify, adjudicate, overlay | 0 at accept. Each agent ran the dry-run accept itself, except the researcher (below) |
| quote and adjacency check | 0 (5, 6 and 9 committed files checked against 11 captures at draft, verify and apply) |
| label-evidence lint (at adjudicate and apply) | 0 findings raised, 0 acknowledgements |
| rule-ID continuity | 30 changed rules got new IDs (below) |

## Verification and adjudication

| Measure | Value |
| --- | --- |
| Verifier correction rate | 10.1% of draft rule field values (33/328); card fields 0/12. By field: activation 29/41, issuer wording 4/41; rate, paid-on-payment, cap, U.S.-only, limited time and category 0 |
| Rules | 41 drafted, 0 removed, 0 added, 41 verified; 10 drafted rules unchanged in every value |
| Exclusions and issues | 51 exclusions added; 11 issues added, 5 removed |
| Verdicts | 6 fixed, 0 confirmed, 0 dropped |
| Adjudication | 110 findings: 110 accepted, 0 modified, 0 rejected; no convention needed |

## Rule-ID continuity against the published catalog

The proposed build `2026-10-04.wells-fargo.1` compared with `2026-10-02.expansion.1` (820 rules each):
**790 kept, 30 changed (new `-v2` IDs), 0 added, 0 dropped.** All 30 changed rules are Wells Fargo rules, and none
changes rate, cap or category. The differences are activation 22 (unstated → `none`, general convention 7), source
IDs 22 (the refreshed source set), issuer wording 11, and U.S.-merchants-only 2. Catalog exclusions on the six cards
go from 47 to 82. Size: 603,543 bytes JSON (602,438 before). A wallet that recorded spend on one of the 30 rules
would lose that usage row on update, by design.

## Agreement with the frozen `expansion.v1` labels

An independent re-derivation: new captures, a new extraction, a new verifier and a new adjudicator, compared with
the frozen labels of the same six cards.

| Measure | Agreement |
| --- | --- |
| Rules | 41/41 matched (0 only in `expansion.v1`, 0 only in the batch) |
| Rate, paid on payment, cap, limited time | 41/41 each |
| U.S.-merchants-only | 39/41: the One Key and One Key+ Expedia/Hotels.com/Vrbo rule (`expansion.v1` true, a Phase 7 judgment call; the batch false) |
| Activation | 12/41: the batch applies general convention 7 (automatic enrollment → `none`) on the Autograph and Choice cards, where `expansion.v1` left it unstated |
| All rule fields | 215/246 (87.4%) |
| Card fields (currency, point value) | 12/12 |
| Exclusions / issues | 49 → 84 / 5 → 16 |
| Cards identical | 0/6 |

### Trace scores (for comparison with `docs/evals/expansion.md`)

| Run | End to end | Rule recall | Rule precision | Issue recall |
| --- | --- | --- | --- | --- |
| gpt-5.6-luna `xhigh` (the batch's own traces; an upper bound, since the labels were seeded from them) | 88.2% (217/246) | 100% | 100% | 31.3% |
| gpt-5.5 `low`, cross-model, one repeat (2026-10-04T21:05Z) | 78.9% | 90.2% | 100% | 6.3% |

## What the run exposed in v1

1. **The session loaded stale skill and agent definitions.** It had read them at start-up, before milestone 4
   merged: the first `card-researcher` had no Bash, so the coordinator ran its dry-run accept. Later agents followed
   the final files. A session should start after the definitions it uses are merged.
2. **There is no command to drop a source.** The four bot-walled pages were removed from `sources.json`,
   `manifest.json` and `cards.json` by hand, and their error-page captures were moved out of the batch.
3. **The builder does not refuse to rebuild a published version with other contents.** The first `run build` wrote
   the batch under `2026-10-02.expansion.1` and rewrote that version's ledger entry. The coordinator restored the
   ledger and bumped the version; `handoff` flags this case, but the build itself should refuse.
4. **`run build` changes what ships.** It registers the batch in the build config and rewrites `CATALOG_V3`. For a
   batch that is not to be published, the coordinator restored the shipping files and kept the proposed report.
5. **`next` lists one card per failed-gate queue item,** so a retry loop that follows `next` retries one card at a
   time.
6. **Codex service hangs look like timeouts.** gpt-5.6-luna calls with structured output hung at `turn.started` for
   about 3 h and then recovered with no change on our side. A one-case `eval:v2` smoke test told this apart from a
   configuration fault.
7. **Publishing a pipeline batch needs the review app to know its manifest** (`apps/review/src/manifest.ts`).

## Reproduce

`npm run pipeline -- status --batch wells-fargo-2026-10` and `npm run pipeline -- eval --batch wells-fargo-2026-10`
recompute everything except the trace re-score and the cross-model score, which need the gitignored captures and
traces in `/Users/evanliu/Projects/AICheckout-p8-wf` and `evals/curation/runs/batches/wells-fargo-2026-10/`. No model
is called by `eval`.
