---
type: Decision
title: Coordinator's process changes after capture pilot 2 (generic-reader-protocol.5)
description: After pilot 2 captured one of five sites, the coordinator decided (reversibly) that checkout-1 is not a robot state but a reported gap, that the home view may sit on the same-site landing of a goto to the origin, that one navigating action counts as one top-level navigation, that a listing without a qualifying item passes to the next candidate link, and that an enabled add-to-cart control decides stock; pilot 2's sites get a status under .5.
status: proposed
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T07:30:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 4)
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
  - resource: 2026-10-06-capture-recon-and-robots.md
    title: Reconnaissance session and robots posture (.4)
---

# Capture protocol .5 (2026-10-06)

## Context
Pilot 2 under the signed `generic-reader-protocol.4` (2026-10-06 06:37–06:47 UTC, `capture-tool.2`) visited five sites. It captured disneystore.com, without `checkout-1`. loft.com hit a CAPTCHA. conforama.es was excluded `no-eligible-item` because its first listing had no in-band tile. hollisterco.com and extra.com ended `tool-error`: their `/` redirects on the same site, and the tool accepted a home view only at the exact origin URL. extra.com's single goto was counted as 8 top-level navigations. During Disney's capture the operator's environment refused a "Guest Checkout" click as a real-world transaction. That boundary is not worked around ([Phase 12 plan](../product/phase-12-reader-eval.md#progress)).

These are **the coordinator's decisions** (the coordinating session, claude-code/claude-opus-5-5), process only and reversible. They are not Evan's directives.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Home view when `/` redirects | Exact origin only; the landing of a goto to the origin | **The same-site landing of a goto to the origin**, with its server redirect chain and landing recorded (`homeLandings`). An off-site landing never counts |
| What a top-level navigation is | Every main-frame navigation request; one per navigating action | **One per action**: a `goto` or navigating click, plus every navigation the page makes before the next action, counts once. The old per-request count turned extra.com's script redirects into 8, which is treated as a counting defect. Requests are still recorded (`navigationRequests`), and an action that causes more than 10 is refused as a loop (`tool-error`) |
| `checkout-1` | Work around the environment's refusal; drop it from the robot | **Drop it.** It becomes a reported gap beside the bot-walled sites, deferred to the attended step. The checkout-host platform marker is dropped because it is not observable without entering checkout. The Y denominator was always `cart-1` only |
| A listing with no qualifying tile | Exclude; move to the next candidate link | **Move on** in the same mechanical order, within the six-candidate limit. `no-eligible-item` applies only when no candidate qualifies. The second item comes from the same listing, otherwise `cart-2items` is `not-reached` |
| Backorder: an enabled add-to-cart, but structured data says out of stock | Not in stock; the control decides | **The control decides**, and the mismatch is recorded (`stockMismatch` in the reconnaissance record, never in the recipe) |
| Pilot 2 sites | — | disneystore.com's capture **stands**. hollisterco.com and extra.com are **re-visited** (tool defect) as their one later session after `tool-error`, on a later UTC day. conforama.es is **re-visited** under the new listing rule (its pilot-2 data set aside). loft.com's `captcha` **stands** |

## Decision
`generic-reader-protocol.5` (Amendment 4) with `capture-tool.3`: recipe `capture-recipe.3`, site record `capture-site-record.3` (no third-party checkout host; `navigationRequests`) and reconnaissance record `capture-recon-record.2` (`homeLandings`, `stockMismatch`, `navigationRequests`).

## Consequences
- Every captured site reports `checkout-1` as a gap, so no robot result says anything about checkout pages until the attended step.
- More sites reach a listing, at the cost of more navigations. The six-candidate limit and the 25-action limit still bound each session.
- A site whose page keeps navigating by script stops as `tool-error` after 10 requests in one action rather than using up its navigation budget.
- The `continue-as-guest` purpose stays in the tool but has no use while no checkout is entered.
- The extra.com count of 8 is explained as script or client navigations, but this was not verified against the site (no site was visited for this change). The re-visit records `navigationRequests`.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5) on the coordinator's decisions. Independent review at `bc98c49` (2026-10-06): "sign with fixes" (agent-verified). Applied: no session enters a checkout (the `continue-as-guest` purpose retired, so the consequence about it above no longer holds; every off-site navigation refused and an off-site landing stops as `redirected-off-domain`; recipe checkout paths refused as targets and a landing on one stops); pilot-2 records of re-visited sites in `records/pilot-protocol-4/`; conforama.es's re-visit disclosed as a second draw, the same treatment for any future site a rule change would have affected; the reviewer MUST check each `stockMismatch`. Re-check at `bb005e7`: blocker B1 fixed with a generic checkout backstop (checkout wording refused on every click; `checkout`/`checkouts`/`secure-checkout` path segments refused or stopping, Magento `/checkout/cart` allowed). It awaits the independent reviewer's signature of `.5`; `.4` binds until then.
