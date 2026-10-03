# American Express conventions (expansion.v1)

Issuer-specific decisions for American Express cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed and extended by the adjudicator on 2026-10-02.

- 2026-10-02: Delta "5,000 miles generally provides $50 of value" is Pay with Miles toward Delta flights at delta.com, not cash: point value null on all four Delta cards (general 3), with a merchant-specific Delta product note recording the Pay with Miles value.
- 2026-10-02: Membership Rewards portal rules ("Membership Rewards program-enrolled" Card Members on AmexTravel.com, Platinum cruise 2x): holding an MR account is not enrollment, so activation is null (general 7).
- 2026-10-02: The generic "2X on American Express Travel Online" offer is a rule on Gold (it covers e.g. prepaid short-term rentals; it does not stack with the card's own travel bonuses) but not on Platinum, whose terms limit the additional point to cruise reservations.
- 2026-10-02: Airline-direct flight purchases are a separate `other` rule (wording "airfare on a scheduled flight charged directly with passenger airlines" or "booked directly with passenger airlines"); AmexTravel bookings are `travel-portal`. Applied on Gold, Platinum, Hilton Aspire and Marriott Brilliant.
- 2026-10-02: Platinum's $500,000 calendar-year cap applies to flights only (prepaid hotels and vacation rentals are uncapped) and is one cap shared by its portal and airline-direct flight rules: both rules carry the cap, plus one `ambiguous` issue anchored on the cap sentence. Bevy's $15,000 restaurant-and-supermarket cap is handled the same way.
- 2026-10-02: Co-brand partner rules (Delta Purchases, Hilton portfolio, Marriott Bonvoy properties) and broad direct-with-hotels rules (Delta Platinum 3X hotels) are `other`; only the card's earn is recorded, not the loyalty program's member earn (general 2, 4).
- 2026-10-02: Restaurant rules stated as "restaurants worldwide" are `usMerchantsOnly: false`; "U.S. takeout and delivery" on the product page is not a conflict with the worldwide terms.
- 2026-10-02: Rules and issues lifted from "More from American Express" comparison blocks advertising another card (Surpass on the Aspire page, Gold on the Delta Platinum page, Platinum and Brilliant on the Bevy page) are removed (general 12).


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- 2026-10-02: Co-brand partner rules are brand-scoped, category `other`: Delta Purchases → `delta` (Blue, Gold, Platinum, Reserve), Hilton portfolio → `hilton` (Hilton Honors, Surpass, Aspire), Marriott Bonvoy properties and Marriott-branded retail/online stores → `marriott` (Bevy, Brilliant). Anchors come from the pricing terms, plus "Made directly with Delta" from the Delta product pages.
- 2026-10-02: Airline-direct flight rules (Gold, Platinum, Aspire, Brilliant), Delta Platinum's direct-with-hotels rule and Aspire's select car rental rule are held out as not at retail. The AmexTravel portal rules stay as labelled.
- 2026-10-02: Platinum's $500,000 calendar-year flight cap is over the v3 cap limit (MAX_AMOUNT_CENTS = $100,000). The portal flight rule carries `cap: unstated` (field-unstated). Its airline-direct twin is held out, so the overlay sets no shared cap ID.
- 2026-10-02: Bevy's $15,000 restaurant and U.S. supermarket cap is combined, so both rules get `sharedCapId: restaurants-supermarkets` (O12).
- 2026-10-02: Hilton Surpass is the only Amex capture that states outright that third-party payment account purchases earn no additional points. Its bonus rules (Hilton, dining, supermarkets, gas, online retail) exclude `paypal` and `venmo`. The online retail rule also excludes `bnpl`, because the terms name third-party buy now, pay later installment programs.
- 2026-10-02: Under the clarified O10 (coordinator ruling), the hedged wording also counts. Every Amex pricing capture says bonus points may not be received with a third-party payment account or a mobile or digital wallet. So every bonus rule that stays in the catalog on all 11 cards (except Gold's separate AmexTravel Online offer, see Adjudication) excludes `paypal`, `venmo` and `digital-wallet`, anchored on that card's own pricing capture. This includes the AmexTravel portal rules, because the statement covers all additional points. Surpass keeps `bnpl` on online retail. Platinum's portal flight rule stays field-unstated (unstated cap) and also carries the exclusions.
- 2026-10-02: Delta Pay with Miles, the Membership Rewards value, Venue Collection concessions credits, Bevy's per-stay bonus-point limit (a cap on rewards earned) and Platinum's no-stacking statement are `noted`.
- 2026-10-02: Program details: Membership Rewards, Hilton Honors and Marriott Bonvoy use unit "points" and Delta SkyMiles uses "miles". None gets redemption brands, because airline and hotel points are travel-only under general 20.

### Verification and adjudication (2026-10-02)

- Gold rule 7, the separate 2X AmexTravel Online offer, no longer has the payment-path patch. That offer's own terms carry no wallet sentence. The patch set nothing else, so it is removed.
- The Delta Purchases carve-out for deltashop.com and Delta Gift Cards is recorded as noted in the Delta Purchases rule notes and the Delta Purchases hint on all four Delta cards. No new brand was added.
