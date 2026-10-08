---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T06:45:00Z
---

# Now

As of 2026-10-08T06:45Z.

## Current state

- **`origin/main` is `fcbaf5a`** (PR #74, capture runbook). Phases 7–11 are done; Phase 12 is closing and Phase 13 is next ([roadmap](product/roadmap.md)). Branch `phase12-capture-run` holds the capture, `.11`/`.12`, the Workflow 3 tools and the Phase 13 harness.
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), published 2026-10-05T05:20:50Z; **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). Render last checked serving `e9fe387`; all 10 migrations on hosted ([hosting](ops/hosting.md)).
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)) and the pane exports (`evals/merchants/capture/data/pane/`); `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules:** the reader shows an amount only when certain, otherwise withholds (rates only); generic reader only, no store configs. **Since 2026-10-08 (Evan) the ≥ 99% bar is a quality target, not a pass gate** ([decision](decisions/2026-10-08-pause-capture-quality-target.md)); results are reported with exact bounds, store counts and coverage (target 80% on `cart-1`).
- **Phase 12 capture: paused 2026-10-08 (Evan).** 532 candidates visited by pane (U.S. 296, non-U.S. 236): **334 captured** (U.S. 187, non-U.S. 147), **315 with a real `cart-1`**, plus 5 standing robot captures; about 2.9 cart page-states per captured store. Protocol `.12` signed at `265dbdc` (exports collected from transcripts, tab cap 8); the 840 stop rule and the 300-`cart-1` report rule no longer apply ([progress](product/phase-12-reader-eval.md#progress)).
- **Tools built and reviewed (agent-verified):** export collector, rendered screenshots (`render-pane.mjs`), label schema/validator, agreement and adjudication, split input, nine offline variants with the 10% check, freeze; the Phase 13 harness (`evals/reader/`) with a placeholder reader in `packages/cart-reader`.

## Active work

- **Close Phase 12 (12.4):** integrity sweep of the exports, split (60 / 40), rendering, a labeller digest tool, double labelling and adjudication, variants, freeze, `docs/evals/reader-captures-2026-10.md`, PR and merge.
- **Then Phase 13:** reader v1 by a separate reader-developer agent on development pages only; held-out A run by an evaluation agent (at most twice); report; then extension integration.

## Open questions and next steps

1. **Next catalog renewal before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)); plan it for about 2026-10-28 (Evan types `publish <version>`). Re-read the NerdWallet estimates (valid for catalogs verified up to 2026-11-01).
2. Evan's call (asked 2026-10-07): allow known cart-only pages under `/checkout` (VTEX `/checkout/#/cart`, AbeBooks `/checkout/basket`) in any future capture; 11 stores were excluded as `would-need-forbidden-action`.
3. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
4. Before the Web Store release (Phase 15): verify `orderConfirmation` URLs on real orders (Evan); enable GitHub private vulnerability reporting; optionally confirm a loaded `build:hosted` extension picks up release 3.
5. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret.
6. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
7. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; remove merged worktrees (`.claude/worktrees/agent-*`) when Evan agrees.
