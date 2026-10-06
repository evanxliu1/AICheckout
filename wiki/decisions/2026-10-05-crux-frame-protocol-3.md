---
type: Decision
title: Most-visited retailers by Chrome UX Report country lists (generic-reader-protocol.3)
description: Evan asked that the reader test set be the most popular retailers by actual visits, U.S. and non-U.S.; the frame moves from Tranco to the Chrome UX Report's per-country top lists (retail-frame.3), candidates are taken most popular bucket first, the non-U.S. stream round-robins 24 countries, sister storefronts are kept per country and locked to one split. Amends the signed reader protocol before any capture.
status: proposed
tags: [decision, phase-12, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T23:59:00Z
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
| Depth classified | Top 10,000 everywhere; as deep as each stream needs | U.S. to bucket 5,000 (it needs the second bucket to reach 200), the others to bucket 1,000 (1,617 eligible non-U.S. sites, far above 200). 29,000 list rows, 21,593 hosts |
| Who classifies | One agent; parallel subagents under one rule sheet | Nine subagent batches under a committed rule sheet, from knowledge, no site visited; raw output committed; the builder reconciles in a committed file (one classification per domain, family slugs, rules unified) |
| Unit | Origin (CrUX's unit); registrable domain | Registrable domain as before; its band is its best storefront host's bucket in its **home list** (U.S. list for region US, else its region's list). Country subdomains of a global domain fold into its U.S. storefront |
| Sister storefronts (amazon.de, amazon.fr) | One per family worldwide (`.2`); one per family per country | **One per family per country**, since each is among its market's most visited; the split puts a whole family in one split (new family lock), which keeps `.2`'s protection against shared code in development and held-out |
| Candidate order | Seeded order over all buckets; most popular bucket first | Most popular bucket first, seeded key order within a bucket |
| Non-U.S. balance | Round robin over countries; weights by market size | **Round robin** (countries in `reader-country` key order): the reader's failures are locale-driven, so equal turns test the most locales, and market weights need a table outside CrUX. 200 candidates: 9 from each of 20 countries, FR 8, ID 5, CN 4, NG 3 |
| Probe sites | Forced into the U.S. stream (`.2`); only on their popularity | On their popularity: 15 of 25 are candidates; captured ones still go to development |
| Regulated goods | Leave to capture's item rule; exclude in the frame | `sensitive-goods` code (firearms, tobacco and vape, cannabis, alcohol stores), since capture could never pick an item there |

## Decision
Amend the reader protocol to `generic-reader-protocol.3` ([Amendment 2](../../docs/evals/generic-reader-protocol.md#amendment-2-2026-10-05-generic-reader-protocol3)). Frame `evals/merchants/retail-frame-3.json` (`retail-frame.3`, SHA-256 `2b8c7658…0463`; 2,889 domains, 2,115 eligible: U.S. 102 `top-1k` + 396 `1k-5k`, non-U.S. 1,617 `top-1k` in 24 countries, 21 currencies), built byte for byte by `evals/merchants/tools/build-retail-frame-3.py` from the gitignored CrUX copies (hashes pinned) and `evals/merchants/frame-3-inputs/`. `seeded-selection.mjs` `516e257b…e26a` (candidates output `492d92a4…8760`). Frames 1 and 2, the held-out list (`6bc92515…79b2`), the seed, labels, scoring, pass bar, peek policy, roles and capture posture unchanged.

## Consequences
- The 12.3 capture visits the most-visited sites first, which the probe showed are the most bot-walled; the blocked share will be higher than under `.2` and the stop rule's report-to-Evan below 80 may trigger.
- Non-U.S. results cover 24 markets at about 4–5 captured sites each; per-country numbers are descriptive only.
- CrUX misses app traffic and non-Chrome browsers, so China (4 sites), Indonesia (5) and Nigeria (3) are thin.
- **For the reviewer to scrutinise:** the classification is a model's from knowledge. The batches flagged uncertain calls, among them small unknown shops included on their names (for example lymphoria.co, zillionsgift.com, cuddlecomfort.com, gettngood.com, getting-goods.com, glamlora.com, imcparts.net, durzzo.com), auctions with checkout counted eligible, multi-level-marketing shops (myherbalife.com, asclepiuswellness.com, oriflame.com), telco device shops, bullion dealers, and global `.com` brands set to `US` or `multi-market-domain`. Capture excludes a non-store it meets (`not-a-store`, `defunct`), with evidence.
- `.3` needs an independent reviewer's signature before 12.3 starts; until then `.2` binds.

## Status
Proposed 2026-10-05 by the amendment builder (claude-code/claude-opus-5-5) on Evan's chat request; independent signature pending.
