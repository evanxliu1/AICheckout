---
type: System Component
title: Card pipeline internals
description: Reference for the card-expansion pipeline's mechanics — the text-free batch state record, input hashing and invalidation, claimed work packets, deterministic gates and the label-evidence lint, the derived queue, the multi-batch catalog builder with rule-ID continuity, resumability, freshness and the deferred NX-multiple validator.
status: stable
tags: [system, catalog, curation, expansion, pipeline, phase-8]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:47:59Z
stale_after: 2026-11-15T00:00:00Z
sources:
  - resource: ../../tools/catalog-pipeline/src/state.ts
    title: Batch state schema
  - resource: ../../tools/catalog-pipeline/src/label-lint.ts
    title: Label-evidence lint
  - resource: ../../scripts/lib/catalog-batches.mjs
    title: Multi-batch catalog builder
  - resource: ../../evals/curation/catalog-batches.json
    title: Build config
  - resource: ../../evals/curation/rule-id-ledger.json
    title: Rule-ID ledger
---

# Card pipeline internals

How the [card-expansion pipeline](card-expansion-pipeline.md) keeps state, decides what is stale, hands work to agents, gates their output and builds one catalog from many batches. The commands that expose this are on [card pipeline CLI commands](card-pipeline-commands.md).

## Batch state record

One JSON file per batch, `pipeline/state.json`, committed. It holds **no issuer text and no model text**: only IDs, hashes, versions, statuses, counts and timestamps. Zod schema in `tools/catalog-pipeline/src/state.ts`.

```json
{
  "schemaVersion": 1,
  "batch": "wells-fargo-2026-10",
  "cards": {
    "wells-fargo-autograph": {
      "stages": {
        "capture": { "status": "done", "stageVersion": "capture.1", "inputHash": "sha256:…", "outputs": [{ "ref": "manifest:wells-fargo-autograph-product", "sha256": "…" }], "finishedAt": "2026-10-05T10:00:09Z", "attempts": 1, "metrics": { "sources": 3, "flags": 0 } },
        "extract": { "status": "paused", "stageVersion": "extract.1", "inputHash": "sha256:…", "pausedUntil": "2026-10-05T11:15:00Z", "reason": "usage-limit" },
        "freshness": { "status": "pending" }
      },
      "dropped": null,
      "heldOut": null
    }
  },
  "issuers": {
    "wells-fargo": { "stages": { "verify": { "status": "done", "packetId": "…", "agentRun": "…", "model": "claude-opus-5-5", "acceptedAt": "…" } } }
  }
}
```

| Stage status | Meaning | Next |
| --- | --- | --- |
| `pending` | Never run, or upstream is not `done` | Runs when upstream is done |
| `done` | Output recorded and gate passed | Skipped while `inputHash` still matches |
| `stale` | Recorded `inputHash` differs from the one computed now | Re-runs; every downstream stage becomes `stale` too |
| `failed-gate` | Ran, but its gate failed | Re-runs after the cause is fixed |
| `paused` | Usage limit; `pausedUntil` set | Resumes after the time passes |
| `inputs-missing` | A gitignored input (capture, trace) is not on this machine | Run in the checkout that has the captures |
| `dropped` | The card left the batch (adjudicated `drop-card`, out of scope); `dropped` gives the reason code | Never runs again in this batch |

There is no `running` status and no PID lock: a CLI stage writes outputs, then state, so an interrupted run simply re-runs. Agent work is tracked by packets.

## Input hashing and invalidation

Every stage's **input hash** is `sha256(canonicalJson({ stage, stageVersion, config, inputs }))`, using the harness's `canonicalJson`. `inputs` is the sorted list of `{ ref, sha256 }` of everything the stage reads for this card; `stageVersion` is a string declared in the stage module and bumped by hand when its output changes; `config` is the stage's options.

| Stage | Inputs hashed |
| --- | --- |
| research | the batch request (issuer, card names) and the researcher agent file's hash (the research file is the output, not an input) |
| capture | the card's source entries (URL, kind) and capture hints; outputs are each capture's SHA-256 |
| extract | the manifest SHA-256 of each document read; provider, model, effort, prompt, selection, output-token mode and limits (`extract-cards.mjs`'s `sameConfiguration`, plus limits) |
| draft | trace hash, capture hashes, research hash, draft script version. The output hash is split: a **labels hash** (the case without anchors and quotes) and an **anchors hash** |
| verify | the card's draft **labels** hash, product-note hash, verifier brief version. Verify runs per issuer, but its input hash is kept per card (in the card's stage record); a verify packet lists only the issuer's cards that are pending or stale, and the findings file is merged, so one stale card does not re-verify the issuer |
| adjudicate | the card's findings hash, `conventions/general.md` and the issuer conventions hash |
| apply | draft case hash and adjudicated findings hash |
| overlay | corpus case **labels** hash (as for verify), overlay conventions hash, program table hash. After an anchor-only change the CLI re-stamps `corpusCaseSha256` mechanically once the quote check passes, so no new overlay packet is needed |
| build, eval | every card's apply and overlay output hashes, merchants, programs, previous catalog |

