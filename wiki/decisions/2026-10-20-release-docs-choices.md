---
type: Decision
title: "Phase 15.5 implementer choices: SUPPORT_EMAIL_TBD as the one placeholder with a release-mode check, the policy avoids the word anonymous even as a denial, the privacy page is the policy, credits and uninstalled pages outside the navigation, a credits link in the popup footer, historical verification evidence kept under a status header"
description: Choices of 2026-10-20 made within milestone 15.5 of the Phase 15 plan while rewriting the release docs and the public site. The missing support email is the literal SUPPORT_EMAIL_TBD everywhere and `scripts/check-release-docs.mjs --release` refuses it (plain mode, run by the scripts tests in CI, refuses only the retired three-store wording and "anonymous"); the policy and site never use "anonymous" at all, so the grep can be strict; the site's /privacy/ page is the published policy and docs/release/privacy-policy.md its copy; /credits/ and /uninstalled/ are rendered pages reached from the footer and from Chrome, not from the navigation; hosted builds show "About AI Checkout: credits and data sources" in the popup footer; docs/verification/merchants.md keeps its September observations under a status header instead of being rewritten.
status: accepted
tags: [decision, phase-15, release, docs, site, privacy]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-20T22:30:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (milestone 15.5, section 6, section 8)
  - resource: 2026-10-10-data-collection.md
    title: Decision, data collection (the wording rule)
  - resource: 2026-10-19-release-a-first-run-and-expiry.md
    title: Decision, static uninstall page
  - resource: ../../docs/telemetry/events.md
    title: The generated dictionary the policy must agree with
  - resource: ../../evals/merchants/db/mcc/NOTICE.md
    title: The attribution notice the credits page carries
---

# Phase 15.5 implementer choices (2026-10-20)

## Context
Milestone 15.5 of the [plan](../product/phase-15-release-a.md#4-milestones) rewrites `docs/release/`, `docs/verification/merchants.md`, `extension/README.md`, the root README and the public site for the extension as it is after 15.1–15.4, adds `/credits/` and `/uninstalled/`, and adds tests and a grep against the retired three-store wording and "anonymous". The coordinator applied Evan's defaults pending his confirmation: publisher "Evan Liu", no support email yet (a literal `SUPPORT_EMAIL_TBD` with a check 15.7 can run), non-trader recorded as "Evan to confirm", the privacy-tab answers of section 6, the random-identifier wording, US-only, 90 days. Several details were the implementer's.

## Options considered

| Question | Chosen | Alternatives |
| --- | --- | --- |
| The missing support email | The literal `SUPPORT_EMAIL_TBD` in the listing, the policy (file and site), the support page (file and site). `scripts/lib/release-docs.mjs` has two rule sets: the stale-wording rules (three-store phrases, "only on … stores", "supported stores", any form of "anonymous") run on every `npm test` through `scripts/lib/release-docs.test.mjs`, so CI fails on a regression; the placeholder rules (`SUPPORT_EMAIL_TBD`, `EFFECTIVE_DATE_TBD`, `[[…]]`, "Evan to confirm/supply") run only with `--release` (`npm run release:docs:check:release`), which 15.7 runs before submission and which fails today by design (the test asserts that it does, and that nothing else fails) | The old `[[SUPPORT_EMAIL]]` style (kept the same shape in the release rule); making CI fail now (would block every PR on a decision only Evan can take) |
| "Anonymous" in the policy | Never used, not even as a denial ("pseudonymous, not anonymous" became "pseudonymous: it cannot be tied to you by name, but reports from one install can be linked to each other"; "not anonymization" became "not a privacy measure"), so the check and the site test can refuse the word outright instead of judging context | A context-aware grep (fragile) |
| Where the policy lives | `/privacy/` on the site is the published policy; `docs/release/privacy-policy.md` is its markdown copy with the same sections and facts, and says so at the top. Same for `/support/` and `support.md` | One source rendered to both (the site renders TSX; markdown-to-page would add a build step for one page) |
| Dated internal docs in `docs/release/` (`privacy-review.md`, the two runbooks, `portfolio-demo.md`) | Untouched and listed as superseded history in `docs/release/README.md`; excluded from the check (it lists its paths explicitly) | Rewriting them (not public, not in the 15.5 row) |
| `docs/verification/merchants.md` | A status section at the top (adapters retired, what changed measured in `legacy-adapter-retirement.md`, release checks closed) and the September observations demoted to a "Historical record" section with dead links to removed fixtures and the adapter spec replaced by plain text; "anonymous desktop cart" reworded to "logged-out" so the check can stay strict | Rewriting the observations (they are evidence of what was seen; the retirement doc is the current measurement) |
| Credits and uninstalled pages | Rendered pages like the others (`PAGES` for the navigation, `OTHER_PAGES` for these two, `ALL_PAGES` for the tests and the a11y spec, which checks no nav link is current on them); the footer links to `/credits/` on every page and carries the Oklahoma CC BY line, so the attribution travels with every page; `/uninstalled/` links privacy, support and an optional public issue | A nav entry for credits (clutter); a markdown page (the site has no markdown pipeline) |
| The Oklahoma notice | The credits page carries NOTICE.md's three table rows and its "changes made" sentence verbatim and links the notice; the listing's detailed description carries the one-sentence attribution with the credits URL; the root README's Credits gains the same | Only a link to NOTICE.md (CC BY wants the attribution where the product is offered) |
| The popup's credits link | `keys.ts:siteUrl(endpoint, path)` and `CREDITS_URL`; the popup footer shows "About AI Checkout: credits and data sources" in hosted builds only (the plan's gap table: "the popup's About line links to credits"); `PRIVACY_POLICY_URL` in `telemetry-contracts.ts` was left as it is | No popup link (the attribution would then exist only on the site and listing) |
| Reviewer instructions | A "short version" paragraph for the dashboard field plus the manual script; the $3.00 / $1.50 two-card demonstration kept at "Another U.S. online store" (eligible online retail at the generic profile), dated to the catalog in effect | Dropping the arithmetic (reviewers need a concrete expected result) |

## Decision
As in the table.

## Consequences
- `npm test` now refuses stale wording in the public release material and `npm run release:docs:check:release` is a 15.7 gate; both are in `docs/release/README.md`.
- Evan's items: supply the support email (replace `SUPPORT_EMAIL_TBD` in six files: the three release docs, `apps/site/src/pages.tsx` twice, and `docs/release/README.md`'s table), confirm the publisher name and the non-trader declaration, read the policy before submission.
- The committed store media still show 2.0.0 and the three-store flow; 15.6 regenerates them and the home page's `SCREENSHOTS` alt text must then be updated with them.
- The README's demo video still shows the old flow (15.6 re-records or retires it).

## Status
Accepted 2026-10-20 (implementer, within the plan; agent-verified by the gates).
