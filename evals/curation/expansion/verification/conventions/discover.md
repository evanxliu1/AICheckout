# Discover conventions (expansion.v1)

Issuer-specific decisions for Discover cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass; confirmed and extended by the adjudicator on 2026-10-02.

- 2026-10-02: Discover it rotating 5% categories (Cash Back, Student Cash Back, Secured Cash Back): only Q4 2026 (Restaurants, Entertainment, Utilities; ends 2026-12-31) is kept, activation `recurring`, cap $1,500 per quarter (general 5). Q1 to Q3 2026 rules are removed and listed in the rotating-quarterly product note (`otherQuarters2026`). Each rule names only its own category; Utilities is `other`.
- 2026-10-02: The after-cap rate is 1% where a terms capture says so (Cash Back, Secured); Student Cash Back has no terms capture, so its after-cap rate stays null.
- 2026-10-02: Cashback Match and Discover Match (first-year match of all rewards for new cardmembers) are one `out-of-scope` issue per card, not an earning rule or a limited-time rate.
- 2026-10-02: "Purchases must be made with merchants in the U.S." sits in the bonus-category text (the calendar scopes it to the 5% categories; the Chrome terms to the 2% categories): `usMerchantsOnly: true` on the 5% and 2% rules, null on the base rate on every Discover card.
- 2026-10-02: The Discover by Capital One terms captured for Discover it Cash Back, Chrome, Secured and Miles state 5% (Miles: 5 miles) on Capital One Travel (hotels, vacation rentals, rental cars) and Capital One Entertainment tickets; these are `travel-portal` and `entertainment-portal` rules (general 4), checked against each card's own terms capture. The student cards' captures do not state them.
- 2026-10-02: Discover it Miles earns miles (`points`, 1.5X = 150); its cash and travel redemption rates "vary", so point value null.
- 2026-10-02: Chrome 2% gas and restaurants is earned "automatically" (activation `none`) and is a standing rate; the "last day of the offer or promotion" sentence is boilerplate, not a limited time (general 10).
