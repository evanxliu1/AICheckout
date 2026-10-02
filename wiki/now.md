---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T06:10:00Z
---

# Now

As of 2026-10-02T06:10Z (evening of 2026-10-01 Pacific).

## Current state

- **`origin/main`** at `7322dec`. Merged: PRs #4–#6 (Phase 2a–2c), #7–#12 (Phase 3 M1–M6 prep), #13 (3b automatic cart badge) and #14 (3b follow-ups: a removed badge host comes back at once, covered-click hint in a persistent status region, reader resumes after a back/forward-cache restore, README) ([roadmap](product/roadmap.md), [cart badge](system/cart-badge.md)).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). All 8 migrations are on hosted Supabase; the coordinating session pushed `20260930225732_catalog_v2` and `20261001010350_source_body_limit` with `./scripts/db-push.sh` ([database migrations](ops/database-migrations.md)). `/v1/catalog` serves release sequence 1, the 7-card catalog `2026-09-29.real.1`, published 2026-10-02T02:29Z, expiring 2026-10-29T00:00Z (checked 2026-10-02T05:58Z).
- **`llm-wiki`** (worktree `../AICheckout-wiki`): this wiki, `AGENTS.md`, linter, hook, CI step; committed and merged with `origin/main` at `7322dec`; not yet pushed or merged to `main`.
- **Curation model:** gpt-5.6-luna `xhigh` since 2026-10-02 ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)). Published eval results in [`docs/evals/results.md`](../docs/evals/results.md) do not yet include the luna row; it lands with the code change.

## Active work

- **Phase 7 card expansion** on `phase7-catalog-expansion` (worktree `../AICheckout-expansion`, from `ff0c9f7`, unmerged; head `fc66e07`): 180 cards, 65 exclusions, 321 sources captured; luna extraction done (168 `needs_review`, 12 `evidence_valid`). Next: decide points valuation (fixes the `rate_not_in_evidence` validator gap), draft labels, per-issuer verifier subagents, Stage-2 engine work and a new migration raising catalog limits, eval, then Evan publishes ([catalog expansion](system/catalog-expansion.md)).

## Open questions and next steps

- Check a live catalog refresh in a `build:hosted` extension against the published release (last step of Phase 3 M6).
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- Points valuation for the expansion: cents per point per currency, stated or assumed, and how the engine ranks points cards.
- The hosted and bundled catalog expires 2026-10-29, but issuer pages may not be re-captured before a label verification pass. Decide how to refresh it (Phase 7 may replace it).
- Optional human verification pass over the agent-verified corpus labels.
- Optional cleanup: remove the `m4fix` worktree (in a session scratchpad) and branch.
- Stale package READMEs (left intact by directive; fix or confirm): `supabase/README.md` (six migrations, not applied to hosted, pilot seed; there are eight, all applied, seed is `CATALOG_V2`), `apps/api/README.md` ("no hosted API", 202 tests; now 250 and Render is live), `apps/api/src/curation/README.md` (no live model call made), `packages/rewards-core/README.md` (v1 pilot catalog).
- `core.hooksPath` is already `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Branches without `.githooks/` (not yet merged with the wiki) run no pre-commit hook; once they merge `main` the linter runs on every commit. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
- Later phases: 4 terms-change detection, 5 Web Store release, 6 site coverage harness ([roadmap](product/roadmap.md)).