**Invalidation rules.**

1. A stage is `stale` when its computed input hash differs from the recorded one. Staleness propagates down, never up.
2. An absent gitignored input makes the stage `inputs-missing`, not `stale`.
3. **Anchor-only change.** When a re-draft changes only the anchors hash (labels hash equal), verify, adjudicate and overlay stay `done`; the CLI rebases the findings' `current` anchors mechanically onto the new draft, re-runs apply (a CLI stage), the quote check and the `current` check (`apply --check`), and re-stamps the overlay pairing hash. Any labels-hash change makes verify stale.
4. **Convention change** re-adjudicates, not re-verifies: a change to `general.md` or an issuer conventions file changes the adjudicate input hash of the cards it covers (issuer-wide or batch-wide by file).
5. Frozen inputs are never rewritten to clear staleness: no capture is overwritten, no released corpus, prompt or validator version is edited.

## Work packets: `claim` and `accept`

Agent stages run through claimed work packets, which fix the Phase 7 coordination failures (duplicate launches, lost reports, shared-scratchpad collisions, files lost from agent worktrees).

- `pipeline claim <stage> --issuer <slug>` writes `pipeline/packets/<stage>.<issuer>.<n>.json`: batch, issuer, card IDs, absolute input paths, **one absolute output path** and a random `packetId`. It refuses a second open claim on the same stage and issuer; `--release` abandons a claim.
- The agent writes only the output file, which must carry `packetId`, `batch` and `issuer`. Its chat reply is a pointer, never the result.
- `pipeline accept <stage> --issuer <slug> [--model <id>] [--dry-run]` reads the file, rejects anything outside the open packet, runs the stage's gates, records `model`, `packetId` and `acceptedAt` in state, and closes the packet. `accept` also takes `--agent-run <id>` (the subagent run ID the session got when it started the agent) and records it; `accept adjudicate` refuses when that run ID equals the one recorded for the issuer's verify, and when the adjudicate packet was claimed before verify was accepted. The adjudicator is always a different run.
- `pipeline status` lists open packets as output present, absent, or present but not accepted.
- Pipeline subagents run in the checkout that holds the captures, **never with worktree isolation**, and never write under a scratchpad.

## Gates

A stage is `done` only when its gate passes. Gates are deterministic; their errors print paths and field names only, never issuer text.

| Stage | Gate |
| --- | --- |
| research | Strict Zod schema: card IDs `<issuer-slug>-<card-slug>`, URLs on the issuer's domain allow-list in `batch.json`, enum source kinds and groups, `notes` ≤ 300 characters, no numeric rate fields; every card has at least one issuer-domain source; no card already in a released corpus unless the batch is a refresh (`batch.json` says so); no research value is copied into a label field |
| capture | Manifest hash equals the file; no bot-wall, error-page or short-page flag; body ≤ the source limit; an existing capture with another hash is never overwritten |
| extract | Trace status is not `timeout`, `provider_error`, `refusal` or a schema failure; the configuration equals the batch's |
| draft | Quote and adjacency check (no quote over 25 words, no adjacent run over 25 words); the case parses as corpus v2 |
| verify | Findings parse; every quote verbatim in the named capture and ≤ 25 words; `current` values match the draft; `filesRead` names the card's captures; provenance `agent-verified`; output carries the packet ID |
| adjudicate | Every finding and `drop-card` verdict decided; adjudicator run ≠ verifier run; `apply --check` passes; **label-evidence lint** on the cases apply will write (acks counted apart) |
| apply | Corpus parses; quote check on all written files; **label-evidence lint** |
| overlay | `checkOverlay` coverage; quote check; **label-evidence lint** |
| build | Multi-batch builder rules (below); Zod; size ≤ 75% of the byte limit |
| eval | Every number reproduces from saved traces or committed files; `eval:v2 --check` unchanged |

