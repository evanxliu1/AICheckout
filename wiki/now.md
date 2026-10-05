---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:26:46Z
---

# Now

As of 2026-10-05T05:27Z.

## Current state

- **Phases 7, 8 and 9 are done.** `origin/main` (`645b1c8`) has the Phase 8 card-expansion pipeline (PRs #36–#42, [results](../docs/evals/pipeline-v1.md)) and Phase 9 milestones 1–5 (PRs #43–#50, #53; [plan](product/phase-9-freshness.md), [results](../docs/evals/freshness-2026-10.md)). Phases: [roadmap](product/roadmap.md).
- **Hosted catalog:** `/v1/catalog` serves **release 3**, `2026-10-05.renewal.1` (178 cards, 328 sources, verified 2026-10-05), published 2026-10-05T05:20:50Z by the coordinator's `pipeline publish --confirm` on Evan's chat instruction of 05:18:43Z, the first agent publish; the served catalog's hash equals `CATALOG_V3` on `main` (checked by the coordinator). It **expires 2026-11-04T00:00Z** ([catalog release](ops/catalog-release.md#release-3-published-2026-10-05)).
- **Hosted code:** Render last checked serving `e9fe387` (2026-10-05T04:40Z); the deploy of `645b1c8` was not checked in this session. All 10 migrations on hosted Supabase; Auth signs with asymmetric keys ([hosting](ops/hosting.md)).
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).
- **Worktrees:** `AICheckout` (main), `AICheckout-p8-wf` (`catalog-renewal-2026-10`, merged; holds every Phase 8 and 9 batch capture: **keep it**, renewals need them), `AICheckout-expansion` (`phase7-verify`; the expansion captures and eval runs), `AICheckout-wiki-audit` (`wiki-audit-2026-10-05`), merged `AICheckout-p9-m3b` and `AICheckout-p9-m5`, `AICheckout-docs` (`docs-readme-demo`), `AICheckout-test`. The unmerged local branch `codex/production-readiness-checkpoint` is untouched.

## Active work

- **Wiki audit** on `wiki-audit-2026-10-05` (agent-verified): current-state pages brought up to release 3 and the agent publish path; `2026-10-05.renewal.1` is added to `publishedVersions` in `evals/curation/catalog-batches.json` in the same PR (coordinator).

## Open questions and next steps

1. Check the extension refresh against release 3 (`prepareCatalogUpdate` over a cached release 2, or a loaded `build:hosted` extension) and that Render serves `645b1c8`.
2. **Next renewal, published before 2026-11-04T00:00Z**: re-read the NerdWallet estimates (read 2026-10-02; valid for catalogs verified up to 2026-11-01). Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data (Discover not captured; the Freedom Flex Jan–Mar 2027 quarter was omitted from the renewal).
3. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it instead of per file, and `pipeline handoff` names the freshness record for the merchant MCC folder ([catalog release](ops/catalog-release.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).
4. Next phases, in Evan's order (2026-10-03): 10 merchant-expansion pipeline → Web Store release; 4 terms-change detection is revisited after 9; 6 site coverage harness ([roadmap](product/roadmap.md)).
5. Before the Web Store release: regenerate the release media, still bound to `2026-10-02.expansion.1` ([release media](ops/release-media.md)); verify the `orderConfirmation` URL patterns on a real order per retailer (Evan); enable GitHub private vulnerability reporting, which [`SECURITY.md`](../SECURITY.md) names (Evan).
6. Open for Evan from Phase 7 M3: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
7. Evan's call: a second luna repeat to firm up the comparison with gpt-5.5 (live run); the human spot-check of the agent-verified labels (deferred 2026-10-02); revoking the legacy HS256 JWT secret in Supabase once pre-switch sessions have expired.
8. Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
9. Setup and housekeeping: `core.hooksPath` is `.githooks` in the shared `.git/config` of Evan's clone (other clones run `git config core.hooksPath .githooks`); Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`. Delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done; remove the merged `AICheckout-p9-m3b` and `AICheckout-p9-m5` worktrees when Evan agrees.
