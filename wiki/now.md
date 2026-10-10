---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-09T23:55:00Z
---

# Now

As of 2026-10-09T23:55Z.

## Current state

- **`origin/main` is `6000085`** (PR #78, Phase 13b). Phases 7–13 and 13b are done; Phase 13c (cart detection and the badge at any store) is planned on branch `phase13c-cart-detection` ([plan](product/phase-13c-cart-detection.md), [roadmap](product/roadmap.md)).
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), published 2026-10-05T05:20:50Z; **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). Render last checked serving `e9fe387`; all 10 migrations on hosted ([hosting](ops/hosting.md)).
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)) and the pane exports (`evals/merchants/capture/data/pane/`); `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules:** the reader shows an amount only when certain, otherwise withholds (rates only); generic reader only, no store configs. **Since 2026-10-08 (Evan) the ≥ 99% bar is a quality target, not a pass gate** ([decision](decisions/2026-10-08-pause-capture-quality-target.md)); results are reported with exact bounds, store counts and coverage (target 80% on `cart-1`).
- **Phase 12 eval set: frozen 2026-10-08** ([report](../docs/evals/reader-captures-2026-10.md)): 337 stores (332 pane + 5 robot), development 200 / held-out A 137; 1,217 page-states labelled once each (one labeller per store, Evan's [decision](decisions/2026-10-08-single-labeller.md)), 819 with an expected amount (held-out A 331, of them 117 `cart-1`); 1,819 variants `.2`; `freeze.json` at `2de2fec` after the independent capture review (72 page-states and 2 stores dropped, 6 deviations reported); check passes. Capture was paused at 532 visited (95 blocked by bot walls or CAPTCHAs, a reported gap).
- **Tools (agent-verified reviews):** export collector, renders and tiles, labeller digest, label schema and assembler, single-labeller finals, variants and the 10% check, freeze; the Phase 13 harness (`evals/reader/`) with a placeholder reader in `packages/cart-reader`.
- **Reader v1 (2026-10-09, [report](../docs/evals/reader-v1.md)):** `packages/cart-reader` (final `94b7b9a`), built by Fable 5.1 in six rounds with independent reviews. Development 384 correct / 0 wrong / 338 withheld (`cart-1` 86%, p95 10 ms). Held-out A run 1 (unbiased) 237 / 18 (92.9%, wrong rate ≤ 10.3%), run 2 after general fixes 244 / 7 (97.2%, ≤ 5.2%; right amount and currency on 249 of 251), `cart-1` 78.6%, p95 11.6 ms. Both held-out runs are used.

- **Phase 13b (2026-10-09, merged PR #78):** the popup's "Read cart amount" works at any web store: the legacy adapters on their cart URLs, `readCart` everywhere else, the amount filled only when the reader shows a USD amount, otherwise a message and a typed amount ([Extension](system/extension.md#manual-cart-read-popup), [decision](decisions/2026-10-09-generic-read-on-legacy-site-pages.md)). The badge stays on the three stores. For Phase 15: `docs/release/support.md`, `reviewer-instructions.md` and the capture manifest still describe the three-store manual read, and `docs/release/privacy-policy.md` (line 31) and `store-listing.md` (line 54, scripting row) are narrower than the generic reader, which also reads structured-data, meta and attribute currency hints and the URL's TLD.

- **Phase 13c (planned 2026-10-09):** Evan chose `https://*/*` at install so the badge runs at any store, no typed amounts ever (best card and dollar estimate when certain, otherwise best card and rate), and 13c before Phase 14 ([all sites](decisions/2026-10-09-badge-on-all-sites.md), [no typing](decisions/2026-10-09-never-ask-for-an-amount.md)). This adds to the Phase 15 docs: the privacy policy, store listing (permission justification for all https sites, single purpose), support, reviewer instructions and `extension/README.md` must describe the badge at any store.

## Active work

- **Phase 13c:** 13c.1 detector and 13c.2 badge everywhere (Fable 5.1 implementer), 13c.3 independent review (Fable 5.1 reviewer), 13c.4 held-out detector run and live home sweep (coordinator), 13c.5 reader coverage round, 13c.6 PR.

## Open questions and next steps

1. **Next catalog renewal before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)); plan it for about 2026-10-28 (Evan types `publish <version>`). Re-read the NerdWallet estimates (valid for catalogs verified up to 2026-11-01).
2. Evan's call (asked 2026-10-07): allow known cart-only pages under `/checkout` (VTEX `/checkout/#/cart`, AbeBooks `/checkout/basket`) in any future capture; 11 stores were excluded as `would-need-forbidden-action`.
3. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
4. Before the Web Store release (Phase 15): verify `orderConfirmation` URLs on real orders (Evan); enable GitHub private vulnerability reporting; optionally confirm a loaded `build:hosted` extension picks up release 3.
5. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret.
6. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
7. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; remove merged worktrees (`.claude/worktrees/agent-*`) when Evan agrees.