### Label-evidence lint (deterministic)

Run at adjudicate accept (checks a–c, on the corpus cases apply will write), apply (backstop) and overlay accept, over each rule and its anchors:

- every `cap.amountCents` appears as a dollar figure in one of its anchors, digit-exact (catches $5,000 vs $50,000);
- `rateBps` equals a percent stated in an anchor, or for points a multiple (`4X`, `1.5x`, `N points per $1`; multiple × 100);
- every `limitedTime.endsOn` date appears in an anchor (any common written form of that date);
- a dateless `limitedTime` needs an overlay gate (`requires`);
- a store-credit program's `unitName` is cents, and `programDetails` agree with `programs`.

Recognised forms are in [`label-lint.ts`](../../tools/catalog-pipeline/src/label-lint.ts), including `$1.5k` for a cap and `2 points/$1` for a multiple.

**Acknowledgements.** The lint reads numbers, not sentences, so a correct label can raise a finding. Such a finding is acknowledged by an agent, never by the session or the CLI:

- The **adjudicator** lists them in its findings file, top-level `labelLintAcks: [{ cardId, ruleIndex, check, reason }]` (corpus rules, checks a–c). `accept adjudicate` refuses an ack whose check or reason is not in the enums, or that names no finding the lint raises on the corpus case apply will write; `accept` records the hash of the acks as the output `lint-acks:<issuer>`. An ack added or changed later (by the session, say) no longer matches that hash and fails apply and overlay. The card's acks are part of apply's input hash.
- The **overlay author** may acknowledge overlay findings the adjudicator did not in its fragment, `labelLintAcks: [{ cardId, ruleIndex | addedRule, check, reason }]`, but never on a value its own fragment sets: a rate, cap or end date of an added rule, or a patched rule's `set.cap` or `set.limitedTime` (`selfCertifiedAcks`; only a dateless limited-time finding may be acked there). A store-program finding names no card and is always fixed.
- An ack is a classification, not evidence: it asserts that the acknowledging agent read the number in the capture and the lint could not. A wrong number can pass only if that independent agent acks it; the agent files say so (milestone 4: never ack to make a gate pass; a wrong number is fixed through a finding or the fragment).
- `reason` is one of `anchor-truncated`, `reversed-phrasing`, `split-anchors`, `points-wording-cash-label`, `date-outside-anchor`, `relationship-bonus`. Acks are codes only; no text.
- Every ack must name a finding the lint raises; a stale, duplicate or unused ack fails the gate (an adjudicator ack that the overlay no longer needs, because a patch supplied the evidence, is not an error at overlay).
- The apply and overlay gates pass acknowledged findings and count them separately: per check, `lint<Check>Raised` and `lint<Check>Acked` in state `metrics` (the apply card record, the overlay issuer record). `lint-labels` reports raised, acked and open.

**Baseline** on the frozen `expansion.v1` (173 corpus cards, `npm run pipeline -- lint-labels`, 2026-10-04): apply gate 39 raised, 0 acked, 39 open (cap-amount 0, rate 30, end-date 9); overlay gate 39 raised, 0 acked, 39 open (cap-amount 0, rate 29, end-date 9, dateless-limited-time 0, store-program 1). An independent review on 2026-10-04 judged all 39 correct numbers the lint cannot read, 0 true positives (agent-verified): truncated anchors, reversed phrasing ("per $1 …: 2 points at"), values split across anchors, store cards labelled cash back whose evidence says points per $1, rotating quarters whose 25-word anchors stop before the end date, relationship bonuses, and `tjx-rewards-certificates` (unit not cents). `expansion.v1` stays untouched and report-only: it has no acks.

## Derived queue

There is no queue file. `pipeline status` derives the open items from state and packets, each text-free `{ batch, cardId | issuer, stage, code, ref, owner }`; `pipeline next --json` returns the first actionable one.

| Code | Owner | Resolution |
| --- | --- | --- |
| `capture-flagged` | session | Add a capture hint and re-run capture for that source, or drop the source; never edit a capture |
| `gate-failed` (a stage in status `failed-gate`) | the agent that wrote the file, or the session for CLI stages | Fix the file (errors name paths and fields) and accept again |
| `needs-reverify` | verifier | A rejected `drop-card` or an adjudicator request; a new verify packet |
| `convention-needed` | session (coordinator) | Add a dated convention in the batch's `verification/conventions/`, then re-adjudicate |
| `scope-question` | **Evan** | Answer in chat; the session records it in `batch.json` |
| `publish` | **Evan** | Approve with `publish <version>` in chat (the coordinator runs `pipeline publish --confirm`), or publish in the review app |

