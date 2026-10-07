---
type: Decision
title: Reconnaissance session and disallow-all-only robots rule (generic-reader-protocol.4)
description: After a five-site pilot captured nothing, Amendment 3 makes robots.txt exclude a site only when it disallows everything (Evan, 2026-10-06), adds a look-only reconnaissance session that finds the listing, first in-band item and real cart path by fixed rules before the one capture session, aligns the capture tool's exclusion codes, per-host robots checks, stop order and platform states with the protocol, and re-visits the four pilot sites excluded only by the retired path rule.
status: accepted
tags: [decision, phase-12, merchants, eval, capture, robots]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 3)
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
  - resource: 2026-10-05-capture-tool-design.md
    title: Capture tool design choices
---

# Reconnaissance session and robots posture (2026-10-06)

## Context
The 12.3 pilot on 2026-10-06 (first three U.S. and first two non-U.S. candidates, `generic-reader-protocol.3`, `capture-tool.1`) captured no site. Four were excluded as `robots-disallow-path`: hollisterco.com and conforama.es on cart or checkout paths the operator had to name before the only session, from knowledge; disneystore.com and extra.com because their real cart paths are disallowed. ebay.com stopped on a CAPTCHA. The tool showed five gaps: recipes are written blind, the exclusion codes were `.1`'s and `end` could not record every code, robots.txt was read only on the entry host, a robots refusal on a redirect landing came before the stop check (so eBay's challenge page could be snapshotted as `terms`), and platform detection read every snapshot ([Phase 12 plan](../product/phase-12-reader-eval.md#progress)).

On 2026-10-06 Evan decided in chat to relax the robots rule: a site is excluded only if its robots.txt disallows everything for `*` or for the tool's own user agent; cart and checkout path disallows (and terms clauses) are recorded and reported, not excluding. His reasoning: nothing wrong is being done and nothing is bought. The tool keeps identifying itself by its own token, and every other safety rule stays.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| How a recipe stops being blind | Allow a second capture session after a wrong guess; a separate look-only session first; let the capture session discover paths as it goes | **A look-only reconnaissance session per site**, logged and committed apart from the capture session. A second capture session would weaken the one-session rule the protocol uses against retrying after blocks; discovering paths mid-session makes the item the operator's choice |
| Making the item rule a rule, not a choice | Operator judgement; fixed rules for listing, order, price and stock | **Fixed rules** in the protocol: the listing is the first of the home page's navigation links (then other links, at most six, one step into main content each) that shows at least four priced product tiles; tiles in document order of the settled `view-NN` snapshot; current tile price (never struck, range at its lowest, member prices ignored) inside the currency's band; the product page must show it in stock and in band; cart path from the header cart link. No search, no scrolling |
| Enforcing that recipes come from the reconnaissance | Trust the operator; tool checks | **Tool checks**: findings are accepted only for pages the session loaded (listing, each item, cart path); the draft recipe names the session; a capture session refuses a recipe whose session did not end with findings or never loaded its URLs. Loopback fixtures without a `recon` field are exempt for tests |
| What the reconnaissance may do | Same API as capture; look-only | **Look-only**: `goto`, plain clicks, waits, `view-NN` snapshots; purposes only `close-popup` and `decline-cookies`; a click on a control named like add-to-cart refused (backstop to the existing same-site write guard) |
| robots.txt (Evan) | Keep the path rule; disallow-all only | **Disallow-all only**, for `*` or `AICheckoutCapture`, on the entry host and on every other host of the site a session loads (fetched before that host's first page; after the stop check when a redirect lands there). Disallowed paths load and are recorded (recipe `checkedPaths`, a `robots-disallowed-path` event, `robotsAllowed` per state). `robots-disallow-path` retired |
| Cart hosts outside the frame's `hosts` (eBay's `cart.ebay.com`) | Deviation; allowed when the site itself links or redirects there | **Allowed for cart and checkout pages** the site serves on another host of the same registrable domain, recorded with the state; listing and product URLs stay on `hosts` |
| Stop order on a landing | Robots, then stops; stops first | **Stops first** after every action, and a stop check before every snapshot, so no challenge page is snapshotted (fixture test: a redirect onto a challenge page on a disallow-all host stops as `captcha`) |
| Exclusion codes | Keep the tool's list; the protocol's list | **The protocol's `.4` list** (`geo-blocked`, `redirected-off-domain` added; `non-us-storefront`, `robots-disallow-path` gone); `end` may record any, `tool-error` leaving the site `incomplete` |
| Platform states | Every snapshot; the protocol's fixed states | **`empty-cart` and `cart-1` (else `minicart-1`)**, plus the `checkout-1` host; the `.3` `other-detected` markers added |
| The four sites excluded by the path rule | Keep the exclusions; re-visit | **Re-visit under `.4` in original order**: the exclusion was rule-driven, not page-driven, and their `.3` sessions do not count toward the one-session rule (their gitignored pilot data is set aside under `data/.pilot-protocol-3/`). ebay.com's `captcha` stands: a block is page-driven and allows no second session |

## Decision
`generic-reader-protocol.4` (Amendment 3, process only) with `capture-tool.2`: recipe `capture-recipe.2` (with `recon`), site record `capture-site-record.2` (`recon`, `robotsHosts`, `robotsAllowed`), reconnaissance record `capture-recon-record.1`, `capture.mjs recon <domain>`.

## Consequences
- Each site costs two sessions (up to 25 navigations each), still one site at a time at a 3 s pace.
- Sites whose robots.txt disallows cart or checkout paths now enter the sample; the report gives how many, so readers of the results can judge the posture.
- The listing rule is mechanical, so on some sites the first navigation link is a narrow category (sale, new arrivals); that is accepted, since it is not chosen by anyone.
- The rule texts are a backstop for a careful operator; the 12.3 reviewer can check each recipe against the reconnaissance `view-NN` snapshots and `visited.json` (gitignored, kept).
- Found while aligning the tool: `platform.mjs` lacked the protocol's `.3` additions to `other-detected` (Shopware `/bundles/storefront/`, PrestaShop, Cafe24, MakeShop); added with a test, before any split is computed.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5). Independent review at `7070917` (2026-10-06): "sign with fixes" (agent-verified); applied with tests: recipe equals the findings exactly, home and listing `view-NN` required and the navigation order committed (12.3 reviewer MUST check recipes against them), frame `hosts` for listing and items, cart path checked against the cart host's robots.txt, disallow-all defined as `/` disallowed under longest match, narrower add-to-cart backstop, `add-to-cart-refused` without substitution when the fixed item is unavailable. The robots rule is Evan's decision in chat (2026-10-06); the rest awaits the independent reviewer's signature of `.4`. Amends the robots and stop-order rows of [capture tool design choices](2026-10-05-capture-tool-design.md). Re-check at `2eebbeb`: **signed `generic-reader-protocol.4`, `capture-tool.2` approved** (agent-verified); accepted. The robots posture is Evan's decision (chat, 2026-10-06).

For pane capture the robots row and the reconnaissance session are superseded by `.8` ([capture protocol 8](2026-10-06-capture-protocol-8.md)): robots.txt is recorded, never excluding, and there is no reconnaissance session. The rules stand for the robot captures made under `.4`–`.7`.
