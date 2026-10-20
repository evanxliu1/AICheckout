---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T00:30:00Z
---

# Now

As of 2026-10-20T00:30Z (planning session dated 2026-10-19).

## Current state

- **`origin/main` is `96ba5265`** (PR #93). Phases 7–14 are done ([roadmap](product/roadmap.md)). **Phase 15 (Release A) is planned** on branch `phase15-plan` (not merged): [plan](product/phase-15-release-a.md), decisions [retire the legacy adapters](decisions/2026-10-19-retire-legacy-adapters.md), [telemetry design](decisions/2026-10-19-release-a-telemetry-design.md), [first run and expiry](decisions/2026-10-19-release-a-first-run-and-expiry.md).
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). **Hosted merchant release 1:** `2026-10-11.mcc.3` (640 stores, 89 bonus categories), published 2026-10-12T00:31Z; `GET /v1/merchants` serves it. All 12 migrations are on hosted ([hosting](ops/hosting.md)).
- **Extension at `main`:** the badge at any https store (13c), the merchant release matched on the device with the weekly refresh (14.2, 14.6), the three legacy adapters still on their cart URLs with URL-only order detection and the savings history (to be retired in 15.1), manifest version `2.0.0`, no telemetry, no uninstall URL. The release docs (`docs/release/`, `docs/verification/`, `extension/README.md`), the README and the public site still describe three stores and no telemetry (15.5).
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)) and the pane exports; `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules:** amounts only when certain, otherwise the rates view; generic reader only, no store configs; the ≥ 99% bar is a quality target ([decision](decisions/2026-10-08-pause-capture-quality-target.md)). Reader v1 and detector numbers: [reader-v1](../docs/evals/reader-v1.md), [cart-detection-v1](../docs/evals/cart-detection-v1.md); merchant database: [merchant-db-v1](../docs/evals/merchant-db-v1.md).

## Active work

- **Phase 15 planned 2026-10-19** (Fable 5.1 planner, on Evan's directives of that day: adapters retired no matter what, Fable implements and Opus reviews and fixes, telemetry on the existing Supabase and Render, the renewal as a parallel milestone, Evan pays, submits, publishes, reads the policy and enables private vulnerability reporting). Milestones: 15.1 retire the adapters (15.1m: the coordinator's measurement on fresh pane captures of amazon.com, bestbuy.com, secure.newegg.com, for the record), 15.2 telemetry backend (migration, anon ingest RPC, API routes, reviewer reads), 15.3 telemetry client and consent (onboarding opt-in, Stop sharing, Delete my data, Suggest and Report, generated dictionary `docs/telemetry/events.md`), 15.4 first run and expiry (install-time refresh, "checking" copy, `2.1.0`, uninstall page), 15.5 release docs and site (privacy policy, listing, support, reviewer instructions, READMEs, `/credits/` with the Oklahoma CC BY notice, `/uninstalled/`), 15.6 store assets, 15.R catalog renewal, 15.7 submission build, reviewer pass and release record. **Next:** Evan answers the eight decisions in the plan's [section 8](product/phase-15-release-a.md#8-decisions-needed-from-evan) (or the recommendations stand), the coordinator merges `phase15-plan`, then 15.1 and 15.2 start in parallel.

## Open questions and next steps

1. **Evan's Phase 15 decisions** (plan [section 8](product/phase-15-release-a.md#8-decisions-needed-from-evan)): publisher name and support email; drop order detection and savings (recommended); tap features without consent send no ID (recommended); fixed problem reasons (recommended); version `2.1.0`; privacy-tab categories (financial, website content, user activity); trader or non-trader (non-trader recommended; a legal statement); D14 hosting trigger (stay free; 100 weekly active installs or sustained 429s/503s).
2. **Catalog renewal before 2026-11-04T00:00Z** (15.R, [renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)): `pipeline freshness` by 2026-10-26, refresh batches, build, merge, deploy, Evan types `publish <version>` about 2026-10-28; the Release A ZIP bundles it. Re-read the NerdWallet estimates for a catalog verified after 2026-11-01.
3. Phase 15 risk to watch: Chrome's 2026 "strictly necessary" single-purpose rule against collecting owned cards and amounts; the build-time telemetry switch is the fallback ([decision](decisions/2026-10-19-release-a-telemetry-design.md)).
4. Evan's call (asked 2026-10-07): allow known cart-only pages under `/checkout` (VTEX `/checkout/#/cart`, AbeBooks `/checkout/basket`) in any future capture; 11 stores were excluded as `would-need-forbidden-action`.
5. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
6. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret.
7. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)). D9: merchant data, eval labels and snapshots stay MIT for now (provisional, 2026-10-10).
8. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md` (it describes a 2026-01 prototype); remove merged worktrees (`.claude/worktrees/agent-*`) when Evan agrees.