`pipeline next --json` kinds: `cli` (run the printed command), `agent` (claim the printed packet, start the named subagent, then `accept`), `queue` (resolve a session-owned item; ask Evan only for `scope-question`), `wait` (usage-limit pause), `handoff`.

## Multi-batch catalog builder

**Built in Phase 8 milestone 1** (branch `phase8-m1-multibatch-builder`, 2026-10-04; [decision](../decisions/2026-10-04-multi-batch-catalog-builder.md)). [`scripts/lib/catalog-batches.mjs`](../../scripts/lib/catalog-batches.mjs) loads the layers listed in the committed, Zod-checked build config [`evals/curation/catalog-batches.json`](../../evals/curation/catalog-batches.json) and merges them into the inputs [`scripts/lib/catalog-v3.mjs`](../../scripts/lib/catalog-v3.mjs) already builds from; `npm run catalog:v3` writes the catalog, the build report and the rule-ID ledger, and `catalog:v3:check` (CI) compares all three. At milestone 1, rebuilding the inputs of that day reproduced `CATALOG_V3` `2026-10-02.expansion.1` byte for byte (SHA-256 `5e095b7b…33ac` before and after); the build report only gained two sections at its end.

- **Config.** The catalog version label, the frozen program table (`expansion/reward-programs.json`) and `merchants.json`, and the layers in order: the base layer, `expansion.v1` (`evals/curation/expansion`, read-only) then `real.v2.2` (`evals/curation/real`, no overlay) — expansion first keeps the card order of release 2; they share no card — then pipeline batches as `{ "kind": "batch", "id": "<batch>" }`. A batch directory provides `corpus.json`, `catalog-overlay.json`, `product-notes.verified.json`, `manifest.json`, `cards.json` and optionally `reward-programs.json` (card mappings to existing programs only). Dropped cards carry their reason in the config (the frozen layer's seven, formerly `DROPPED_REASONS` in the build script); `loadLayer(root, layer, { dropped })` is the hook for milestone 2's `state.json` dispositions. A batch entry may also carry `exclusionOmissions` (card → starts of corpus exclusions the catalog leaves out because, listed with the card's other exclusions, they would repeat more than 25 consecutive capture words; general rule 22), the batch counterpart of `QUOTE_LIMIT_OMISSIONS`, which since Phase 9 applies only to cards still on the frozen base layer. The coordinator sets them from the quote check over the built catalog, choosing the fewest exclusions that clear every run and, among those, the ones least relevant to a retail purchase (non-purchase items such as advances, fees or balance transfers before purchase exclusions); the corpus keeps them and the build report lists them. A key for a card the batch does not supply fails the build.

1. **Newest batch wins per card.** A later layer's corpus case, overlay entry, program mapping and product notes replace the earlier ones; the card keeps its position and new cards append at the end. A later drop removes the card (listed with its reason). The real cards cannot be dropped; since Phase 9 milestone 3 a pipeline batch (not a base layer) may replace one, and only the others stay checked by `checkRealCards` (see [card pipeline CLI commands](card-pipeline-commands.md#built-so-far)). Gates, store programs and brands that only replaced cards used are pruned; a batch may add gates, store programs and `programDetails`, but redefining an ID with other content fails.
2. **Pairing.** A pipeline batch's overlay entry carries `corpusCaseSha256`, the SHA-256 of that card's corpus case in the same batch in canonical JSON (`stableJson`, sorted keys); a missing or different value fails. The field is optional in the overlay schema: the frozen `expansion.v1` predates it and is paired by directory. CI needs no capture for any of this.
3. **Dates** come from the manifests: `verifiedAt` is the newest `checkedOn ?? capturedOn` of the issuer sources the catalog cites (merchant MCC sources excluded) and `expiresAt` is 30 days later (the contract maximum): `2026-10-02T00:00:00Z` / `2026-11-01T00:00:00Z` at milestone 1, `2026-10-05T00:00:00Z` / `2026-11-04T00:00:00Z` for `2026-10-05.renewal.1`. The build report states the oldest issuer source date (2026-09-29 at milestone 1, the real cards; 2026-10-02 for the renewal). Since Phase 9 milestone 3 a freshness record that found the capture unchanged moves the source's date, and the catalog's, forward, and the builder refuses a cited source outside the 30-day window by name. The `CATALOG_V3_VERIFIED_AT`/`EXPIRES_AT`/`VERSION` constants are gone; the overlay check's draft is dated from the manifests too.
4. **Completeness.** The build refuses unless every card of every layer's `cards.json` is in that layer's corpus (where the overlay includes it or holds it out with a reason) or dropped with a reason, and every corpus card is in `cards.json`.
5. **Rule-ID continuity gate** against [`evals/curation/rule-id-ledger.json`](../../evals/curation/rule-id-ledger.json), an append-only ledger of every rule ID ever issued (card, SHA-256 of the rule's terms — the rule without `id` in `stableJson` form, as `ruleTerms` in `wallet.ts` — and first version) and the rule IDs and JSON bytes of each catalog version, seeded from `2026-10-02.expansion.1` (identical to hosted release 2). Previous = the newest ledger catalog with another version. A rule whose card had a rule with the same terms keeps that ID; any other rule takes its generated ID unless the ledger issued it for other terms or another card, then `<id>-v2`, `-v3`, …; an ID is never reissued with other terms. The build report lists kept, changed (old → new), added and dropped IDs and the catalog bytes. This protects wallets: `reconcileWallet` drops usage rows when a rule's terms change. The ledger should be committed with the **final** build of a version: each `catalog:v3` run reserves the IDs it issues, so draft rebuilds on a branch that change a rule's terms burn `-vN` suffixes. "Changed" is matched by card and ID stem (without `-vN` or a one-digit collision counter).

Tests: `scripts/lib/catalog-batches.test.mjs` (synthetic batches on the committed base layer, no captures) and `scripts/lib/catalog-v3.test.mjs`.

## Resumability and usage limits

- `pipeline run <stage>` skips cards whose stage is `done` with a matching input hash. Writes go to a temporary file renamed into place; state is written after outputs.
- A Codex usage limit (harness exit 3) marks the card `paused` with `pausedUntil`; `--wait-minutes N` sleeps and resumes; otherwise the CLI exits 3 and a re-run resumes.
- A Claude usage limit stops the session; nothing is lost, because outputs are recorded only by `accept` and `status` lists open packets.
- Concurrency (Evan, 2026-10-01: more concurrency over protecting limits): extract up to 8; capture sequential per host with 2.5 s delay, hosts in parallel; one verifier and one adjudicator per issuer at a time.

## Freshness

Built in Phase 9 milestone 3 ([plan](../product/phase-9-freshness.md), commands in [card pipeline CLI commands](card-pipeline-commands.md#built-so-far)), from Stage 2 decision 1 ([plan](../product/phase-7-stage-2.md#decisions-on-the-plans-open-questions)). Freshness is a catalog-wide command, not a per-card stage: `pipeline freshness` re-renders every cited source to a temporary directory, compares SHA-256 and writes a committed, text-free record per day (`evals/curation/freshness/<date>.json`) with the renderer versions and counts per result, which measure the false-change rate before any capture normalizer is considered (review change 5). Unchanged pages get the record's date as their effective `checkedOn` in the builder and the review app; changed pages turn into new dated captures in a seeded refresh batch per issuer (`init --refresh-from-freshness`); flagged and unreachable ones get no date and age out unless the session resolves them. The per-card `freshness` stage slot in `state.json` stays unused (always `pending`). The tie-breaker for anchor resolution (review change 5) is not built. The first full run was milestone 4 (2026-10-05, [results](../../docs/evals/freshness-2026-10.md)); its catalog `2026-10-05.renewal.1` is hosted release 3 and expires 2026-11-04T00:00Z.

## Deferred: `rate_not_in_evidence` for "NX" multiples

`validateExtractionV2` accepts a `rateBps` only if a cited quote states it as a percent, so points cards stating "4X points" are flagged (408 findings on 98 of 180 expansion extractions). The planned fix is a new validator version `v2-validator.2` with a `multiplesIn` helper beside `percentsIn` (used only when the reward currency is points), registered by version and recorded as a top-level trace field (not in `context.versions`, which the replay hash covers), with `v2-validator.1` byte-identical and the default of `eval:v2`. Deferred out of v1 with the `validate` stage; the label-evidence lint above covers the same gap for committed labels.

## Related

* [Card-expansion pipeline](card-expansion-pipeline.md)
* [Card pipeline CLI commands](card-pipeline-commands.md)
* [Catalog expansion (Phase 7)](catalog-expansion.md)
* [Phase 9 plan](../product/phase-9-freshness.md)
