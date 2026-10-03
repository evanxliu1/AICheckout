# Chase conventions (expansion.v1)

Issuer-specific decisions for Chase cards. They refine [general.md](general.md) and never contradict it. Seeded by the coordinator on 2026-10-02 from the verifier pass. The adjudicator confirmed, corrected and extended them on 2026-10-02.

- Co-brand totals (United, IHG, Aeroplan, Marriott, Hyatt) include member or status earn. Record only the card's portion: United 2X/3X/4X/5X, IHG 5X/10X/12X, Aeroplan 3X, Marriott 3X/6X, Hyatt 4X (general 2). Confirmed 2026-10-02.
- Freedom Flex: keep only the Oct-Dec 2026 quarter shown on the 2026-10-02 capture (Grocery Stores excluding Walmart and Target, Dining, American Red Cross). Use activation `recurring`, `endsOn` 2026-12-31 and the $1,500 quarterly cap. The Jul-Sep 2026 and Jan-Mar 2027 categories go in the rotating-quarterly product note, and issues about which quarter applies are removed (general 5, 11). Confirmed 2026-10-02.
- Rules from the Prime Visa page's "Not a Prime member?" panel advertise the Amazon Visa and are removed. The 3% no-Prime fallback stays as an `ambiguous` issue (general 12). Confirmed 2026-10-02.
- Lyft, Peloton, DoorDash/Caviar, Instacart, Amazon.com/Audible, Whole Foods, Southwest Airlines, United, IHG, Marriott, Hyatt and Air Canada rules, and the Disney+/Hulu/ESPN and Disney-location rules, are single-merchant `other` rules. Each one names its merchant in a product note (general 4). Corrected 2026-10-02: Lyft is `other`, never `transit`, and the Disney streaming-site rules are `other`, never `streaming`.
- Amazon "% back rewards" (Prime Visa, Amazon Visa) are `cash-back` with no point value, even though the terms track them as points (general 1, 3). Added 2026-10-02.
- Disney Rewards Dollars (Disney Visa, Premier, Inspire) are `cash-back`. Each card carries one `ambiguous` issue saying they redeem only toward Disney purchases (and, on some cards, airline tickets charged to the card) (general 8). Added 2026-10-02.
- Sapphire Preferred's 3X "online grocery" (excluding Target, Walmart and wholesale clubs) is `other`, not `supermarkets`, because in-store grocery does not earn it. Added 2026-10-02.
- Travel bought directly from airlines or hotels ("flights booked direct", "hotel stays when booked with the hotel", "all other travel") is `other`. Chase Travel, The Edit and Renowned Hotels and Resorts for United Cardmembers (United Quest, United Club) are `travel-portal` (general 4). Added 2026-10-02.
- Sapphire Reserve's "Purchases that qualify will not earn points" covers the purchases credited by the $300 travel credit, The Edit credit and the Chase Travel hotel credit. It is recorded as one exclusion. Added 2026-10-02.
- Rates labelled "total" (Lyft 2X/3X/5X, Peloton 5X/10X, Freedom Flex Lyft 2%) already include the base rate. `rateBps` is the stated total (general 1). Added 2026-10-02.
- Exclusion lists in the Chase rewards terms are two-column PDFs with interleaved lines. Exclusions are anchored on short single-line fragments ("lottery tickets, casino gaming chips, race track", "person-to-person money transfers and account-"). Added 2026-10-02.
- Marriott Bonvoy Bold states no base rate, so it has no base rule rather than an assumed 1X. Added 2026-10-02. Corrected at the final consistency pass, 2026-10-02: the anchorless `missing` issue is removed under general 16 (the issue schema has no detail field); the gap is recorded on the wiki catalog-expansion page.


## Overlay (Stage 2 M4)

Decisions for `../../catalog-overlay.json`, made by the issuer's overlay author on 2026-10-02 under the general overlay conventions (O1–O19), then checked by an independent verifier subagent and adjudicated by the M4 coordinator (agent-verified).

