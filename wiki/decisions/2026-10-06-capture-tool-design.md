---
type: Decision
title: Capture tool design choices (Phase 12.2)
description: Where the signed reader protocol left room in the 12.2 capture tool: a guarded driver object with no typing or coordinate path, structural (language-neutral) rules for allowlisted in-form clicks, a route guard that aborts form-submitting and off-site navigations, MHTML as the replay format with styles read lazily, robots.txt status handling, stop detection, a token-and-Origin control server for operator sessions, locale and currency metadata, and the attended-pane capture not built.
status: proposed
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T08:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
---

# Capture tool design choices (2026-10-06)

## Context
The signed [protocol](../../docs/evals/generic-reader-protocol.md#capture-posture) (`generic-reader-protocol.1`) fixes what the capture tool must refuse and record. The [Phase 12 plan](../product/phase-12-reader-eval.md) 12.2 row adds the snapshot format and the reader's replay hook. The Phase 10 probe driver showed what goes wrong when the rules sit with the operator ([report](../../docs/evals/merchant-probe-2026-10.md#deviations-and-limits)). On 2026-10-06 Evan widened the scope through the coordinator: storefronts worldwide, and attended capture of robot-blocked sites in the desktop browser pane. The protocol amendment for those (`generic-reader-protocol.2`) is written on another branch; this tool doesn't edit the protocol.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| How to make forbidden actions impossible | Check arguments of a general Playwright wrapper; expose a small object | A frozen API object (`goto`, `click`, `wait`, `snapshot`, `status`, `end`) behind a Proxy: any other name throws a `RefusalError` naming the refusal, and a source-scan test proves no tool file calls `fill`, `type`, `press`, `keyboard`, `mouse`, `selectOption`, `setInputFiles`, `tap`, `dblclick`, `dispatchEvent` or a click `position` |
| Telling add-to-cart from a promo or sign-in submit | English name patterns; structure | Structure first, so it works in any language: an allowlisted control inside a form is clicked only if the form has no visible text, e-mail or password field (number fields allowed for quantity). Name and form-action patterns (several languages) only refuse, never permit. Cost: a cart form with an order-notes box blocks the increment control, so `cart-qty2` comes from a second add-to-cart or is `not-reached` |
| Form submits by page script | Trust the click checks; guard the network | A route guard aborts any non-GET top-level navigation outside a 15 s window opened by an allowlisted add-to-cart click (tested with a button whose script submits the newsletter form). Service workers are blocked so every navigation passes the guard |
| Off-site navigation | Refuse all; allow a recorded first page | `goto` never leaves the domain. A click or redirect that does loads that one page; afterwards every navigation is aborted and only `checkout-1` may be snapshotted. The host is recorded as the third-party checkout only when `checkout-1` was captured there, so a regional redirect stays an event |
| Replay format | A full computed-style dump (probe); MHTML | MHTML from CDP. Chrome reloads it with stylesheets and open shadow roots and without scripts (verified in the fixture test), so a reader reads styles lazily from live layout. `dom.json` reads styles only on elements with their own text, for labellers |
| robots.txt statuses (protocol silent) | RFC 9309 throughout; conservative | 404 and other 4xx mean no rules (RFC 9309). 401/403 and 429 stop as `blocked-http-403` / `blocked-http-429`, since a site refusing robots.txt to the browser is blocking it. 5xx or no answer stops as `tool-error` (RFC 9309 would assume disallow-all; `tool-error` permits the protocol's one retry). Both the `*` group and the `AICheckoutCapture` group apply, as the protocol says, which is stricter than RFC group selection. `Disallow: /` excludes even with narrower Allow lines |
| Sign-in wall | Any visible password field; login route only | A login route (several languages) with a visible password field. A sign-in form beside guest checkout is not a wall and is never touched |
| CAPTCHA detection | Any captcha frame; visible only | Challenge frames by URL, ignoring reCAPTCHA `size=invisible` badges |
| Operator sessions | No server (recipes only); token-protected server | A server (`serve`), because recipes need a live session to be written and the protocol allows one session per site. 127.0.0.1, random port, 32-byte token, no request with `Origin` or `Sec-Fetch-*`, Host pinned, JSON only, one command at a time. The session writes `recipe.recorded.json` for the operator to commit |
| Test pace | Real 3 s in tests; shorter for fixtures | A pace below 3 s is accepted only when the recipe's origin is 127.0.0.1 |
| Global storefronts (Evan, 2026-10-06) | — | Recipes accept any country's domain and language; snapshots record `lang`, a region from `lang`, `og:locale` or `geo.region`, and currency markers (ISO codes from price metadata, symbol and code counts). Metadata only; no amount is read |
| Attended pane capture (Evan, 2026-10-06) | — | **Not built.** Writing the pasteable chunked serializer was refused by the session's permission classifier, so the importer and the attended-candidate list were not built either. It needs Evan's explicit permission in a session that allows it |

## Decision
As chosen above, in `capture-tool.1` (`evals/merchants/capture/`), with recipe `capture-recipe.1`, snapshot `capture-snapshot.1` and site record `capture-site-record.1`.

## Consequences
- 12.3 operators write recipes through `serve` sessions and commit `recipe.recorded.json` and `site-record.json`. Snapshots, robots copies and the profile stay gitignored.
- The text patterns for bot walls are a backstop; an unrecognised wall is ended by the operator with its code and screenshot evidence.
- The attended-pane path for blocked sites is open until Evan decides; until then blocked sites are excluded as the signed protocol says.
- Phase 13's harness loads snapshots through `openReplay`, which checks the manifest hash against the frozen value.

## Status
Proposed 2026-10-06 by the Phase 12.2 builder (claude-code/claude-opus-5-5), pending independent review.
