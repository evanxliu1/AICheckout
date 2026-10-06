---
type: Decision
title: Capture tool design choices (Phase 12.2)
description: Where the signed reader protocol left room in the 12.2 capture tool: a guarded driver object with no typing or coordinate path, isolated-world inspection at the click point, structural rules for allowlisted in-form clicks plus a multilingual refusal of order, payment and account controls, guards on form submissions, writes, redirects and off-site navigation, MHTML as the replay format with styles read lazily, robots.txt on every origin navigation, stop detection, a token-and-Origin control server without run-time allowlisting, locale and currency metadata, and attended-pane capture deferred by Evan.
status: accepted
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T23:05:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
---

# Capture tool design choices (2026-10-05)

## Context
The signed [protocol](../../docs/evals/generic-reader-protocol.md#capture-posture) (`generic-reader-protocol.1`) fixes what the capture tool must refuse and record. The [Phase 12 plan](../product/phase-12-reader-eval.md) 12.2 row adds the snapshot format and the reader's replay hook. The Phase 10 probe driver showed what goes wrong when the rules sit with the operator ([report](../../docs/evals/merchant-probe-2026-10.md#deviations-and-limits)). On 2026-10-05 Evan widened the scope through the coordinator: storefronts worldwide, and attended capture of robot-blocked sites in the desktop browser pane. The protocol amendment for those (`generic-reader-protocol.2`) is written on another branch; this tool doesn't edit the protocol.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| How to make forbidden actions impossible | Check arguments of a general Playwright wrapper; expose a small object | A frozen API object (`goto`, `click`, `wait`, `snapshot`, `status`, `end`) behind a Proxy: any other name throws a `RefusalError` naming the refusal, and a source-scan test proves no tool file calls `fill`, `type`, `press`, `keyboard`, `mouse`, `selectOption`, `setInputFiles`, `tap`, `dblclick`, `dispatchEvent` or a click `position` |
| Telling add-to-cart from a promo or sign-in submit | English name patterns; structure | Structure first, so it works in any language: an allowlisted control inside a form is clicked only if the form has no visible text, e-mail or password field (number fields allowed for quantity). Name and form-action patterns only refuse, never permit. After review: every click is refused if its accessible name looks like placing an order, paying, buying now, an express-pay button, signing in or registering, in ten languages; add-to-cart is refused when its effective form action (`formaction` first, read from attributes) has a checkout, order, payment, pay, purchase, buy, login, account or register segment (Magento's `/checkout/cart/add` allowed), and is clicked only on a recipe product page. Cost: a cart form with an order-notes box blocks the increment control, so `cart-qty2` comes from a second add-to-cart or is `not-reached`; a "continue shopping" link worded with one of the refused words is refused too |
| Where the click facts come from (review) | Main-world evaluate; isolated world | CDP isolated world on the node at the click point (`DOM.getNodeForLocation`), walked up to its control, so prototype patches by the page change nothing and the inspected node is the one that receives the click. A point in a child frame's document is a frame refusal. Playwright's accessibility snapshot refuses text boxes, comboboxes and options that have no box |
| Submit-typed buttons (review) | Every typeless `<button>` is a submit; only with a form owner | Only with a form owner. `option`, `quantity-increment`, `close-popup` and `decline-cookies` may click a submit-typed button in a text-free form, and any navigation during that click is aborted |
| Writes and GET form submissions (review) | Navigations only; all requests | Same-site non-GET fetch or XHR is aborted outside an allowlisted add-to-cart or increment click and logged. A GET navigation whose CDP reason is a form submission counts as a submission |
| Form submits by page script | Trust the click checks; guard the network | A route guard aborts any form-submitting top-level navigation outside a 15 s window opened by an allowlisted add-to-cart click (tested with buttons whose scripts submit a POST and a GET form). Service workers are blocked so every navigation passes the guard |
| Off-site navigation | Refuse all; allow a recorded first page | `goto` never leaves the domain. A click that does loads that one page. Playwright routes only the first URL of a redirect chain, so after every action the tool checks where the page landed: the first off-site landing sets the session off-site (redirect, or an add-to-cart POST answered by a 303), a second off-site host stops the site. Off-site, every navigation is aborted and only `checkout-1` may be snapshotted. The host is recorded as the third-party checkout only when `checkout-1` was captured there, so a regional redirect stays an event |
| Replay format | A full computed-style dump (probe); MHTML | MHTML from CDP. Chrome reloads it with stylesheets and open shadow roots and without scripts (verified in the fixture test), so a reader reads styles lazily from live layout. `dom.json` reads styles only on elements with their own text, for labellers |
| robots.txt statuses (protocol silent) | RFC 9309 throughout; conservative | 404 and other 4xx mean no rules (RFC 9309). 401/403 and 429 stop as `blocked-http-403` / `blocked-http-429`, since a site refusing robots.txt to the browser is blocking it. **5xx or no answer stops the session as `tool-error`**: RFC 9309 would assume disallow-all, and `tool-error` permits the protocol's one later session instead of excluding the site. After review, the rules are also applied to every top-level navigation on the recipe's origin host (redirect landings included), never to other hosts; user-agent lines match on the product token before `/`; non-ASCII rule paths are percent-encoded. Both the `*` group and the `AICheckoutCapture` group apply, as the protocol says, which is stricter than RFC group selection. `Disallow: /` excludes even with narrower Allow lines |
| Sign-in wall | Any visible password field; login route only | A login route (several languages) with a visible password field. A sign-in form beside guest checkout is not a wall and is never touched |
| CAPTCHA detection | Any captcha frame; visible only | Challenge frames by URL, ignoring reCAPTCHA `size=invisible` badges |
| Operator sessions | No server (recipes only); token-protected server | A server (`serve`), because recipes need a live session to be written and the protocol allows one session per site. 127.0.0.1, random port, 32-byte token, no request with `Origin` or `Sec-Fetch-*`, Host pinned, JSON only, one command at a time. After review, an operator session cannot add to the allowlist: it is the recipe's, written before the session. The session writes `recipe.recorded.json` for the operator to commit |
| Committed text (review) | Free-text details; codes only | Stop details are reason codes, events carry kind and host, and committed URLs drop query strings and fragments and replace token-like path segments with `:token` |
| Stop checks (review) | After actions; also before | Also before every `goto` and click, so a wall that appears after load is caught; visible challenge elements in the main document (`#px-captcha`, `[class*=captcha]`, Turnstile) stop as `captcha`, ignoring the reCAPTCHA badge |
| Test pace | Real 3 s in tests; shorter for fixtures | A pace below 3 s is accepted only when the recipe's origin is 127.0.0.1 |
| Global storefronts (Evan, 2026-10-05) | — | Recipes accept any country's domain and language; snapshots record `lang`, a region from `lang`, `og:locale` or `geo.region`, and currency markers (ISO codes from price metadata, symbol and code counts). Metadata only; no amount is read |
| Attended pane capture (Evan, 2026-10-05) | — | **Deferred by Evan (2026-10-05)** to a later step through Claude's built-in browser; nothing is built for it. The robot's blocked-site records stay listable (`capture.mjs list-blocked`) |

## Decision
As chosen above, in `capture-tool.1` (`evals/merchants/capture/`), with recipe `capture-recipe.1`, snapshot `capture-snapshot.1` and site record `capture-site-record.1`.

## Consequences
- 12.3 operators write recipes through `serve` sessions and commit `recipe.recorded.json` and `site-record.json`. Snapshots, robots copies and the profile stay gitignored.
- The text patterns for bot walls are a backstop; an unrecognised wall is ended by the operator with its code and screenshot evidence.
- Attended capture of blocked sites is deferred; until a later step builds it, blocked sites are excluded as the signed protocol says, and `list-blocked` lists them.
- Phase 13's harness loads snapshots through `openReplay`, which checks the manifest hash against the frozen value.

## Status
Proposed 2026-10-05 by the Phase 12.2 builder (claude-code/claude-opus-5-5). The independent review of 2026-10-05 required changes (agent-verified); they are applied, each with a fixture test that fails without it. Accepted 2026-10-05: the reviewer's re-review approved (agent-verified), with two low fixes applied (image-only control names, a discriminating isolation fixture). The robots and stop-order rows are amended by [reconnaissance session and robots posture](2026-10-06-capture-recon-and-robots.md) (2026-10-06, `capture-tool.2`).