- Freedom Flex rotating quarters (2026-10-02): the Oct-Dec 2026 grocery, dining and American Red Cross rules now start on 2026-10-01 and share one combined $1,500 cap (`q4-2026`). Grocery excludes the `walmart` and `target` brands. Jan-Mar 2027 grocery (also excluding Walmart and Target) and top streaming services are added rules. They run 2027-01-01 to 2027-03-31 at 5% with recurring activation and the same $1,500 quarterly cap, then 1%, under their own shared cap ID (`q1-2027`). Apr-Jun 2027 is "Coming Soon" on the capture, so nothing is added for it.
- American Red Cross (2026-10-02): this is a donation merchant, not a retailer. It is still brand-scoped (`american-red-cross`) under O3 so that a future merchant profile can match it. At a retail checkout it never applies.
- Prime Visa (2026-10-02): the card needs Prime to open, but the terms move an account to 3% when its Amazon account no longer has an eligible Prime membership. So the 5% Amazon/Audible, Whole Foods and Chase Travel rules require `amazon-prime: member`. Added 3% duplicates require `not-member`. Whether the card is linked to the Amazon account is not gated and stays a note.
- Amazon Visa (2026-10-02): its 3% Amazon/Audible and Whole Foods rules are brand-scoped with no gate. The 5% Prime offer on its page is the sibling card's.
- Single-merchant rules (2026-10-02) are brand-scoped:
  - Lyft, Peloton, DoorDash plus Caviar, Instacart, Southwest Airlines, United, IHG, Marriott, Hyatt and Air Canada each get their own brand.
  - The Avios flight rules use British Airways, Aer Lingus and Iberia.
  - Disney gets two scopes: the Disney+, Hulu and ESPN streaming-site rules, and the "most U.S. Disney locations" rules on the `disney` brand.
- Held out as not at retail (2026-10-02): flights or hotels booked direct, "all other travel", car rental agencies, "travel purchases" (Aeroplan), fitness clubs (Hyatt) and vacation homes (Sapphire Preferred).
- Held out as no v3 category (2026-10-02): Sapphire Preferred's online grocery.
- Caps (2026-10-02): Southwest Plus and Premier caps have no stated after-cap rate, so they get the base 1X after the cap (field-unstated) and a shared cap ID because the captures say "combined". The Marriott Boundless and Bountiful combined caps get shared cap IDs. Instacart's $6,000 cap gets the base 1% after it.
- Disney Rewards Dollars (2026-10-02): this is a store-credit program (`disney-rewards-dollars`) redeemable with `disney`, `disney-plus`, `hulu` and `espn`, used by Disney Visa, Premier and Inspire. Premier and Inspire also allow a statement credit toward airline tickets charged to the card. That is a near-cash way out which the program cannot represent. The catalog treats the dollars as Disney-only, which is the conservative reading.
- Marriott Bonvoy Bold (2026-10-02): held out as a card because no base rate is stated (O6).
- Peloton (2026-10-02, coordinator ruling): the Sapphire Preferred 5X and Sapphire Reserve 10X promotions apply only to purchases over $150. A minimum purchase amount cannot be expressed in v3, and brand scope alone would overstate smaller purchases, so both rules are held out. Their hints are `noted`.
- Online grocery (2026-10-02, coordinator ruling): Sapphire Preferred's 3X online grocery stays held out with "no v3 category"; no new category.
- Checkout methods (2026-10-02, O10 as clarified): some Chase captures say purchases through third-party payment accounts or mobile/digital wallets "will not qualify in a rewards category" unless set up for it. Where a card's own captures say this, its shared-category bonus rules exclude `paypal`, `venmo` and `digital-wallet`. That covers:
  - Freedom Flex: the Q4 2026 and Q1 2027 rotating rules, including American Red Cross, plus 3% dining and drugstores.
  - Sapphire Preferred: dining, gas, EV charging and streaming.
  - Prime Visa: gas, dining and transit.
  - Disney Premier: gas, grocery and dining.
  The statement is about categories, so brand-scoped merchant rules (Amazon, Whole Foods, Lyft, Disney sites) and Chase Travel portal rules are not changed. Card readers have no payment path. The statement is not in the Sapphire Reserve, Amazon Visa, Disney Inspire or co-brand captures, so those cards are unchanged.

### Verification and adjudication (2026-10-02)

The coordinator accepted all 8 verifier warnings, and they are applied. The checker prints OK for 29 cards.

- **W1:** the `disney-rewards-dollars` anchor now runs through "online at Disney sites including DisneyStore.com, DisneyPlus.com, Hulu.com or Stream.ESPN.com", so it supports the `disney-plus`, `hulu` and `espn` redemption brands.
- **W2:** Disney Inspire issue 1 and Disney Premier issue 0 now explain in their own words that the dollars can also be credited toward airline tickets charged to the card. The program cannot express that, so the catalog takes the conservative Disney-only reading. Store programs have no notes field.
- **W3:** Disney Premier rules 2, 3 and 4 now have four one-line anchors from the two-column terms, including the "third-party" and "will not qualify" spans. Read together they make no run over 25 words.
- **W4:** the Prime Visa 3% no-Prime added rules are now anchored on clause (c) and on the terms line that defines 3-2-1 rewards as earned without an eligible Prime membership. They replace the lost-Prime bullet.
- **W5:** United Quest rule 0, United Club rule 0 and IHG Premier Select rule 2 are recategorized to `transit` (modelled, how `category`). Only their local transit and rideshare part can reach a v3 category; airfare, hotels and other travel stay unrepresented. This supersedes the earlier "not at retail" hold-out for these three rules. Rule hold-outs drop from 19 to 16.
