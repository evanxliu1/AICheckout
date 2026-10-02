---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
---

# Now

As of 2026-10-02T23:59Z.

## Current state

- **`origin/main`** at `4277f48` (PR #18, the Stage 2 plan, merged; PR #17, Phase 7 verification and the agent-verified corpus `expansion.v1`, merged; PR #16, capture, extraction and drafts, before it; PR #15, this wiki). Merged: PRs #4–#6 (Phase 2a–2c), #7–#12 (Phase 3 M1–M6 prep), #13 (3b automatic cart badge) and #14 (3b follow-ups: a removed badge host comes back at once, covered-click hint in a persistent status region, reader resumes after a back/forward-cache restore, README) ([roadmap](product/roadmap.md), [cart badge](system/cart-badge.md)).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). All 8 migrations are on hosted Supabase; the coordinating session pushed `20260930225732_catalog_v2` and `20261001010350_source_body_limit` with `./scripts/db-push.sh` ([database migrations](ops/database-migrations.md)). `/v1/catalog` serves release sequence 1, the 7-card catalog `2026-09-29.real.1`, published 2026-10-02T02:29Z, expiring 2026-10-29T00:00Z (checked 2026-10-02T05:58Z).
- **Curation model:** gpt-5.6-luna `xhigh` since 2026-10-02 ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)). It is the `eval:v2 --provider codex` and `extract-cards.mjs` default on `main` since PR #16, and [`docs/evals/results.md`](../docs/evals/results.md) has its rows: dev 99.5%, held-out 98.3%, both marked added after ([reporting decision](decisions/2026-10-02-luna-results-per-split.md)).

## Active work

