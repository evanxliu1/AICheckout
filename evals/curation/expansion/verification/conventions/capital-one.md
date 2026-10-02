# Capital One conventions (expansion.v1)

Issuer-specific decisions for Capital One cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed, corrected and extended by the adjudicator on 2026-10-02.

## Portals and rates

- 2026-10-02: Capital One Travel bookings are `travel-portal` (general 4). Capital One Entertainment ticket purchases are `entertainment-portal`, the shared category made for them and used in `real.v2.2`, not `travel-portal`. (The seeded note filed both under `travel-portal`; corrected.)
- 2026-10-02: the 5X/5% Travel rate covers only the booking types the terms name (hotels, vacation rentals, rental cars; on Venture X, hotels and rental cars at 10X and flights and vacation rentals at 5X). The issuerWording names those types, not "Capital One Travel" alone.
- 2026-10-02: a product-page headline such as "1.5% on every purchase" does not conflict with higher portal rates in the terms. Draft `conflicting` issues that rest only on that pairing are removed (general 11).
- 2026-10-02: pre-sale tickets and Capital One Hall/Arena tickets are excluded from the Entertainment rate only. They still earn the base rate, so they are not exclusions.

## Point values

- 2026-10-02: Venture-family miles (Venture X, Venture, VentureOne) have point value null. "Multiply the cost of your travel purchase by 100" is a travel-redemption formula, and cash, check and gift-card rates "vary" (general 3). The Venture X anniversary miles "equal to $100 towards travel" are also a travel value.
- 2026-10-02: Bass Pro Shops / Cabela's CLUB Points have point value 100 (1 cent): the terms state that 100 Points equal one dollar toward purchases at the stores. That is a fixed store-dollar value for a store card (general 3). The currency stays `points`, because the program counts in points (1 and 2 points per dollar → 100 and 200, general 1).

## Store-only rewards (general 8)

- 2026-10-02: these cards pay percentage-back rewards that can be used only with the merchant: T-Mobile Visa (T-Mobile bill or devices), REI Co-op Mastercard (REI), the Key Rewards family (Reward Certificates at Williams-Sonoma, Inc. Brands), BJ's One and One+ (BJ's purchases and membership fees). Their currency is `cash-back`, and each has one `ambiguous` issue anchored on the redemption-restriction sentence. CLUB cards carry the same issue, with `points` currency (above).
- 2026-10-02: the single-merchant rule's issuerWording names the merchant (general 4). BJ's uses "in-club at BJ's front-end registers, on BJs.com or via the BJ's app", not the bare defined term "Eligible Purchases".
- 2026-10-02: a BJ's Gas purchase is outside "Eligible Purchases" and is also defined as not "outside of BJ's", so the terms give it no rate. Both BJ's cards keep an `ambiguous` issue for it.
- 2026-10-02: REI Co-op membership is a condition for holding the card and redeeming rewards. It is not rewards enrollment, so activation is null (general 7).

## Card families with shared disclosures

- 2026-10-02: Key Rewards (Williams Sonoma, Pottery Barn, West Elm, Key Rewards Visa) captures are byte-identical. All four carry the same labels: 5% at Williams-Sonoma, Inc. Brands (`other`, U.S. only), 4% grocery stores, 4% restaurants, 1% `all-purchases`, and the first-30-days 10% total at the brands (`limitedTime`, `endsOn` null). They share the same three `ambiguous` issues: third-party wallets "may earn 1%", the international carve-out naming only Williams Sonoma Stores, and store-only certificates. Exclusion wording may differ between cards. Pottery Barn had no draft and was built from the capture.
- 2026-10-02: the Bass Pro Shops and Cabela's CLUB captures are byte-identical and are labelled as one program. CLUB Classic is the default (enrollment is automatic), so the store rule is 200 with activation `none`. Silver (3X, $10,000 a year) and Black (5X, $25,000 a year) are spend-qualified tiers. They go in the relationship-tier product note, plus an `out-of-scope` issue (general 9). Discretionary promotional point offers and "Participating Stores" (third parties, no stated rate) are not rules.
- 2026-10-02: the BJ's One and One+ captures differ only in rates (3%/1.5% vs 5%/2%) and are labelled in parallel.
- 2026-10-02: the Union Plus and Teamster Privilege captures differ only in union eligibility wording. Both are a flat 1.5% cash back, confirmed as drafted.
- 2026-10-02: VentureOne Rewards for Good Credit was merged into `capital-one-ventureone` in `cards.json` ("same earn rates"). The labels describe the captured VentureOne terms only. No Good Credit capture exists, so the merge claim is not verified from captures.

## Dropped cards

- 2026-10-02: Kohl's Rewards Visa: the only capture is the joint Kohl's Rewards Visa / Kohl's Credit Card application terms. It has no rewards section and no earn rate, so the card is dropped (general 9). Re-add it only with a capture that states the rewards terms.
