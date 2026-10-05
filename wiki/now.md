---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:47:59Z
---

# Now

As of 2026-10-05T05:47:59Z.

## Current state

- **Phases 7, 8 and 9 are done.** `origin/main` (`c0cb81e`, PR #54) has everything: the Phase 8 card-expansion pipeline ([results](../docs/evals/pipeline-v1.md)), Phase 9 milestones 1–5 ([plan](product/phase-9-freshness.md), [results](../docs/evals/freshness-2026-10.md)) and the release 3 wiki audit. Phases: [roadmap](product/roadmap.md).
- **Hosted catalog:** `/v1/catalog` serves **release 3**, `2026-10-05.renewal.1` (178 cards, 328 sources), published 2026-10-05T05:20:50Z by the coordinator's `pipeline publish --confirm` on Evan's chat instruction; it **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)).
- **Hosted code:** Render last checked serving `e9fe387` (2026-10-05T04:40Z); later deploys not checked. All 10 migrations on hosted Supabase ([hosting](ops/hosting.md)).
- **Captures:** since 2026-10-05 the main checkout holds every gitignored capture (11 batch folders, `expansion/captures` 321, extractions, eval runs); `publish` from it with no `--captures` flag matches 328/328 ([capture folders](ops/catalog-release.md#capture-folders)). `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them.
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).

## Active work

- **Phase 10 plan** (coordinator): [draft v6](product/phase-10-merchant-expansion.md): any U.S. online checkout through a hosted merchant database and a generic cart reader proven on real pages, Release A inside the phase, consented telemetry without browsing data ([merchant coverage design](system/merchant-coverage-design.md), [telemetry design](system/telemetry-design.md)); three review rounds (Fable 5.1 ×3, Opus 5.5); **awaiting Evan's decisions D1–D14**.
- Release media regenerated for `2026-10-05.renewal.1` (`npm run release:media`, all checks passed, 2026-10-05; [release media](ops/release-media.md)).

## Open questions and next steps

1. **Evan: approve or change the [Phase 10 plan](product/phase-10-merchant-expansion.md)** and answer decisions D1–D14. No Phase 10 work starts before that.
2. **Next renewal, published before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)): re-read the NerdWallet estimates (read 2026-10-02; valid for catalogs verified up to 2026-11-01). Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data.
3. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it instead of per file; `pipeline handoff` names the freshness record for the merchant MCC folder ([renewal record](ops/catalog-release-history.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).
4. Phase order (Evan, 2026-10-03): 10 merchant expansion → Web Store release; 4 terms-change detection revisited after 9; 6 site coverage harness (may fold into 10).
5. Before the Web Store release: verify the `orderConfirmation` URL patterns on a real order per retailer (Evan); enable GitHub private vulnerability reporting ([`SECURITY.md`](../SECURITY.md)); optionally confirm **Check for updated terms** in a loaded `build:hosted` extension picks up release 3.
6. Evan's calls: Aer Lingus and Iberia Avios valuation parity; a second luna repeat against gpt-5.5; the human spot-check of agent-verified labels (deferred 2026-10-02); revoking the legacy HS256 JWT secret.
7. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
8. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; revoke the retired `simulation/` keys if not done; remove the merged `AICheckout-p9-m3b`, `AICheckout-p9-m5` and `AICheckout-wiki-audit` worktrees when Evan agrees.
