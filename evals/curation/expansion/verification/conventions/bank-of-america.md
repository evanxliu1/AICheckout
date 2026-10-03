# Bank of America conventions (expansion.v1)

Issuer-specific decisions for Bank of America cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; the adjudicator confirms, corrects or extends them.

- Customized Cash family (Customized Cash, Students, Secured, Susan G. Komen): one rule per choice category at 3%, plus the first-year 6% rule per category with `limitedTime.endsOn` null (365 days from account opening, no calendar date; general 10). The default Gas & EV Charging option (a `gas` and an `ev-charging` rule) has activation `none`; the other five options are `enroll-once`, because the terms say the selection stays until changed (general 6). Travel and Home Improvement/Furnishings map to `other`. One `ambiguous` issue says only the selected category earns. Confirmed and extended at adjudication, 2026-10-02.
- Preferred Rewards / BofA Rewards relationship tiers are a product note, never a higher base rate; the captures do not state the tier percentages, thresholds or start date, so the hint says so. Confirmed at adjudication, 2026-10-02.
- Travel Rewards point value follows the stated cash redemption value, $0.006 a point (60), not the $0.01 travel-credit value; the difference stays as an `ambiguous` issue (general 3). Premium Rewards and Premium Rewards Elite state a $0.01 cash value (100). Confirmed at adjudication, 2026-10-02.
- Atmos Rewards Dining earns only at participating Rewards Network restaurants: `other` (general 4), activation `none` (automatic enrollment), named in a merchant-specific product note. The card terms list it as Bonus Points, so it stacks on the card's own rate for those purchases: Ascent 1 + 0.5 = 150, Summit dining 3 + 0.5 = 350. Confirmed and extended at adjudication, 2026-10-02.
- Atmos Rewards Relationship Bonus Points (10% with a Qualifying Account) are a relationship-tier product note plus an `out-of-scope` issue, not a rate change. Added at adjudication, 2026-10-02.
- Royal ONE / Royal ONE Plus points redeem for onboard credit and cruise discounts: point value null, mentioned in the merchant product note (general 3). Their "automatically enrolled in the rewards program" sentence gives activation `none` (general 7); automatic Allways or Flying Blue membership does not (general 7). Added at adjudication, 2026-10-02.
- Bare `missing` issues and issues whose only anchor is an earn line, the exclusions sentence or a "Visit BofA Rewards" pointer are removed (general 11). Added at adjudication, 2026-10-02.
- Pre-merge review, 2026-10-02: the Customized Cash family's 2% grocery and wholesale-club rule has activation `none`, because the product pages call it automatic (general 7). Applied to all four cards as accepted findings.


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- Customized Cash family (regular, Students, Secured, Susan G. Komen): one `chosen` card choice `choice-category` with one pick and six options (gas-ev-charging, online-shopping, dining, travel, drug-stores, home-improvement-furnishings). The default is gas-ev-charging, which the pricing terms and the category page state. Both the gas and the ev-charging rules carry the gas-ev-charging option.
- The pricing terms say the 2% and 3% bonus categories share the first $2,500 of combined purchases each calendar quarter, and the first-year 3% extra is subject to the same limit. So every 2%, 3% and 6% rule on these cards carries `sharedCapId: customized-cash-bonus`, and the corpus caps already match ($2,500 a quarter, then 1%).
- The first-year 6% rules keep `limitedTime` with null start and end dates (365 days from account opening, O14) and have no gate.
- The Travel option rules (3% and 6%) are recategorized to `transit`, matching how Home Improvement/Furnishings is handled. Only the option's parking, public transit and taxi/ride share part is represented; airfare, hotels and attractions are not matched.
- Home Improvement/Furnishings is recategorized to `home-improvement`. Furniture stores and contractors in the option are not matched by that category, so the catalog under-reads it.
- Online Shopping uses the existing `online-retail` category.
- Added rule `wholesale-clubs-2pct` on each Customized Cash card: 2% at `wholesale-clubs`, with the same quarterly cap and shared cap ID as the 2% grocery rule, activation none. The corpus rule names wholesale clubs but is labelled supermarkets.
- Checkout method: the pricing terms say purchases through a third-party payment account get no bonus, and third-party buy now, pay later "may not qualify". Every Customized Cash bonus rule, including the added wholesale-clubs rule, therefore excludes `paypal`, `venmo` and `bnpl`. Digital wallets are not excluded, because only wallets BofA does not support lose the bonus.
- The same third-party payment account clause appears on other cards under clarified O10. These bonus rules exclude `paypal` and `venmo`:
  - Premium Rewards and Premium Rewards Elite: dining.
  - Air France KLM: dining and the Air France/KLM rule.
  - Norwegian: the Norwegian rule.
  - Royal ONE: grocery, gas, EV charging and cruise.
  - Royal ONE Plus: dining, grocery, gas, EV charging and cruise.
