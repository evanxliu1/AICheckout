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


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- 2026-10-02: Store-credit programs (O13). The four Key Rewards cards share one cash-back program, `key-rewards`, which can be redeemed only at the eight Williams-Sonoma, Inc. brands the terms list. T-Mobile Visa moves to `t-mobile-rewards` (T-Mobile), REI Co-op Mastercard to `rei-co-op-mastercard-rewards` (REI), and BJ's One and One+ share `bjs-credit-card-rewards` (BJ's Wholesale Club). All four programs use unitName "cents", matching cash back.
- 2026-10-02: Key Rewards brand scope is the eight named brands: Williams Sonoma, Williams Sonoma Home, Pottery Barn, Pottery Barn Kids, Pottery Barn Teen, West Elm, Rejuvenation and Mark & Graham. GreenRow and Dormify are left out of the scope rather than excluded. The program also excludes them from the 1% base, but the base must stay unconditional, so that exclusion is not modelled.
- 2026-10-02: Key Rewards checkout methods (O10). The terms say purchases through third-party payment accounts, naming Apple Pay, PayPal and Venmo, "may earn 1%". So paypal, venmo and digital-wallet are excluded on all four bonus rules: the brand 5%, grocery 4%, restaurants 4% and the first-30-days 10%. We take the conservative reading of "may".
- 2026-10-02: The Key Rewards first-30-days 10% at the brands is an account-age promotion (O14). It gets limitedTime with null dates, plus brand scope and the same wallet exclusions as the standing 5%.
- 2026-10-02: The Key Rewards international carve-out (brand rates apply to U.S. and Puerto Rico purchases only) is `noted`, because the brand rules are already labelled U.S.-only.
- 2026-10-02: Bass Pro Shops / Cabela's CLUB. One gate, `bass-pro-club-tier`, with options classic, silver and black. There is no "none" option: approval enrolls every cardholder at Classic. Corpus rule 1 (Classic 2X) is left ungated, because every cardholder holds at least Classic. The added `club-silver` (3X) and `club-black` (5X) rules are gated on their levels. Activation is none (upgrades are automatic) and the cap is none (no maximum points).
- 2026-10-02: The CLUB store rules are scoped to Bass Pro Shops, Cabela's and Mack's Prairie Wings. Participating White River Marine Group dealers are independent dealers, not one merchant, so they get no brand. The terms say third-party payment accounts and mobile or digital wallets get only the base rate, so paypal, venmo and digital-wallet are excluded on all three tier rules.
- 2026-10-02: `bass-pro-club-points` program details: unitName "points", with redemption brands Bass Pro Shops, Cabela's and Mack's Prairie Wings. Hospitality venues and boat dealers that also take points are left out.
- 2026-10-02: BJ's One and One+ bonus rules are scoped to `bjs-wholesale-club`. An active BJ's membership is required to apply for the card, so every cardholder has one. That makes it a card-eligibility condition, not a gate (`noted` in the hint note). The BJ's Gas gap (no rate under the terms) stays `noted`, because the unconditional base cannot exclude a brand.
- 2026-10-02: The T-Mobile Visa 5% is scoped to `t-mobile`. The terms say third-party digital wallets get no enhanced earn, so digital-wallet is excluded. Authorized Retailers get no brand.
- 2026-10-02: The REI 5% is scoped to `rei`. The 5% on donations to the REI Cooperative Action Fund is held out (not at retail). REI Co-op membership is a condition for holding the card and redeeming rewards, not an earn gate.
- 2026-10-02: SavorOne and Savor Students grocery 3% excludes Walmart and Target (O4). The anchor is the product-page footnote that excludes superstores such as Walmart and Target.
- 2026-10-02: SavorOne and Savor Students checkout methods. Following the coordinator's O10 ruling, "may not" wording is read conservatively. The product-page footnote names third-party payment accounts and mobile or digital wallets, so paypal, venmo and digital-wallet are excluded on the grocery, dining, entertainment and streaming 3% rules. The footnote sits in the merchant category code explanation. The Capital One Travel and Entertainment portal rates are not code-based, so they keep no exclusion.
- 2026-10-02: Venture X, Venture, VentureOne, the three Quicksilver cards, Union Plus and Teamster Privilege need no patches. Union Plus and Teamster have only the flat 1.5% base and no issues or hints. The Venture redemption issue is `noted`.

### Verification and adjudication (2026-10-02)

The coordinator's resolution of each finding of the independent verifier subagent:

- **W1.** On both CLUB cards, the Mack's Prairie Wings anchor on rule 1 is now the span that names the Mack's store, catalogs and website as earning locations. It replaces the bare website address.
- **W2.** The added `club-silver` and `club-black` rules on both CLUB cards now also carry that Mack's span, so their brand scope has an anchor that names the stores.
- **W3.** The CLUB Classic 2X rule (corpus rule 1) is ungated on both cards. Approval enrolls every cardholder at Classic, so 2X is a guaranteed floor. Gating it would make a shopper who leaves the gate unanswered earn only the 1X base. The gate keeps all three options as a complete ladder, and only the Silver and Black rules require it. The rule's `how` is now brand-scope and checkout-method. The issue 0 and hint 0 notes are updated to match.
- **W4.** The T-Mobile rule 1 note now says the 5% covers phones, devices and accessories only. Per the terms, wireless service (bill) and EIP payments earn 2%. Brand scope cannot separate them, so a T-Mobile bill checkout would show 5%. The rule itself is unchanged.
- **W5.** The shared BJ's program is renamed "BJ's Credit Card Rewards".
