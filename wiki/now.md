---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:00:00Z
---

# Now

As of 2026-10-02T23:00Z.

## Current state

- **`origin/main`** at `4277f48` (PR #18, the Phase 7 Stage 2 plan, merged; PR #17, Phase 7 verification and the agent-verified corpus `expansion.v1`, before it; PR #16, capture, extraction and drafts, before it; PR #15, this wiki). Merged: PRs #4–#6 (Phase 2a–2c), #7–#12 (Phase 3 M1–M6 prep), #13 (3b automatic cart badge) and #14 (3b follow-ups: a removed badge host comes back at once, covered-click hint in a persistent status region, reader resumes after a back/forward-cache restore, README) ([roadmap](product/roadmap.md), [cart badge](system/cart-badge.md)).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). All 8 migrations are on hosted Supabase; the coordinating session pushed `20260930225732_catalog_v2` and `20261001010350_source_body_limit` with `./scripts/db-push.sh` ([database migrations](ops/database-migrations.md)). `/v1/catalog` serves release sequence 1, the 7-card catalog `2026-09-29.real.1`, published 2026-10-02T02:29Z, expiring 2026-10-29T00:00Z (checked 2026-10-02T05:58Z).
- **Curation model:** gpt-5.6-luna `xhigh` since 2026-10-02 ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)). It is the `eval:v2 --provider codex` and `extract-cards.mjs` default on `main` since PR #16, and [`docs/evals/results.md`](../docs/evals/results.md) has its rows: dev 99.5%, held-out 98.3%, both marked added after ([reporting decision](decisions/2026-10-02-luna-results-per-split.md)).

## Active work

- **Phase 7 Stage 2** ([plan](product/phase-7-stage-2.md), merged in PR #18): M1, M3, M9 and M11 run in parallel.
- **M1 catalog v3 contract and migration** on branch `s2-m1-catalog-v3` (from `4277f48`; committed, not pushed or merged): `catalogV3Schema` and types, `catalogV3Cases` (117, after the pre-merge review added `excludedBrandIds` and `sharedCapId`) agreeing with `valid_catalog_v3` in migration `20261002222425_catalog_v3` (also drafts ≤ 600 sources, captures ≤ 250,000 chars); full local DB suite green. Details and hand-offs to M2, M4, M6 and M8: [contract details decision](decisions/2026-10-02-catalog-v3-contract-details.md), [rewards engine](system/rewards-engine.md#catalog-v3-contract). After merge the coordinator runs `./scripts/db-push.sh`.
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
