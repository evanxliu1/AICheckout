---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:30:00Z
---

# Now

As of 2026-10-02 UTC (evening of 2026-10-01 Pacific).

## Current state

- **`origin/main`** at `ff0c9f7` (PR #12, Phase 3 M6 prep). Phase 3 M1–M5 merged and deployed on Render ([roadmap](product/roadmap.md)).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). `/v1/catalog` serves no release yet, so the extension uses its bundled 7-card catalog.
- **`phase3b-auto-badge`** (not merged) at `1fd1e31`: automatic cart badge, optional vault, onboarding, savings, docs, release media, badge security review fixes ([decision](decisions/2026-10-01-automatic-cart-badge.md), [cart badge](system/cart-badge.md)).
- **`llm-wiki`** (worktree `../AICheckout-wiki`, fast-forwarded to `phase3b-auto-badge` at `1fd1e31`): this wiki, `AGENTS.md`, linter, hook, CI step. Not committed yet.
- **Eval results** published 2026-09-29/30 in [`docs/evals/results.md`](../docs/evals/results.md); labels are agent-verified ([evaluation](system/evaluation.md)).

## Active work

- Phase 3 M6: Evan publishes the 7-card catalog in the hosted review app ([publish runbook](../docs/release/publish-runbook.md)); then verify `/v1/catalog` and a live refresh of a `build:hosted` extension.
- Phase 3b: finish release media, review and merge.

## Open questions and next steps

- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- Optional human verification pass over the agent-verified corpus labels.
- Next phases: 4 terms-change detection, 5 Web Store release, 6 site coverage harness ([roadmap](product/roadmap.md)).
- Wiki setup for Evan: `git config core.hooksPath .githooks` to enable the pre-commit linter; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Stale package READMEs (left intact by directive; fix or confirm): `supabase/README.md` (says six migrations, not applied to hosted, pilot seed; there are eight, seed is `CATALOG_V2`), `apps/api/README.md` ("no hosted API", 202 tests; now 250 and Render is live), `apps/api/src/curation/README.md` (says no live model call made), `packages/rewards-core/README.md` (describes the v1 pilot catalog).
- Are migrations `20260930225732_catalog_v2` and `20261001010350_source_body_limit` on hosted Supabase? Not recorded; check with `./scripts/db-push.sh --dry-run` ([database migrations](ops/database-migrations.md)).
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- The bundled catalog expires 2026-10-29, but issuer pages may not be re-captured before a label verification pass. Decide how to refresh it.
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
