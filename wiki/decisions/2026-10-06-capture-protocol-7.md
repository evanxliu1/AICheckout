---
type: Decision
title: Review findings on .6 (generic-reader-protocol.7)
description: The independent reviewer's four low findings on generic-reader-protocol.6 and capture-tool.4, applied as Amendment 6. A tool defect that prevents a protocol state ends the session as tool-error. Allowed background writes are counted apart from events. Invisible Cloudflare Turnstile is not a challenge. Blocked write paths also apply during add-to-cart clicks.
status: proposed
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T09:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 6)
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: 2026-10-06-capture-protocol-6.md
    title: Capture protocol .6
---

# Capture protocol .7 (2026-10-06)

## Context
The independent reviewer signed `generic-reader-protocol.6` at `89bc619` (agent-verified) with four low findings, sent through the coordinator.

## Options considered
| Finding | Options | Chosen |
| --- | --- | --- |
| L1: the operator could decide which rule applies after a tool defect, by ending a capture without `tool-error` | Leave it to judgement; require `tool-error` | **MUST end with `tool-error`.** lego.com's batch-1 capture stands unchanged, and its `cart-1` `not-reached` is reported as tool-caused in its own count |
| L2: allowed background writes could fill the 200-event list and push out robots, off-site and refusal events | Raise the cap; a separate list | **A separate `backgroundWrites` record**: an exact count plus up to 100 distinct masked details. Aborted writes stay events |
| L3: `cf-chl-widget` and `challenges.cloudflare.com` frames also appear with invisible Turnstile on ordinary pages | Keep; require a challenge-page context; drop | **Drop `cf-chl-widget`.** A Cloudflare frame now counts only when a visible iframe of it (> 30 px) is in the page. `_cf_chl_opt` and the challenge-page element ids remain markers |
| L4: blocked write paths were not checked during an add-to-cart click | Keep; apply them in the window too | **Apply them in the window too.** Tests confirm the common add-to-cart endpoints pass: Magento `/checkout/cart/add` (via `actionPath`), Shopify `/cart/add.js`, SFCC `Cart-AddProduct`, `/api/cart` and `/basket/add` |

## Decision
`generic-reader-protocol.7` (Amendment 6) with `capture-tool.5`, site record `capture-site-record.4` and reconnaissance record `capture-recon-record.3`.

## Consequences
- **Turnstile:** a visible Turnstile captcha still stops the site, through `.cf-turnstile` larger than 30 px or a visible frame. A visible challenge inside a closed shadow root with no visible container would be missed, and the operator ends the session.
- **Add-to-cart endpoints:** an add-to-cart endpoint whose path contains one of the blocked words (for example `/api/order/add-item`) is now aborted, so its site reaches no cart. That fails safe, and the session ends `tool-error` under L1 if the operator sees the defect.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5). It awaits the independent reviewer's signature of `.7`; `.6` binds until then.
