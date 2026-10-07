---
type: System Component
title: Reward-program valuation
description: The Phase 7 Stage 2 M3 table that maps every catalog card to one of 52 rewards programs with a value basis (cash, published estimate, issuer-stated or none), its checks, its agent verification and the per-program values.
status: stable
tags: [system, catalog, valuation, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../../evals/curation/expansion/reward-programs.json
    title: Reward-program table
  - resource: ../../scripts/lib/reward-programs.mjs
    title: Schema and checks
  - resource: catalog-expansion.md
    title: Catalog expansion (Phase 7), the page this section was split from on 2026-10-07
---

# Reward-program valuation

Split out of [catalog expansion](catalog-expansion.md) on 2026-10-07 (one concept per page); the content is unchanged from the M3 section. How the engine uses these values: [rewards engine](rewards-engine.md); the points concepts: [cards](../domain/cards.md).

Milestone M3 of the [Stage 2 plan](../product/phase-7-stage-2.md), branch `s2-m3-valuations` (2026-10-02, merged with PR #20). `evals/curation/expansion/reward-programs.json` maps each of the 180 cards (173 `expansion.v1`, 7 `real.v2.2`) to one of 52 programs, with a verbatim currency anchor of at most 25 words from one of the card's captures, and gives each program a value in hundredths of a cent per unit. Publisher choice and the issuer-stated rule: [decision](../decisions/2026-10-02-nerdwallet-primary-valuation-publisher.md).

- **Bases.** `cash` (the one `cash-back` program, 100; all 77 cards the corpora label `cash-back`, since their rates are already percentages); `published-estimate` (24 programs, NerdWallet, read 2026-10-02, URL in the file); `issuer-stated` (11 programs, a fixed redemption value quoted from a capture); `none` (16 programs: no value, the extension shows units only and asks the shopper). No value is assumed.
- **M10 part 2 (2026-10-03).** Citi Double Cash moved from `citi-thankyou` (stated 1¢) to `cash-back` under general rule 1, with a `corpusLabel` block that repeats its frozen `real.v2.2` label (points, 100); the check allows only that remap (table version `reward-programs.2026-10-02.2`). No other card states a percentage back on a points program. The counts below are M3's: since the remap `cash-back` has 78 cards, `citi-thankyou` 4, and 18 cards carry a stated value ([decision](../decisions/2026-10-03-double-cash-cash-back.md)).
- **Card-level values.** `statedValueHundredthsOfCent` repeats the corpus `pointValueHundredthsOfCent` (19 cards, e.g. `boa-travel-rewards` 60, Luxury Card 100/150/200) and wins over the program value, after the shopper's override.
- **Checks.** `scripts/lib/reward-programs.mjs` (Zod schema and `checkRewardPrograms`: every corpus card exactly once, program currency equals the corpus currency, anchors from the card's own sources and ≤ 25 words, estimates from the primary publisher read within 30 days of an as-of date, stated values equal the corpus, every program used); tests in `scripts/lib/reward-programs.test.mjs`. `check-expansion-quotes.mjs` scans the file and checks every anchor is verbatim in the capture it names; pass the capture folders with `--captures <dir>` (repeatable), e.g. both capture folders of the `../AICheckout-expansion` worktree.
- **Verification (agent-verified, 2026-10-02).** An independent subagent re-read the NerdWallet page and the other candidates and checked all 180 anchors, 11 issuer-stated quotes and 16 `none` programs. No blocking errors; adjudication: rationale reworded (NerdWallet is widest among publishers with a non-transfer bank-currency value, not widest outright; its baseline is a portal value; its airline and hotel medians are not uniformly the lowest); the broader-than-corpus issuer-stated rule documented; Norwegian quote extended to include the 20,000-point count (the suggested equal-value sentence is 31 words, over the limit); Sun Country and Royal ONE card anchors replaced with ones that name the program; Aer Lingus and Iberia stay `none` (documented); Dillard's corpus null value noted for a later corpus revision.

| Program | Value (¢/100) | Basis | Cards |
| --- | --- | --- | --- |
| `cash-back` | 100 | cash | 77 |
| `amex-membership-rewards` | 100 | published-estimate | 2 |
| `chase-ultimate-rewards` | 100 | published-estimate | 2 |
| `citi-thankyou` | 100 | published-estimate | 5 |
| `capital-one-miles` | 100 | published-estimate | 3 |
| `wells-fargo-rewards` | 100 | published-estimate | 2 |
| `bank-of-america-points` | 100 | published-estimate | 5 |
| `discover-miles` | 100 | published-estimate | 1 |
| `us-bank-altitude-points` | — | none | 3 |
| `delta-skymiles` | 120 | published-estimate | 4 |
| `united-mileageplus` | 120 | published-estimate | 4 |
| `american-aadvantage` | 170 | published-estimate | 4 |
| `southwest-rapid-rewards` | 140 | published-estimate | 3 |
| `jetblue-trueblue` | 140 | published-estimate | 3 |
| `atmos-rewards` | 140 | published-estimate | 2 |
| `british-airways-avios` | 120 | published-estimate | 1 |
| `aer-lingus-avios` | — | none | 1 |
| `iberia-avios` | — | none | 1 |
| `air-canada-aeroplan` | 110 | published-estimate | 1 |
| `air-france-klm-flying-blue` | 100 | published-estimate | 1 |
| `emirates-skywards` | 100 | published-estimate | 2 |
| `virgin-points` | 80 | published-estimate | 1 |
| `lufthansa-miles-and-more` | — | none | 1 |
| `cathay-asia-miles` | — | none | 1 |
| `korean-air-skypass` | — | none | 3 |
| `frontier-miles` | — | none | 1 |
| `breeze-breezepoints` | — | none | 1 |
| `sun-country-rewards` | 100 | issuer-stated | 1 |
| `allegiant-allways-points` | 100 | issuer-stated | 1 |
| `hilton-honors` | 40 | published-estimate | 3 |
| `marriott-bonvoy` | 70 | published-estimate | 5 |
| `ihg-one-rewards` | 60 | published-estimate | 3 |
| `world-of-hyatt` | 180 | published-estimate | 1 |
| `wyndham-rewards` | 70 | published-estimate | 3 |
| `choice-privileges` | 80 | published-estimate | 2 |
| `royal-caribbean-royal-one` | 100 | issuer-stated | 2 |
| `norwegian-cruise-line-points` | 100 | issuer-stated | 1 |
| `carnival-rewards-points` | — | none | 1 |
| `capital-vacations-rewards` | — | none | 1 |
| `rci-elite-rewards` | 100 | issuer-stated | 1 |
| `gm-rewards-points` | — | none | 1 |
| `luxury-card-points` | — | none | 3 |
| `barnes-noble-points` | — | none | 1 |
| `gap-encore-points` | 20 | issuer-stated | 4 |
| `bass-pro-club-points` | 100 | issuer-stated | 2 |
| `dillards-rewards-points` | 66 | issuer-stated | 1 |
| `macys-star-rewards-points` | 100 | issuer-stated | 1 |
| `bloomingdales-loyallist-points` | 50 | issuer-stated | 1 |
| `american-eagle-real-rewards-points` | — | none | 1 |
| `carecredit-reward-points` | 100 | issuer-stated | 1 |
| `harley-davidson-visa-points` | — | none | 3 |
| `edward-jones-loyalty-points` | — | none | 1 |

## Related

* [Catalog expansion](catalog-expansion.md)
* [Points valuation decision](../decisions/2026-10-02-points-valuation-published-estimates.md)
* [NerdWallet as primary publisher](../decisions/2026-10-02-nerdwallet-primary-valuation-publisher.md)