- **Stage 2 M2 engine v3** on branch `s2-m2-engine-v3` (from `760af20`, not pushed): `compareV3` with value precedence, BigInt money, brand scope, closed-loop `notAccepted`, choices, gates, payment paths incl. Venmo, rotating dates, shared caps; card `choices`, wallet `gates` and `valueOverrides`; `usageInputs` for v3; 88 engine tests; v1/v2 results byte-identical. Unvalued programs rank after valued cards in units ([decision](decisions/2026-10-02-engine-v3-semantics.md), [rewards engine](system/rewards-engine.md#how-comparerewards-works-v3)). Pre-merge review (agent-verified): gates answered per wallet, an unanswered gate guarantees its worst answer's best rule, shared-cap spend on the smallest rule ID ([decision](decisions/2026-10-02-engine-v3-review-gates-and-shared-caps.md)); a valued card earning $0 ranks below an unvalued card that guarantees units (coordinator decision). Hand-offs: M6 removes the extension's v3 refusal, widens `responseSchema` to the v3 codes and prunes stale wallet inputs; M7 words `value-unknown`, `not-accepted`, `no-accepted-card` and the other v3 codes (placeholder copy now).
- **M1 catalog v3 contract and migration** merged with PR #22 (migration pushed to hosted by the coordinator after merge): `catalogV3Schema` and types, `catalogV3Cases` (117, after the pre-merge review added `excludedBrandIds` and `sharedCapId`) agreeing with `valid_catalog_v3` in migration `20261002222425_catalog_v3` (also drafts ≤ 600 sources, captures ≤ 250,000 chars); full local DB suite green. Details and hand-offs to M2, M4, M6 and M8: [contract details decision](decisions/2026-10-02-catalog-v3-contract-details.md), [rewards engine](system/rewards-engine.md#catalog-v3-contract). After merge the coordinator runs `./scripts/db-push.sh`.
- **Stage 2 M9 expansion eval** merged with PR #21: loader layout `expansion` and `eval:v2 --captures`, `scripts/expansion-pipeline-metrics.mjs`, `scripts/score-expansion-traces.mjs`, [`docs/evals/expansion.md`](../docs/evals/expansion.md) ([decision](decisions/2026-10-02-expansion-eval-design.md)). Pipeline: 5.9% of surviving draft rule-field values corrected, 54 draft rules removed, 182 added. Luna re-score (upper bound): 80.8% end to end on 173 cards. gpt-5.5 low (cross-model, neither drafted nor verified the labels; one repeat, visible output tokens): 76.2% end to end on all 173 (76.7% drafted, 69.1% undrafted), matched-rule field accuracy 94.3% (luna 94.8%), rule recall 81.6%, issue recall 15.4% (luna 56.9%), 11 false-clean, p50 28 s. The run directory is gitignored in this worktree.
- **Stage 2 M3 (valuation table)** merged with PR #20: `evals/curation/expansion/reward-programs.json` maps all 180 cards to 52 programs (24 NerdWallet estimates, 11 issuer-stated, 16 none, cash back); Zod check and tests in `scripts/lib/reward-programs.mjs`; quote check extended; agent-verified. Publisher: [decision](decisions/2026-10-02-nerdwallet-primary-valuation-publisher.md); table: [catalog expansion](system/catalog-expansion.md#reward-program-valuation-m3). Open for Evan: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
- **Stage 2 M11 (pipeline design draft)** merged with PR #19: [card-expansion pipeline design](system/card-expansion-pipeline.md), [decision (proposed)](decisions/2026-10-02-agent-driven-card-pipeline.md), draft skill and subagent definitions under `.claude/`, ESLint import boundary with a test. Evan: approve the design and answer its [open questions](system/card-expansion-pipeline.md#open-design-questions-for-evan) (coordinator recommendations recorded there, pending his approval).
- **Phase 7 Stage 2 plan** merged with PR #18: [Phase 7 Stage 2 plan](product/phase-7-stage-2.md) with milestones M1–M11, decisions on [points valuation](decisions/2026-10-02-points-valuation-published-estimates.md) and [catalog v3](decisions/2026-10-02-catalog-v3-schema.md). Next: M2 (engine v3), M4 (overlay), M8 (review app and API) in parallel.
- **Deadline.** The expansion captures are dated 2026-10-02, so a catalog citing them expires by 2026-11-01T00:00Z; hosted release 1 expires 2026-10-29. Publish target 2026-10-28.
- Stage 1 facts (corpus counts, known gaps, judgment calls) are on [catalog expansion](system/catalog-expansion.md). Captures and luna traces are only in the `../AICheckout-expansion` worktree (gitignored).

## Open questions and next steps

- Check a live catalog refresh in a `build:hosted` extension against the published release (last step of Phase 3 M6).
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Stage 2 open questions resolved by the coordinator on 2026-10-02 (hash-only freshness checks, one conservative valuation publisher, shopper override wins, gpt-5.5 low cross-model eval, package README fixes): [plan](product/phase-7-stage-2.md#decisions-on-the-plans-open-questions).
- The hosted and bundled catalog expires 2026-10-29; Stage 2 M10 replaces it with catalog v3 (target 2026-10-28).
- Human spot-check of the agent-verified labels: deferred by Evan on 2026-10-02.
- Optional cleanup: remove the `m4fix` worktree (in a session scratchpad) and branch.
- Stale package READMEs (left intact by directive; fix or confirm): `supabase/README.md` (six migrations, not applied to hosted, pilot seed; there are eight, all applied, seed is `CATALOG_V2`), `apps/api/README.md` ("no hosted API", 202 tests; now 250 and Render is live), `apps/api/src/curation/README.md` (no live model call made), `packages/rewards-core/README.md` (v1 pilot catalog).
- `core.hooksPath` is already `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Branches without `.githooks/` (not yet merged with the wiki) run no pre-commit hook; once they merge `main` the linter runs on every commit. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
- Later phases, in Evan's order (2026-10-02): Stage 2 → 8 card-expansion pipeline → 9 merchant-expansion pipeline → 5 Web Store release and 4 terms-change detection; 6 site coverage harness ([roadmap](product/roadmap.md)).
