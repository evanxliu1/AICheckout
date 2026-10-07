---
type: Decision
title: Most-visited retailers by Chrome UX Report country lists (generic-reader-protocol.3)
description: Evan asked that the reader test set be the most popular retailers by actual visits, U.S. and non-U.S.; the frame moves from Tranco to the Chrome UX Report's per-country top lists (retail-frame.3), candidates are taken most popular bucket first, the non-U.S. stream round-robins 24 countries, sister storefronts are kept per country, and every operator (the company running the stores) is locked to one split; persistence, auction, members-only and carrier-shop exclusions added after review. Amends the signed reader protocol before any capture.
status: accepted
tags: [decision, phase-12, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (.3)
  - resource: 2026-10-05-global-reader-protocol-2.md
    title: Global reader protocol (.2)
  - resource: 2026-10-05-merchant-coverage-phases.md
    title: D6 merchant list (Tranco or CrUX ∩ agent-classified retail)
---

# Most-visited retailers by CrUX country lists (2026-10-05)

## Context
`generic-reader-protocol.2` was signed at `3028fff`. Its frame `retail-frame.2` ranked domains by the global Tranco list; outside the U.S. most of its sites came from the agent's own retailer lists, so the non-U.S. half was "brands an agent could name", not "what shoppers visit". On 2026-10-05 Evan asked in chat that the test set be **the most popular retailers and merchants by actual visits, U.S. and non-U.S.** D6 (approved 2026-10-05) already allows "Tranco or CrUX ∩ agent-classified retail". The protocol fixes the frames for good against builder amendments, so the change rests on Evan's request and needs a new signature. No capture, label or reader run exists.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Ranking source | Tranco global list (as `.2`); CrUX global list; CrUX country lists | **CrUX country lists**, month 2026-08 (`202608`): page loads by opted-in Chrome users, the extension's own browser; one list per country; CC BY 4.0 (Tranco's sources include CC BY-NC 4.0) |
| Countries | U.S. only plus a global list; ~20–25 large e-commerce markets | U.S. plus 24: GB DE FR IT ES NL PL SE TR, JP KR CN IN ID AU, CA MX BR AR, SA AE ZA NG EG |
| Depth classified | Top 10,000 everywhere; as deep as each stream needs | U.S. to bucket 5,000 (it needs the second bucket to reach 200), the others to bucket 1,000 (1,436 eligible non-U.S. sites, far above 200). 29,000 list rows, 21,593 hosts |
| Who classifies | One agent; parallel subagents under one rule sheet | Nine subagent batches under a committed rule sheet, from knowledge, no site visited; raw output committed; the builder reconciles in a committed file (one classification per domain, family slugs, rules unified) |
| Unit | Origin (CrUX's unit); registrable domain | Registrable domain as before; its band is its best storefront host's bucket in its **home list** (U.S. list for region US, else its region's list). Country subdomains of a global domain fold into its U.S. storefront |
| Sister storefronts (amazon.de, amazon.fr) | One per family worldwide (`.2`); one per family per country | **One per family per country**, since each is among its market's most visited |
| Shared store code across splits (review H1) | Lock a brand family to one split; lock an operator | **Operator lock**: `operators.tsv` maps families (and some domains) to the company running the stores (Williams-Sonoma Inc. for Pottery Barn, West Elm and Williams Sonoma; TJX for T.J. Maxx, Marshalls, HomeGoods and Sierra); the split keeps an operator in one split, and site-cluster bounds are also reported by operator. 1,861 eligible sites, 1,421 operators |
| Entry point (review M1) | Recipe author picks a host; frame names it | The frame's `entryHost` (best-ranked storefront host in the home list); recipes name only hosts in `hosts` |
| One-month spikes (review M2a) | Accept; persistence check | **Persistence**: in the 2026-02 **or** 2026-05 list of the same country, a storefront host (or that host with or without `www.`, `m.` or `mobile.`; no other subdomain) must be within the classified depth, else `not-persistently-popular` (177; seasonal retailers such as spirithalloween.com fall out by design). The reviewer's re-check at `f7ac5ed` added the second list and the host variants, rescuing 166 sites (dillards.com among them) |
| Auctions, MLM, members-only, carrier shops (review M2b, M2c) | Eligible; exclude | Excluded as `no-fixed-price-cart-or-members-only` (57, including flash-sale clubs that need sign-in) and `carrier-device-shop` (9); eBay and warehouse clubs stay |
| Candidate order | Seeded order over all buckets; most popular bucket first | Most popular bucket first, seeded key order within a bucket |
| Non-U.S. balance | Round robin over countries; weights by market size | **Round robin** (countries in `reader-country` key order): the reader's failures are locale-driven, so equal turns test the most locales, and market weights need a table outside CrUX. 200 candidates: 9 from each of 20 countries, SA 10, ID 5, CN 4, NG 1. Non-U.S. Y weights locales equally, not by market share; per-country figures are descriptive |
| Probe sites | Forced into the U.S. stream (`.2`); only on their popularity | On their popularity: 17 of 25 are candidates; captured ones still go to development |
| Regulated goods | Leave to capture's item rule; exclude in the frame | `sensitive-goods` code (firearms, ammunition and suppressors, tobacco, snus and vape, cannabis, alcohol stores and liquor boards; 31), since capture could never pick an item there |

## Decision
Amend the reader protocol to `generic-reader-protocol.3` ([Amendment 2](../../docs/evals/generic-reader-protocol.md#amendment-2-2026-10-05-generic-reader-protocol3)). Frame `evals/merchants/retail-frame-3.json` (`retail-frame.3`, SHA-256 `cdd1695b…b28e`; 2,890 domains, 1,861 eligible: U.S. 99 `top-1k` + 326 `1k-5k`, non-U.S. 1,436 `top-1k` in 24 countries, 21 currencies), built byte for byte by `evals/merchants/tools/build-retail-frame-3.py` from the gitignored CrUX copies of 2026-08, 2026-02 and 2026-05 (hashes pinned) and `evals/merchants/frame-3-inputs/` (`reconcile.tsv` and `operators.tsv` frozen; changes only by dated amendment). `seeded-selection.mjs` `938bee15…5052` (candidates output `fd01a31f…8ce7`). Frames 1 and 2, the held-out list (`6bc92515…79b2`), the seed, labels, scoring, pass bar, peek policy, roles and capture posture unchanged.

## Consequences
- The 12.3 capture visits the most-visited sites first, which the probe showed are the most bot-walled; the blocked share will be higher than under `.2` and the stop rule's report-to-Evan below 80 may trigger.
- Non-U.S. results cover 24 markets at about 4–5 captured sites each; per-country numbers are descriptive only.
- CrUX misses app traffic and non-Chrome browsers, so China (4 sites), Indonesia (5) and Nigeria (1) are thin. Non-U.S. strata are effectively region group × platform, since every non-U.S. candidate is `top-1k`.
- **For the reviewer to scrutinise:** the classification is a model's from knowledge. The batches flagged uncertain calls, among them small unknown shops included on their names (for example lymphoria.co, zillionsgift.com, cuddlecomfort.com, gettngood.com, getting-goods.com, glamlora.com, imcparts.net, durzzo.com), bullion dealers, and global `.com` brands set to `US` or `multi-market-domain`. Capture excludes a non-store it meets (`not-a-store`, `defunct`), with evidence.
- `.3` was signed by the independent reviewer at `b232d0e` on 2026-10-05 (agent-verified) after two fix rounds; it binds from then on.

## Status
Proposed 2026-10-05 by the amendment builder (claude-code/claude-opus-5-5) on Evan's chat request. Independent review at `95f4124`: sign with fixes (agent-verified); fixes applied. Accepted by Evan in chat 2026-10-05; protocol .3 binds once the independent reviewer signs. Signed at `b232d0e` (agent-verified).

Candidate counts replaced by `.8` ([capture protocol 8](2026-10-06-capture-protocol-8.md): 425 U.S. + 1,000 non-U.S. candidates, stop at 330 + 500 captured); the frame `retail-frame.3` stands.
