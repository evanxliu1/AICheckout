# Wells Fargo conventions (expansion.v1)

Issuer-specific decisions for Wells Fargo cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed and extended by the adjudicator on 2026-10-02.

- 2026-10-02: Autograph point value is 1 cent (100) from the product page's stated "$200 cash redemption value" for 20,000 points (general 3). Autograph Journey states only "$600 toward your next trip", a travel value, so its point value is null.
- 2026-10-02: OneKeyCash (One Key, One Key+) is dollar-denominated and not redeemable for cash: `cash-back` with an `ambiguous` issue (general 8). Bookings on the U.S. Expedia, Hotels.com and Vrbo sites are `travel-portal` (the card program's own booking sites, general 4); a One Key account is not enrollment (general 7).
- 2026-10-02: Autograph-family and Choice "Gas" categories that include EV charging get a `gas` rule and an `ev-charging` rule; the EV rule's wording is "electric vehicle charging stations". Travel, Airlines, Hotels, Other Travel, Phone plans, Telephone plans and Home improvement are `other`.
- 2026-10-02: Choice Privileges stays and Choice point purchases are `other` (co-brand partner) at the card's rate only, not the program's member earn (general 2). The product-page vs terms disagreement on eligible stay locations stays a `conflicting` issue; the Elite Qualifying Nights disagreement is a non-earning benefit and is not labelled.
- 2026-10-02: Choice Privileges bonus points may not earn with a mobile or digital wallet, online marketplace or third-party payment account: checkout-method product note.
- 2026-10-02: Exclusions listed under "transactions that do not earn Rewards Points" (person-to-person transfers, overdraft advances, disputed or illegal purchases, fees and interest, gambling) are labelled one per line.
