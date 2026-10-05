---
type: Product
title: Phase 10 plan (merchant feasibility probe)
description: A 25-site probe, no product code — top U.S. retail domains from Tranco or CrUX, stratified by rank band and platform, visited logged out in a separate Chrome profile to learn whether carts are readable without signing in, what blocks automation, how cart summaries are built and whether a prototype reader finds the total; ends in a go/no-go and a proposed reader target Y.
status: stable
tags: [product, plan, phase-10, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T19:40:00Z
sources:
  - resource: phase-10-merchant-expansion.md
    title: Merchant coverage plan (Phases 10–17)
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design (generic reader, real-page evaluation)
  - resource: https://tranco-list.eu/
    title: Tranco list (research-oriented top sites ranking)
---

# Phase 10 plan: merchant feasibility probe

Started 2026-10-05, in parallel with Phase 11 ([merchant coverage plan](phase-10-merchant-expansion.md)). Evan approved D4 (real-page capture) and D6 (merchant list) the same day ([decision](../decisions/2026-10-05-merchant-coverage-phases.md)). No product code: the output is a report that decides whether the generic-reader plan (Phases 12–13) holds.

## Questions the probe answers

| # | Question | Recorded per site |
| --- | --- | --- |
| Q1 | Can a logged-out visitor put one item in the cart and see a cart or checkout summary? | reached / blocked, cart visible, steps needed |
| Q2 | What stops automation? | bot wall or CAPTCHA (stop, never solve), cookie, location, newsletter or app prompts |
| Q3 | How is the summary built? | platform (Shopify, Salesforce Commerce Cloud, Adobe Commerce, BigCommerce, custom, …), open or closed shadow DOM, iframe summary, third-party checkout host, mini-cart vs cart page |
| Q4 | Can the badge frame show? | the cart page's CSP `frame-src`/`child-src` and whether it would block a `chrome-extension://` frame |
| Q5 | Does a prototype reader (design steps 1–3: summary region, total rows, distractors) find the total? | found / ask / none against the total a labeler subagent reads from the snapshot, and the run time |
| Q6 | Does a 2 MiB merchant database fit `chrome.storage.local`? | desk check, once |

## Method

1. **Site list.** Download the latest Tranco list (a public file, its list ID recorded for attribution) into a gitignored folder; an agent classifies the top domains into U.S. online retail of physical goods (sensitive categories, marketplaces of illegal goods and adult sites excluded), cross-checked against the NRF Top 100. Pick 25, excluding Amazon, Best Buy and Newegg, stratified: rank bands (top 1k, 1k–10k, 10k–100k), at least four platforms, at least two shadow-DOM storefronts and two third-party checkouts where found. CrUX is the fallback if Tranco cannot be fetched.
2. **Visits.** Playwright drives Chrome headed with a persistent profile under a gitignored path (never Evan's profile), logged out, one site at a time with pauses. Per site: home, one low-cost in-stock item (clicking a size or colour button is allowed), add to cart, open the cart and, if offered without sign-in, the first checkout page. Cookie banners: decline non-essential, or leave them.
3. **Snapshots.** Cart (and checkout) page as HTML with computed styles plus MHTML, headers, a screenshot, into a gitignored folder; hashes and URLs recorded.
4. **Prototype reader.** A throwaway script over the snapshots (in the gitignored probe folder or `scripts/`, not the extension), timed. One labeler subagent records the displayed total and its kind for each snapshot; a second checks it.
5. **Report.** `docs/evals/merchant-probe-2026-10.md`: the 25 sites (domain, rank band, platform; no page text beyond quotes of 25 words or fewer), answers to Q1–Q6, the exclusion list with reasons, the **go/no-go** under the stop rule (fewer than half with a logged-out cart → Evan re-decides scope before Phase 12) and a **proposed Y** (found-correct target for reader v1).

## Safety and copyright

Never sign in, create an account, type into any field (no ZIP codes, no email, no promo codes), submit a form, place an order, solve a CAPTCHA or bypass a bot wall; a site that demands any of these is recorded as blocked and left. Rate-limited, one site at a time. Snapshots, screenshots, the Tranco file and the profile stay gitignored; committed are URLs, dates, hashes, structural notes and short quotes.

## Steps

| # | Step | Verify |
| --- | --- | --- |
| 1 | Site list and gitignore entries | 25 sites meet the strata; list ID recorded |
| 2 | Visits and snapshots | every site has an outcome; nothing typed or submitted (the visit script has no fill or type calls) |
| 3 | Prototype reader and labels | results per site; labels checked by a second subagent |
| 4 | Report and wiki | report reviewed by an independent subagent; now, log, plan updated |

Done when the report is merged from branch `phase10-probe`. Evan then confirms go, or re-decides scope.

## Related

* [Merchant coverage plan](phase-10-merchant-expansion.md)
* [Merchant coverage design](../system/merchant-coverage-design.md)
