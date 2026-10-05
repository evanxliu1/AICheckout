---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T04:30:00Z
---

# Now

As of 2026-10-05T03:04Z.

## Current state

- **Phase 7 is done.** `origin/main` (`577c025`) has Stage 2 (PRs #18–#31), the Ocean theme (PR #32) and the release media in the Ocean look (PR #33). The extension bundles the 178-card `CATALOG_V3` `2026-10-02.expansion.1`. Milestones: [Stage 2 plan](product/phase-7-stage-2.md); phases: [roadmap](product/roadmap.md).
- **Hosted catalog:** Evan published `2026-10-02.expansion.1` as **release 2** at 2026-10-03T06:15Z (schema 3, 178 cards, 328 sources, **expires 2026-11-01T00:00Z**), with the coordinator driving the review app after he signed in. Draft and served release are canonically identical to `CATALOG_V3` on `577c025`; the extension's `prepareCatalogUpdate` accepts it over a cached release 1 (closes the Phase 3 M6 check, verified through the update logic, not a loaded `build:hosted` extension). The review note says agent-verified, not human-verified. Details: [catalog release](ops/catalog-release.md#release-2-published-2026-10-03).
- **Hosted:** site, review app and `/v1/catalog` at https://ai-checkout-api.onrender.com, Render serving `main`; all 10 migrations on hosted Supabase. Auth signs with asymmetric keys since 2026-10-03 (one ES256 key), so the review token pre-check is local ([hosting](ops/hosting.md)).
- **Brand:** the toolbar icons and promo tile keep the Helios-blue cart mark ([decision](decisions/2026-10-03-keep-helios-blue-cart-mark.md)).
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)); results in [`docs/evals/results.md`](../docs/evals/results.md) and [`docs/evals/expansion.md`](../docs/evals/expansion.md).
- **Worktrees** (cleanup 2026-10-03): only `AICheckout` (main), `AICheckout-expansion` (branch `phase7-verify`; gitignored captures and eval runs, including the gpt-5.5 cross-model and luna runs under `evals/curation/runs/`) and `AICheckout-test` remain, plus this session's `AICheckout-wiki2`. The unmerged local branch `codex/production-readiness-checkpoint` was left untouched.

## Active work

- **Public docs** (branch `docs-readme-demo`, checkout `../AICheckout-docs`): new README with SVG diagrams and the Ocean-cinematic demo video ([decision](decisions/2026-10-05-readme-demo-video-and-diagrams.md)). Evan to upload `docs/readme/demo.mp4` once in the GitHub web UI for an inline `user-attachments` player. His GitHub profile README was refreshed (`evanxliu1/evanxliu1`, 2026-10-05).
- **Phase 9, catalog freshness** (coordinator, started 2026-10-04; [plan](product/phase-9-freshness.md)). Tooling merged: PRs #43 plan, #44 review app knows batch manifests and freshness records, #45 published versions frozen, `--proposed` builds, `drop-source`, #46 `pipeline freshness`, seeded refresh batches, real cards in batches, #47 undrafted cards, #48 builder omissions only for base-layer cards.
- **Renewal run** (branch `catalog-renewal-2026-10`, checkout `../AICheckout-p8-wf`, which holds every new capture: keep it): freshness 2026-10-05 found 192 of 328 sources unchanged, 135 changed, 1 flagged; 107 cards re-verified in ten refresh batches plus the Phase 8 Wells Fargo batch (Evan, 2026-10-04); `2026-10-05.renewal.1` built (178 cards, expires 2026-11-04; rule IDs 589 kept, 224 changed, 3 added, 7 dropped). Results: [`docs/evals/freshness-2026-10.md`](../docs/evals/freshness-2026-10.md). Next: independent review, PR, merge, Render deploy, then **Evan publishes** ([catalog release](ops/catalog-release.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).

## Open questions and next steps

1. **Evan: publish the Wells Fargo refresh or not?** It applies general convention 7 (activation `none`) on 22 rules, adds 35 catalog exclusions and drops `usMerchantsOnly` on the One Key Expedia rules (a Phase 7 judgment call); no rate, cap or category changes. Default: not published; Phase 9 renews all sources anyway.
   - Before any pipeline batch can be published, the review app must bundle the batch's manifest (`apps/review/src/manifest.ts` imports fixed paths): a product change and a Render deploy, first task of Phase 9. `pipeline handoff` lists the sources the app would not match.
2. **Phase 9, catalog freshness, before 2026-11-01T00:00Z**, when release 2 expires and `/v1/catalog` would answer 503: re-check the sources (the pipeline's freshness stage, or a manual refresh with new dated captures) and publish a new release. Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data (Discover not captured).
2. **Evan: publish `2026-10-05.renewal.1`** once merged and deployed (from 2026-10-20, latest 2026-10-28; release 2 expires 2026-11-01T00:00Z). Then the next renewal before 2026-11-04 (re-read the NerdWallet estimates). Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data (Discover not captured). The renewal after this one must re-read the NerdWallet estimates (read 2026-10-02; valid for catalogs verified up to 2026-11-01).
3. Optional (Evan): revoke the legacy HS256 JWT secret in Supabase once sessions issued before the switch have expired.
- Later phases, in Evan's order (2026-10-03): 9 freshness → 10 merchant-expansion pipeline → Web Store release; 4 terms-change detection is revisited after 9; 6 site coverage harness ([roadmap](product/roadmap.md)).
- Open for Evan from M3: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Human spot-check of the agent-verified labels: deferred by Evan on 2026-10-02.
- `core.hooksPath` is `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
