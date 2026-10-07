---
type: Decision
title: Background writes and vendor challenge pages (generic-reader-protocol.6)
description: After capture batch 1 under .5, the coordinator decided (reversibly) to let the site's own same-site background writes through, logged, except to checkout/order/payment/sign-in/account/register paths and for 3 s after a non-add-to-cart click; to recognise common bot-management challenge pages by markup before any snapshot; to set aside hsn.com's two challenge-page views; and to confirm three operator readings of the listing and item rules.
status: accepted
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 5)
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
  - resource: 2026-10-06-capture-protocol-5.md
    title: Capture protocol .5
---

# Capture protocol .6 (2026-10-06)

## Context
Capture batch 1 under `.5` (2026-10-06 07:13–07:38 UTC, `capture-tool.3`) captured 3 of 10 final outcomes ([Phase 12 plan](../product/phase-12-reader-eval.md#progress)). Two tool problems showed up:
- **Write guard.** The same-site write guard aborted every non-navigation POST outside an add-to-cart or increment click, including the site's own data and GraphQL loads. That broke lego.com's cart page (only `minicart-1` was reached) and goofish.com's listings (`tool-error`). It may also explain blibli.com's redirect to its sign-in host.
- **Stop check.** It did not recognise hsn.com's Akamai `sec-if-cpt` interstitial. The operator took two `view-NN` snapshots of the challenge page before ending the session.

These are **the coordinator's decisions** (the coordinating session, claude-code/claude-opus-5-5), process only and reversible.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Same-site background writes | Keep aborting all; allow reads by endpoint allowlist; allow all writes except risky ones | **Allow the site's own writes, logged** (`background-write`, with method, host and masked path), with two exceptions. **Aborted:** writes to checkout, order, payment, sign-in, account or register path segments (`WRITE_BLOCKED_PATH`, on `actionPath` so Magento's `/checkout/cart/add` passes). **Also aborted:** every write during a click that is not an allowlisted add-to-cart or increment click and for **3 s** after it (`WRITE_BLOCK_MS`). Add-to-cart and increment clicks behave as before. Navigation POSTs stay under the form rules |
| Challenge pages without wording, frames or known elements | Operator judgement; vendor markers in the markup | **Vendor markers** in the first 300 kB of the document's markup, checked in the stop check (after every action and before every snapshot). Akamai, Cloudflare and Imperva give `blocked-bot-wall`; DataDome and PerimeterX/HUMAN give `captcha`. Sensor scripts that also load on ordinary pages are deliberately not markers. Kasada's challenge answers 429, which already stops |
| hsn.com's challenge-page views | Keep; set aside | **Set aside**, never labelled (`sites.json` `statusUnderProtocol6.setAsideViews`) |
| lego.com (`minicart-1` only) | Re-visit; stand | **Stands** under the session rule: the capture ended without `tool-error`, so no second session. It is outside the Y denominator |
| goofish.com (`tool-error`) | — | **Re-visited** on a later UTC day |
| blibli.com (`sign-in-required`, possibly the write guard) | Re-visit; stand | **Re-visited** on a later UTC day (coordinator, 2026-10-06), under Amendment 4's principle for exclusions a rule change would have affected; disclosed as a possible second draw, voided session kept. lego.com's capture stands: a captured site is never re-captured |
| Operator readings | — | **Confirmed in the protocol.** A listing with no in-band item passes to the next home-page candidate, not into its own links. The home page's self-link is not a candidate. An item needing a choice other than size or colour is not eligible |

## Decision
`generic-reader-protocol.6` (Amendment 5) with `capture-tool.4`. The record schemas are unchanged, except that event details may now contain `/` for masked paths.

## Consequences
- **Allowed writes:** a page's own background writes, which may include analytics beacons and session calls, now reach the site. Each is logged so the reviewer can see what went through. Writes the site makes on its own after page load (not after a click) are allowed unless their path is on the blocked list.
- **Broad path pattern:** `WRITE_BLOCKED_PATH` matches words anywhere in the path delimited by non-letters, for example "order" in `/sort-order`. That fails safe: such a write is aborted.
- **Unrecognised vendors:** a challenge page from a vendor not listed, or a new marker, still needs the operator to end the session.
- **Re-visits:** `.5`'s re-visits (hollisterco.com, extra.com) and goofish.com run under `capture-tool.4` with the new write policy.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5) on the coordinator's decisions. It awaits the independent reviewer's signature of `.6`; `.5` binds until then.

Signed: the independent reviewer signed `generic-reader-protocol.6` at `89bc619` and approved `capture-tool.4` on 2026-10-06 (agent-verified); accepted. Its low findings (tool-error rule for tool-caused missing states, separate background-write log cap, Turnstile marker note) go into `.7`.

Robot rules: the robot was retired as the main capture path by `.8` (2026-10-06, [capture protocol 8](2026-10-06-capture-protocol-8.md)); robot captures made under these rules stay valid.
