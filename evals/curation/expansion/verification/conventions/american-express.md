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
