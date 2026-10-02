# Discover conventions (expansion.v1)

Issuer-specific decisions for Discover cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed and extended by the adjudicator on 2026-10-02.

- 2026-10-02: Discover it rotating 5% categories (Cash Back, Student Cash Back, Secured Cash Back): only Q4 2026 (Restaurants, Entertainment, Utilities; ends 2026-12-31) is kept, activation `recurring`, cap $1,500 per quarter (general 5). Q1 to Q3 2026 rules are removed and listed in the rotating-quarterly product note (`otherQuarters2026`). Each rule names only its own category; Utilities is `other`.
- 2026-10-02: The after-cap rate is 1% where a terms capture says so (Cash Back, Secured); Student Cash Back has no terms capture, so its after-cap rate stays null.
- 2026-10-02: Cashback Match and Discover Match (first-year match of all rewards for new cardmembers) are one `out-of-scope` issue per card, not an earning rule or a limited-time rate.
- 2026-10-02: "Purchases must be made with merchants in the U.S." sits in the bonus-category text (the calendar scopes it to the 5% categories; the Chrome terms to the 2% categories): `usMerchantsOnly: true` on the 5% and 2% rules, null on the base rate on every Discover card.
- 2026-10-02: The Discover by Capital One terms captured for Discover it Cash Back, Chrome, Secured and Miles state 5% (Miles: 5 miles) on Capital One Travel (hotels, vacation rentals, rental cars) and Capital One Entertainment tickets; these are `travel-portal` and `entertainment-portal` rules (general 4), checked against each card's own terms capture. The student cards' captures do not state them.
- 2026-10-02: Discover it Miles earns miles (`points`, 1.5X = 150); its cash and travel redemption rates "vary", so point value null.
- 2026-10-02: Chrome 2% gas and restaurants is earned "automatically" (activation `none`) and is a standing rate; the "last day of the offer or promotion" sentence is boilerplate, not a limited time (general 10).


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- 2026-10-02: The Q4 2026 rotating rules (Restaurants, Entertainment) on Discover it Cash Back, Student Cash Back and Secured get `limitedTime.startsOn` 2026-10-01 next to the labelled end date 2026-12-31 (O11).
- 2026-10-02: The $1,500 quarterly cap is one cap across the quarter's categories. The calendar says it covers purchases in different categories each quarter, up to $75 per quarter. So the rotating rules share `sharedCapId: rotating-5-percent` (O12).
- 2026-10-02: Utilities is held out on all three rotating cards as not at retail (household utilities and phone/internet service).
- 2026-10-02: Discover it Student Cash Back has no terms capture and its after-cap rate is unstated. Its rotating rules carry a full cap with the base 1% after it, as `field-unstated`. The product-page ambiguous issue is also field-unstated.
- 2026-10-02: Chrome and Student Chrome cap gas and restaurants together at $1,000 in combined purchases per quarter, so both rules share `sharedCapId: gas-restaurants-2-percent`.
- 2026-10-02: Q1 2027 categories are not in any capture, so no later-quarter rule is added (O11). This is noted in the rotating hint disposition.
- 2026-10-02: Cashback Match and Discover Match, the Chrome partial-EV-charging coding, and the Secured "Discover it and Discover More cardmembers" program-details heading are `noted`.
- 2026-10-02: Under the clarified O10 (coordinator ruling), Discover's statement counts. It says some third-party payment account and digital wallet transactions may not earn the bonus. The 5% rotating rules and the Chrome and Student Chrome 2% rules exclude `paypal`, `venmo` and `digital-wallet`, anchored on each card's own terms, product or calendar capture. The statement sits in the merchant-code category text, so Capital One Travel and Entertainment portal rules are not covered. Discover it Miles has no such statement in its captures.
- 2026-10-02: Program details: Discover miles uses unit "miles" with no redemption brands. The cash-back cards stay on `cash-back`.

### Verification and adjudication (2026-10-02)

- The independent verifier confirmed all six cards with no findings; the Capital One portal rules stay without the payment-path exclusion because the statement covers category coding only.
