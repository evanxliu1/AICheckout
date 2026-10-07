---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T01:23:23Z
---

# Now

As of 2026-10-07T05:15Z.

## Current state

- **`origin/main` is `472222a`** (PR #73, `generic-reader-protocol.10`); the wiki audit merged as PR #72. Phases 7–11 are done; Phase 12 is in progress ([roadmap](product/roadmap.md)).
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), published 2026-10-05T05:20:50Z; **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). Render last checked serving `e9fe387` (2026-10-05T04:40Z); all 10 migrations on hosted ([hosting](ops/hosting.md)).
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)); `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules (Evan, 2026-10-06, [decision](decisions/2026-10-06-reader-shows-only-certain-amounts.md)):** the reader shows an amount only when certain, otherwise withholds and the recommendation shows rates only (no "is that right?" prompt). Bar: one-sided 95% Clopper–Pearson upper bound of wrong shown amounts ≤ 1% on the held-out split (0 wrong in 299, or 1 in 473); coverage reported, target 80% on `cart-1`. Generic reader only, no store configs; the 3 legacy adapters retire once it matches them.
- **Phase 12** ([progress](product/phase-12-reader-eval.md#progress)): protocol **`.10` signed at `779855e`** (Evan, 2026-10-07: development 60% / held-out A 40%, held-out B merged into development, a fresh held-out set if A fails twice, [decision](decisions/2026-10-07-split-dev-60-heldout-40.md)). Capture stops at 840 captured sites with a real `cart-1` (336 U.S. + 504 non-U.S.; either stream continues if the other runs out). The robot capture tool is retired as the main path (kept; 5 robot captures); a 3-store pane trial reached 3 of 3 carts. No reader-developer activity on any store before the final split and freeze.

## Active work

- **Pilot done (2026-10-07, branch `phase12-capture-run`, not merged): 0 of 16 captured**, 8 of them `tool-error` from an export-size defect (chunk results over the pane JavaScript tool's limit; [progress](product/phase-12-reader-eval.md#progress)). **Full run on hold** until Evan decides the fix (a change to checklist step 7 needs an amendment signed by an independent reviewer).
- **Full pane capture under `.10`, not started.** It runs as Claude workflows from a fresh chat per the [reader capture workflow](ops/reader-capture-workflow.md) runbook: a 16-store pilot, then full capture by `pane-operator` subagents in the browser pane (8–16 tabs, frozen order in `evals/merchants/reader-candidates-8.json` plus re-visits), then split, label, review and freeze. CAPTCHAs and bot checks are never solved (skipped and reported); robots.txt is recorded only; signed-in stores are captured under guards; lingering cart items never block a capture.

## Open questions and next steps

1. **Next renewal before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)): re-read the NerdWallet estimates (valid for catalogs verified up to 2026-11-01); Freedom Flex and Discover Q4 rules end 2026-12-31.
2. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
3. Before the Web Store release (Phase 15): verify `orderConfirmation` URLs on real orders (Evan); enable GitHub private vulnerability reporting; optionally confirm a loaded `build:hosted` extension picks up release 3.
4. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret. Later phase decisions are asked per phase ([table](product/phase-10-merchant-expansion.md#decisions-for-evan-one-word-each-asked-when-their-phase-starts)).
5. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
6. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; revoke the retired `simulation/` keys if not done; remove merged worktrees when Evan agrees.