- BofA Rewards / Preferred Rewards relationship bonus: every relationship-tier hint is `noted` (O9). The captures give no percentages, so no `bofa-preferred-rewards` gate is defined.
- Atmos Ascent and Summit Relationship Bonus Points (+10% with a Qualifying Account) are a new gate, `bofa-eligible-account`, with options checking-or-savings / cd / merrill-investment / none. Each card-paid rule that stays in the catalog gets a gated duplicate at ×1.1, rounded down: 110, 220, 330. Ascent accepts checking, savings or Merrill. Summit also accepts a CD, so the two cards require different option sets.
- Atmos Rewards Dining (Rewards Network participating restaurants) is held out on both Atmos cards because the captures do not list the participating restaurants, so no brand scope or category fits. Dining is not the issue; v3 covers it. The rule gets no relationship duplicate.
- Ascent "Digital Goods Media" is held out because no v3 category fits. Summit foreign-transaction 3x is held out because no catalog category or merchant signal covers it.
- Co-brand partner rules are brand-scoped: Alaska Airlines and Hawaiian Airlines (Atmos), Royal Caribbean, Celebrity Cruises and Silversea (Royal ONE / Royal ONE Plus), Allegiant (Allways), Air France and KLM (Air France KLM), Norwegian Cruise Line. The Air France KLM rule also covers SkyTeam member airlines, but the captures do not list them, so they are not matched.
- These standalone travel rules are held out as not at retail:
  - Premium Rewards and Premium Rewards Elite: Travel.
  - Royal ONE Plus: Airline and Hotel.
  - Norwegian: air and hotel.
- Program details: every BofA program uses unit "points", except Air France KLM, which uses "miles". All have empty redemptionBrandIds, because airline and cruise points are travel redemptions (general 20), not store-only points.

### Verification and adjudication (2026-10-02)

The coordinator's resolution of each finding of the independent verifier subagent:

1. Error, Premium Rewards rule 1 (dining): added `paypal` and `venmo` to excludedPaymentPaths, with how `checkout-method` and the third-party / 1.5 base points anchors.
2. Error, Premium Rewards Elite rule 1 (dining): the same change.
3. Error, Air France KLM rule 1 (dining): added the paypal/venmo exclusion, anchored to the "will not qualify for the member airlines or Dining" clause.
4. Error, Air France KLM rule 2 (Air France/KLM): added the paypal/venmo exclusion next to the brand scope, with how brand-scope and checkout-method.
5. Error, Norwegian rule 0: added the paypal/venmo exclusion next to the brand scope.
6. Error, Royal ONE rules 1–4: added the paypal/venmo exclusion. Rule 4 keeps its brand scope.
7. Error, Royal ONE Plus rules 3–7: added the paypal/venmo exclusion. Rule 7 keeps its brand scope.
8. Warning, Customized Cash family third-party anchor: split it into "processes through a third-party payment account" and "transmission of MCCs will not qualify for bonus cash rewards." so the anchor states the consequence. Applied on all four cards, including the wholesale-clubs rule.
9. Warning, `wholesale-clubs-2pct` how: added `checkout-method` on all four cards, plus the checkout anchors.
10. Warning, Customized Cash Travel option rules (3% and 6%, all four cards): changed from rule-held-out to modelled with category `transit`, how category/choice/shared-cap/checkout-method (plus limited-time on 6%). The note says only parking, transit and ride share are represented.
11. Warning, Atmos Ascent rule 7 and Summit rule 4: the held-out notes now give the real reason, that participating restaurants are not listed, rather than "not at retail".
