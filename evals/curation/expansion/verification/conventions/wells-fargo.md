# Wells Fargo conventions (expansion.v1)

Issuer-specific decisions for Wells Fargo cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed and extended by the adjudicator on 2026-10-02.

- 2026-10-02: Autograph point value is 1 cent (100) from the product page's stated "$200 cash redemption value" for 20,000 points (general 3). Autograph Journey states only "$600 toward your next trip", a travel value, so its point value is null.
- 2026-10-02: OneKeyCash (One Key, One Key+) is dollar-denominated and not redeemable for cash: `cash-back` with an `ambiguous` issue (general 8). Bookings on the U.S. Expedia, Hotels.com and Vrbo sites are `travel-portal` (the card program's own booking sites, general 4); a One Key account is not enrollment (general 7).
- 2026-10-02: Autograph-family and Choice "Gas" categories that include EV charging get a `gas` rule and an `ev-charging` rule; the EV rule's wording is "electric vehicle charging stations". Travel, Airlines, Hotels, Other Travel, Phone plans, Telephone plans and Home improvement are `other`.
- 2026-10-02: Choice Privileges stays and Choice point purchases are `other` (co-brand partner) at the card's rate only, not the program's member earn (general 2). The product-page vs terms disagreement on eligible stay locations stays a `conflicting` issue; the Elite Qualifying Nights disagreement is a non-earning benefit and is not labelled.
- 2026-10-02: Choice Privileges bonus points may not earn with a mobile or digital wallet, online marketplace or third-party payment account: checkout-method product note.
- 2026-10-02: Exclusions listed under "transactions that do not earn Rewards Points" (person-to-person transfers, overdraft advances, disputed or illegal purchases, fees and interest, gambling) are labelled one per line.


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- 2026-10-02: OneKeyCash (One Key, One Key+) moves from `cash-back` to the store-credit program `onekeycash`. It is cash-back currency, its unit is "OneKeyCash" (coordinator ruling) and its redemption brands are `expedia`, `hotels-com` and `vrbo` (O13). Both cards' `programId` is `onekeycash`. The OneKeyCash ambiguous issue is modelled as a store-credit program.
- 2026-10-02: On both One Key cards, the Expedia/Hotels.com/Vrbo booking rule (labelled `travel-portal`) is brand-scoped `other` (see Adjudication) and excludes `paypal`, because the terms say PayPal purchases are not eligible for the bonus (O10). The One Key login and supplier-charge conditions are not modelled.
- 2026-10-02: Choice Privileges and Choice Select bonus points may not be earned through third-party payment accounts, online marketplaces or mobile/digital wallets. Every bonus rule (gas, EV charging, groceries, home improvement, stays, point purchases) excludes `paypal`, `venmo` and `digital-wallet`. Online marketplaces have no payment path. Telephone plans are held out, so they carry no exclusion.
- 2026-10-02: Choice qualifying stays and Choice Privileges point purchases are brand-scoped to `choice-hotels`. The stay-location conflict (non-Choice-brand hotels booked through Choice channels) stays open as `noted`, because brand matching covers only Choice Hotels.
- 2026-10-02: Choice "Home improvement" moves to category `home-improvement`. The issuer's group is broader (it also covers furniture, appliance, garden and pool stores), but it is a whole-category rule (O3).
- 2026-10-02: These rules are held out as not at retail: Autograph Travel and Phone plans; Autograph Journey Hotels, Airlines and Other Travel; Choice and Choice Select Telephone plans.
- 2026-10-02: Under the clarified O10 (coordinator ruling), Autograph and Autograph Journey bonus rules exclude `paypal` and `venmo`. The terms say Wells Fargo decides which purchases qualify for bonus points, including third-party payment account purchases. Mobile wallets are not named in that statement. This covers Autograph dining, gas, EV charging, transit and streaming, and Journey restaurants. Held-out rules carry nothing.
- 2026-10-02: Program details: Wells Fargo Rewards and Choice Privileges use unit "points" with no redemption brands. Choice points redeem only through Choice Privileges, which is a hotel program (general 20).

### Verification and adjudication (2026-10-02)

- On One Key and One Key+, the overlay sets rule 0 to category `other` with brands `expedia`, `hotels-com` and `vrbo`, keeping the PayPal exclusion (brand-scope plus checkout-method). The corpus still labels the rule travel-portal under the Wells Fargo convention. Brand scope lets checkouts on the booking sites match it, like the other co-brand partner rules. Hint 0 on both cards is updated to match.
