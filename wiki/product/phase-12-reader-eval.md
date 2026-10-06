---
type: Product
title: Phase 12 plan (reader eval protocols and captures)
description: Pre-register the generic cart reader evaluation (splits, states, labels, bounds, peek policy, capture posture, Y = 80%), select the merchant-pipeline held-out domains, build a capture tool that cannot type or submit, and capture and label up to 220 retail sites worldwide (U.S. and non-U.S. halves; the reader must return total and currency) in three site splits — in three PRs.
status: stable
tags: [product, plan, phase-12, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T23:10:00Z
sources:
  - resource: phase-10-merchant-expansion.md
    title: Merchant coverage plan (Phases 10–17)
  - resource: phase-10-feasibility-probe.md
    title: Phase 10 plan (probe)
  - resource: ../../docs/evals/merchant-probe-2026-10.md
    title: Phase 10 probe report
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design (real-page evaluation)
---

# Phase 12 plan: reader eval protocols and captures

Started 2026-10-05 after Evan accepted the [Phase 10 probe](../../docs/evals/merchant-probe-2026-10.md) verdict (go, fragile for top retailers) and **Y = 80%** on 2026-10-05 ([merchant coverage plan](phase-10-merchant-expansion.md)). Phase 12 fixes how the generic reader (Phase 13) will be judged **before** any reader code is tuned, and builds the page set it is judged on. No product code.

## What the probe changes

| Probe finding | Consequence here |
| --- | --- |
| About half the top-1k retailers block a logged-out automated visit | Sample 400 candidates (200 U.S., 200 non-U.S.) to land up to 220 captured sites; report the blocked share per rank band and region; blocked sites are a reported gap (attended capture deferred, Evan 2026-10-05); the splits are stratified on captured sites, so the top band is thinner and the report says so |
| No cart summary was in a shadow root; one checkout summary was in a cross-origin iframe | Shadow DOM stays a variant and an observed state, not a stratum the splits must fill; iframe summaries are labelled "not readable" (correct answer `none`) |
| Labels corrected after a reader run went the reader's way | Labels are frozen per split before the reader ever runs on that split; any later change is a dated erratum reported beside the original score |
| The prototype driver could click submit and in-form buttons | The capture tool refuses them except an add-to-cart allowlist, has no typing or coordinate-click path, and its control server needs a token and Origin check; tests prove each refusal |
| Some states need typing (gift card codes, ZIP for tax estimates) | Captured only where the site shows them without input; otherwise produced as offline variants of real snapshots, labelled separately and reported apart from real pages |

## Global scope (Evan, 2026-10-05)

Before any capture, Evan widened the reader's job: it must return the cart total **and its currency** on storefronts worldwide, so the evaluation includes non-U.S. stores. Card recommendations for non-USD purchases (FX conversion, foreign transaction fees) are a later phase. The protocol became `generic-reader-protocol.2` ([decision](../decisions/2026-10-05-global-reader-protocol-2.md)): worldwide frame `retail-frame.2`, two candidate streams, strata band × region group × platform, currency in the labels and in correctness, locale variants, and the pass bar on the whole held-out split with U.S. and non-U.S. reported apart. The same day Evan considered, then deferred, attended capture of bot-walled sites (Claude driving its built-in browser, Evan solving CAPTCHAs); blocked sites stay a reported gap.

## Merchant-pipeline protocol scope (coordinator's call)

The full merchant-pipeline protocol needs the category-evidence rules (D5), which Evan moved to Phase 14. Phase 12 only **selects and freezes the held-out domain list** for the merchant pipeline (so no prompt is ever tuned on it); the adjudicated held-out profiles and the rest of that protocol are written at the start of Phase 16, before any drafting.

## Steps (three PRs)

| PR | Branch | Delivers | Verify |
| --- | --- | --- | --- |
| 12.1 | `phase12-protocol`, amended on `phase12-protocol-v2` | `docs/evals/generic-reader-protocol.md`: site sampling and three splits by site (development, held-out A, held-out B, each about 50–65 sites in `.1`, about 73 worldwide in `.2`, stratified by rank band and platform, plus region group in `.2`); states by how they arise (action: 1 item, quantity 2, 2 items, mini-cart, cart, first checkout page, empty; observed: sale strikethrough, promo banner, price carousel, installment widget, free-shipping progress, shadow DOM, third-party or iframe checkout; offline variants: class renames, injected promo rows, a fake "Subtotal" outside the summary, injected instruction text, credit applied); labels (two independent labelers, an adjudicator who never labelled, agreement reported, freeze before any run); scoring (found-correct, false found, ask, none; Wilson and rule-of-three bounds at page-state and site level); **Y = 80%** on held-out one-item cart pages with zero false found first; the peek policy (held-out A at most twice in total, failures analysed by class only); capture posture (robots and terms recorded, rate limits, exclusions reported). Merchant-pipeline held-out domain list frozen | An independent reviewer subagent signs the protocol before 12.3 starts |
| 12.2 | `phase12-capture-tool` | Capture tool (`tools/` or `scripts/`, Playwright, persistent non-Evan profile, gitignored output) with per-site recipes as data; refuses typing, submit and in-form clicks other than add-to-cart, coordinate clicks and cross-origin frames; local control server with token and Origin check; snapshot format (DOM with computed styles read lazily, MHTML, screenshot, headers, hashes) and the reader's replay hook | Unit tests for every refusal; a fixture-site run; independent review |
| 12.3 | `phase12-captures` | Candidate lists (CrUX country lists ∩ retail since `.3`, most popular first, 200 U.S. and 200 non-U.S. over 24 countries, captured Phase 10 sites in development only), captures with an exclusion list, split assignment, two labelers and an adjudicator per split, labels frozen; offline variants generated; `docs/evals/reader-captures-2026-10.md` (counts per split, state and band; blocked share; agreement) | Labels of all three splits frozen and hashed before any reader run; independent review, which also checks exclusion evidence and that recipe paths are the site's own cart and checkout; snapshots gitignored, committed text-free |

The probe's 25 sites may join the development split only (their labels were seen while a reader was being changed).

## Safety and copyright

As in [Phase 10](phase-10-feasibility-probe.md#safety-and-copyright), enforced by the tool: never sign in, create accounts, type, submit a form other than add-to-cart, place orders, solve CAPTCHAs or bypass bot walls (attended capture with Evan solving CAPTCHAs is deferred, not authorized); never change the storefront's country or currency; one site at a time, rate-limited; snapshots, screenshots, candidate lists from third parties and the profile stay gitignored; committed are URLs, dates, hashes, recipes, labels and quotes of 25 words or fewer.

## Progress

- **12.1 built (2026-10-05, branch `phase12-protocol`):** [`docs/evals/generic-reader-protocol.md`](../../docs/evals/generic-reader-protocol.md) (`generic-reader-protocol.1`); frozen retail frame `evals/merchants/retail-frame.json` (Tranco 647LX, 457 eligible of 670; bands only, SHA-256 `e5139826…6886`); merchant-pipeline held-out list `evals/merchants/pipeline-heldout-domains.json` (60 domains, 6 / 27 / 27; SHA-256 `6bc92515…79b2`), allowed to overlap the reader splits; seeded selection script `evals/merchants/tools/seeded-selection.mjs` (held-out list, candidate order, split assignment, frame check). Choices in the [decision](../decisions/2026-10-05-reader-eval-protocol.md). Independent review 2026-10-06: sign with fixes (agent-verified), fixes applied; Evan decided the robots posture. Signed at `e28a901` and merged as PR #59 (`84bc529`).
- **12.1 amended (2026-10-05, branch `phase12-protocol-v2`):** `generic-reader-protocol.2` on Evan's global decision ([decision](../decisions/2026-10-05-global-reader-protocol-2.md)): frame `evals/merchants/retail-frame-2.json` (`retail-frame.2`, 1,669 domains, 989 eligible: 480 U.S., 509 non-U.S. in 54 other regions and 42 other currencies; SHA-256 `659dae60…5312`, with a `family` field, built by the committed `tools/build-retail-frame-2.py` from `frame-2-inputs/`); `evals/merchants/item-price-bands.json` (`644f0d12…9b1c`); `evals/merchants/currency-minor-units.json` (`f5ce0863…dd48`); `seeded-selection.mjs` with two streams of 200 (output `a9e82579…3f67`) and band × region group × platform strata; held-out list unchanged (`6bc92515…79b2`). Independent review 2026-10-05 at `ca4dbac`: sign with fixes (agent-verified), fixes applied. **Signed at `3028fff`** by the independent reviewer (agent-verified); last fixes: no per-domain answer lookup by the reader, minor-unit basis text.

- **12.2 built (2026-10-05, branch `phase12-capture-tool`):** capture tool `evals/merchants/capture/` ([README](../../evals/merchants/capture/README.md)): recipes as Zod-validated data (`capture-recipe.1`), a driver whose only page API is `goto`, `click`, `wait`, `snapshot`, `status` and `end`, refusals for typing, keys, `<select>`, files, coordinates, submit and in-form clicks outside the allowlist, script form submits, frames and off-site navigation; stops with codes on 403/429, CAPTCHA frames, bot-wall and extension-check wording and sign-in walls; robots.txt checked before any page; 3 s pace, 25 navigations, one site and one session per site; `serve` mode behind a token-and-Origin control server; snapshot `capture-snapshot.1` (MHTML replay, `dom.json` with lazily read styles, screenshots, headers, hashes, lang, region and currency markers) and the replay hook `replay.mjs`; text-free `site-record.json`. Tests: unit (`npm run test:scripts`) and browser tests on a 127.0.0.1 fixture shop (`npm run test:capture:browser`, added to CI), including the end-to-end run that proves only the add-to-cart form was posted and the promo-code and sign-in forms were untouched. Choices in the [decision](../decisions/2026-10-05-capture-tool-design.md). Scope added by Evan on 2026-10-05: storefronts worldwide (built: no U.S.-only assumption, locale and currency metadata) and attended capture of blocked sites in the desktop browser pane (deferred by Evan on 2026-10-05 to a later step through Claude's built-in browser; nothing built; `capture.mjs list-blocked` lists blocked sites). Independent review 2026-10-05: changes required (agent-verified), all applied with failing-first fixture tests; re-review approved (agent-verified) with two low fixes applied; [decision](../decisions/2026-10-05-capture-tool-design.md) accepted. Next: PR.
- **12.1 amended again (2026-10-05, branch `phase12-protocol-v3`):** `generic-reader-protocol.3` (**signed at `b232d0e`**, agent-verified) on Evan's request that the test set be the most popular retailers by actual visits, U.S. and non-U.S. ([decision](../decisions/2026-10-05-crux-frame-protocol-3.md), proposed): frame `evals/merchants/retail-frame-3.json` (`retail-frame.3`, Chrome UX Report 2026-08 lists of the U.S. and 24 countries, 2,115 eligible: U.S. 102 top-1k + 396 1k-5k, non-U.S. 1,617 top-1k; SHA-256 `2b8c7658…0463`), built byte for byte by `tools/build-retail-frame-3.py` from gitignored CrUX copies and committed `frame-3-inputs/` (nine subagent classification batches, the builder's reconciliation); candidates most popular bucket first, the non-U.S. stream round-robining countries; family lock in the split; `seeded-selection.mjs` `516e257b…e26a`. Frames 1 and 2 and the held-out list unchanged. Independent review at `95f4124`: sign with fixes (agent-verified), applied: operator table and operator lock in the split, entry host, persistence on the 2026-02 lists, `no-fixed-price-cart-or-members-only`, `carrier-device-shop`, more `sensitive-goods`, hottopic.com added; re-check at `f7ac5ed`: persistence passes on either the 2026-02 or 2026-05 list and counts `www.`/`m.`/`mobile.` host variants (166 sites rescued); now 1,861 eligible (U.S. 99 top-1k + 326 1k-5k, non-U.S. 1,436), frame `cdd1695b…b28e`, script `938bee15…5052`, candidates `fd01a31f…8ce7`. Evan accepted the choices in chat (2026-10-05). **`.3` binds once the reviewer signs; `.2` binds until then.**

Done when all three PRs are merged; Phase 13 (reader v1) then tunes on the development split only.

## Related

* [Merchant coverage plan](phase-10-merchant-expansion.md)
* [Phase 10 probe report](../../docs/evals/merchant-probe-2026-10.md)
* [Merchant coverage design](../system/merchant-coverage-design.md)
