---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T06:45:00Z
---

# Now

As of 2026-10-03T06:45Z.

## Current state

- **Phase 7 is done.** `origin/main` (`577c025`) has Stage 2 (PRs #18–#31), the Ocean theme (PR #32) and the release media in the Ocean look (PR #33). The extension bundles the 178-card `CATALOG_V3` `2026-10-02.expansion.1`. Milestones: [Stage 2 plan](product/phase-7-stage-2.md); phases: [roadmap](product/roadmap.md).
- **Hosted catalog:** Evan published `2026-10-02.expansion.1` as **release 2** at 2026-10-03T06:15Z (schema 3, 178 cards, 328 sources, **expires 2026-11-01T00:00Z**), with the coordinator driving the review app after he signed in. Draft and served release are canonically identical to `CATALOG_V3` on `577c025`; the extension's `prepareCatalogUpdate` accepts it over a cached release 1 (closes the Phase 3 M6 check, verified through the update logic, not a loaded `build:hosted` extension). The review note says agent-verified, not human-verified. Details: [catalog release](ops/catalog-release.md#release-2-published-2026-10-03).
- **Hosted:** site, review app and `/v1/catalog` at https://ai-checkout-api.onrender.com, Render serving `main`; all 10 migrations on hosted Supabase. Auth signs with asymmetric keys since 2026-10-03 (one ES256 key), so the review token pre-check is local ([hosting](ops/hosting.md)).
- **Brand:** the toolbar icons and promo tile keep the Helios-blue cart mark ([decision](decisions/2026-10-03-keep-helios-blue-cart-mark.md)).
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)); results in [`docs/evals/results.md`](../docs/evals/results.md) and [`docs/evals/expansion.md`](../docs/evals/expansion.md).
- **Worktrees** (cleanup 2026-10-03): only `AICheckout` (main), `AICheckout-expansion` (branch `phase7-verify`; gitignored captures and eval runs, including the gpt-5.5 cross-model and luna runs under `evals/curation/runs/`) and `AICheckout-test` remain, plus this session's `AICheckout-wiki2`. The unmerged local branch `codex/production-readiness-checkpoint` was left untouched.

## Active work

- Wiki update for the release on branch `wiki-release-2` (PR open, Evan or the coordinator merges).
- **Phase 8 card-expansion pipeline:** design proposed ([pipeline](system/card-expansion-pipeline.md), [decision, proposed](decisions/2026-10-02-agent-driven-card-pipeline.md)); an independent Fable 5.1 review (agent-verified) approved it with changes and a v1 build order ([review](system/card-expansion-pipeline.md#review-2026-10-03-fable-51-agent-verified)). Not yet approved by Evan.

## Open questions and next steps

1. **Evan approves the pipeline design with the review's changes**, then Phase 8 v1 is built in the review's order: multi-batch builder → CLI skeleton → claim/accept with gates and label lint → skill and four agent files → eval and hand-off → freshness → one small issuer end to end.
2. **Catalog freshness before 2026-11-01T00:00Z**, when release 2 expires and `/v1/catalog` would answer 503: re-check the sources (the pipeline's freshness stage, or a manual refresh with new dated captures) and publish a new release. Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data (Discover not captured).
3. Optional (Evan): revoke the legacy HS256 JWT secret in Supabase once sessions issued before the switch have expired.
- Later phases, in Evan's order (2026-10-02): 9 merchant-expansion pipeline → 5 Web Store release and 4 terms-change detection; 6 site coverage harness ([roadmap](product/roadmap.md)).
- Open for Evan from M3: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Human spot-check of the agent-verified labels: deferred by Evan on 2026-10-02.
- `core.hooksPath` is `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
