# Seven cashback cards, one checkout decision

As of **2026-09-28**, only one of the seven cards pays a bonus at bestbuy.com or newegg.com: **Amex Blue Cash Everyday (BCE) earns 3% on "U.S. online retail purchases"** (up to $6,000 a year, then 1%). That category depends on the channel, not the merchant category code (MCC), and it requires the card to be paid online and the merchant to flag the transaction as internet. The other six cards earn their base rate at electronics retailers. Citi Double Cash and Wells Fargo Active Cash pay 2%, Chase Freedom Unlimited and Capital One Quicksilver pay 1.5%, and Capital One Savor and Amex Blue Cash Preferred (BCP) pay 1%. Across the set, the earning rules fall into five mechanically different kinds:

- **Flat base rates.**
- **MCC-group categories:** dining, grocery/supermarkets, gas, drugstores, entertainment, transit.
- **Channel categories:** Amex online retail.
- **Merchant-list categories:** Amex and Capital One streaming, the Chase Lyft promo.
- **Portal categories:** Chase Travel, Citi Travel, Capital One Travel and Entertainment.

Citi adds a sixth kind, a payment-triggered earning event: 1% is earned when you pay, not when you buy.

The category names hide real definitional conflicts. Capital One counts bakeries as dining, and Chase excludes them. Amex's streaming list includes Audible, and Capital One excludes audiobooks. Amex's supermarket category excludes specialty food stores, while Capital One's grocery category explicitly includes "specialty market". A rewards schema therefore needs per-issuer category definitions mapped to a shared internal enum, not a shared definition.

The main changes to watch in 2025–2026:

- Citi made its Citi Travel 5% permanent (May 2025).
- Amex restructured the Disney streaming credit (2025).
- Capital One revived "SavorOne" as a separate $39 card (August 2025).
- Capital One moved some Quicksilver accounts to Discover with a targeted 3% grocery/gas category (2026).
- Welcome bonuses shifted: Wells Fargo's official bonus is now $100, not the $200 still widely reported.

Everything below was checked on 2026-09-28 unless marked otherwise.

## How to read the quote-verification labels

Every rate and definition quote in the tables carries a label. **OV** (official, verbatim) means the text was read from a browser-rendered issuer page or extracted directly from an issuer PDF. This covers the Amex terms and benefit pages, the rendered Capital One product pages with their "Important disclosures" and "Rewards terms" modals, and the Citi ThankYou terms PDF. Amex's own typos are preserved, such as "the first of $6,000" and "cash equivalents., gift cards".

**OF** (official, via fetch) means the text came from an issuer page through a fetch tool that summarizes with a small model. It is near-verbatim but must be re-checked character by character before it is used as a gold evidence span. This applies to the Citi product HTML, Wells Fargo and Chase.

**PA** marks a paraphrase of an official source. **SEC** marks a non-issuer source such as Upgraded Points, Doctor of Credit, NerdWallet, CNBC Select or WalletHub.

Capital One's application terms have no standalone URL. They load in a modal on the product page, so the product URL is cited, labeled [QS-APP]/[SV-APP] for the application terms and [QS-RT]/[SV-RT] for the program rewards terms. Amex's governing clause lives on the apply-flow terms page (`.../terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms`), which is more authoritative than the marketing tiles. Where tile wording differs from the terms, the tables use the terms.

## Card-by-card earning rules as of 2026-09-28

### Citi Double Cash: 2% split between buying and paying

| Rate | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 1 pt/$1 (1%) at purchase | Purchases | "At the end of each billing cycle, You will earn 1 ThankYou Point per $1 on purchases made on Your Card Account reduced by the amount of any returns and refunds." | None ("no caps on the amount of cash back you earn") | None ("no categories to enroll in") | [Citi T&C PDF, "Last Updated: March 2022"](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf) | OV |
| 1 pt/$1 (1%) at payment | Eligible Payments | "you will earn 1 ThankYou Point per $1 on Eligible Payments made to Your Card Account. You will earn ThankYou Points on Your Eligible Payments up to the balance shown in Your Purchase Tracker". Eligible Payments are those that "add up to at least the Minimum Payment Due". Redeeming points for a statement credit "is not an Eligible Payment". | Limited by the Purchase Tracker balance (net purchases) | None | [Citi T&C PDF](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf) | OV |
| 5% total (2% + "additional 3%") | Citi Travel: hotels, car rentals, attractions | "an additional 3% cash back on hotels, car rentals, and attractions booked through the Citi Travel® portal"; "earn a total of 5% on select travel"; air travel excluded | None stated | Must book via Citi Travel portal | [Citi product page](https://www.citi.com/credit-cards/citi-double-cash-credit-card); [Additional Information](https://www.citi.com/credit-cards/citi-double-cash-credit-card/additional-information) | OF |

The headline is "Earn unlimited 1% cash back when you buy, plus an additional 1% as you pay, on every purchase" (OF, [Citi product page](https://www.citi.com/credit-cards/citi-double-cash-credit-card)). **Rewards are ThankYou Points worth $0.01 each for cash**: "10,000 ThankYou® Points for a $100 statement credit, a $100 Check by Mail, or as a $100 direct deposit" ([Citi product page](https://www.citi.com/credit-cards/citi-double-cash-credit-card)). Statement credits are available "in any denomination". Points "will not expire". Citi reserves the right to change the "Points to dollar conversion rate" ([Citi T&C PDF](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf)).

Two forfeiture rules matter for any earning estimate. "Your Card Account must be current to earn Points," so a missed minimum payment voids that cycle's purchase points unless they are reinstated. Points post at cycle end and "may take up to one additional billing cycle to appear" ([Citi T&C PDF](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf)).

The general exclusion list is the longest of the seven cards. It includes "balance transfers, cash advances, ... traveler's checks, foreign currency purchases, money orders, wire transfers (and similar cash-like transactions), lottery tickets and gaming chips (and similar betting transactions), loads or reloads of balances on gift cards or prepaid cards or cash equivalents, person-to-person payments, Citi® Flex Loans, the creation of Citi® Flex Pays, Card Account fees and charges" (OV, [Citi T&C PDF](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf)).

Citi publishes no MCC rule for this card. The only category, Citi Travel, depends on the booking channel. The March 2022 terms PDF does not mention the Citi Travel bonus at all, so the product pages are the only official source for it.

The welcome bonus could not be confirmed officially: the page renders a template with blanks. Secondary sources report **$200 (20,000 points) after $1,500 in 6 months** (SEC, [CNBC Select](https://www.cnbc.com/select/citi-double-cash-card-welcome-bonus-offer/)).

### Wells Fargo Active Cash: 2% flat with no categories

| Rate | Category | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 2% | All net purchases | "unlimited 2% cash rewards on purchases"; "2% cash rewards are earned for every $1 spent in net purchases (purchases minus returns/credits)"; "zero categories to track" | None stated ("unlimited") | None | [WF product page](https://creditcards.wellsfargo.com/active-cash-credit-card/) | OF |

**Rewards are dollar-denominated cash rewards.** Statement credits start at a $1 minimum and gift cards at $10, "Pay with Rewards" works at PayPal, and rewards do not expire while the account is open ([WF product page](https://creditcards.wellsfargo.com/active-cash-credit-card/)).

The exclusions are unusually specific. Beyond the usual cash-advance and balance-transfer items, they name "pre-paid gift cards, person-to-person money transfers, digital currencies (to the extent accepted), and wire transfers", as well as "off-track wagers, lottery tickets, or bets or wagers transmitted over the internet" (OF, [WF product page](https://creditcards.wellsfargo.com/active-cash-credit-card/)). Wells Fargo does not publish a merchant-category rule, and the card does not need one.

The current offer is **"Earn a $100 cash rewards bonus when you spend $500 in purchases in the first 3 months"**. You may be ineligible if you hold the card or opened one "within the last 48 months". There is also a 0% intro APR for 12 months ([WF product page](https://creditcards.wellsfargo.com/active-cash-credit-card/)). The full Wells Fargo Rewards Program Terms were not retrieved.

### Chase Freedom Unlimited: 1.5% base with MCC-defined 3% categories

| Rate (total) | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 1.5% | All purchases | "Earn unlimited 1.5% cash back or more on all purchases" | None stated | None | [Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited) | OF |
| 3% | "dining at restaurants, including takeout and eligible delivery services" | "This category's merchants' primary business is sit-down or eat-in dining, including fast food restaurants and fine dining establishments." Excludes bakeries, caterers, meal-kit delivery, gift-card merchants, and food merchants inside stadiums, hotels, casinos and theme parks unless coded as restaurants (PA). SEC adds "grocery and department stores" ([WalletHub](https://wallethub.com/answers/cc/chase-freedom-restaurants-2140749970/)). | None stated | None | [Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited); [Chase Rewards Category FAQ](https://www.chase.com/personal/credit-cards/rewards-category-faq) | OF (definition); PA (exclusions) |
| 3% | "drugstore purchases" | "Merchants in this category specialize in selling prescription drugs and over-the-counter medicines, supplements, and various health-related items." Excludes warehouse clubs, discount stores and grocery stores, even ones with an onsite pharmacy (PA). | None stated | None | [Chase Rewards Category FAQ](https://www.chase.com/personal/credit-cards/rewards-category-faq) | OF / PA |
| 5% | "travel purchased through Chase Travel" | "This category includes prepaid travel purchases made on chasetravel.com or by calling the number on the back of your card to book." Excludes FROSCH by Chase Travel, Valerie Wilson Travel by Chase Travel, and Frosch International Travel LLC (PA). | None stated | Must book via Chase Travel | [Chase Rewards Category FAQ](https://www.chase.com/personal/credit-cards/rewards-category-faq) | OF / PA |
| 2% total | Lyft (partner promo) | "2% cash back total on qualifying Lyft products and services" | None stated | Temporary, through **09/30/2027** | [Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited) | OF |

The fetch returned "eligible delivery" once and "eligible delivery services" once, so the exact dining label needs a live check. The category rates are **totals, not increments on 1.5%**, which the "1.5% cash back or more" wording implies.

**Rewards are Ultimate Rewards points at $0.01 for cash**: "Each $1 in Cash Back rewards earned is equal to 100 points", "There is no minimum to redeem for cash back", and rewards "do not expire as long as your account is open" ([Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited)). A reported $0.008/point Amazon Shop with Points rate came back garbled from the fetch and is unconfirmed.

Chase's purchase exclusions cover "balance transfers, cash advances, travelers checks, foreign currency, money orders, wire transfers or similar cash-like transactions, lottery tickets, casino gaming chips, race track wagers or similar betting transactions, any checks that access your account, interest, unauthorized or fraudulent charges, and fees of any kind" (OF, [Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited)).

Chase states its categorization rule more clearly than any other issuer here. Merchants are "assigned a merchant code, which is determined by the merchant or its processor in accordance with Visa/Mastercard procedures based on the kinds of products and services they primarily sell. We group similar merchant codes into categories." Purchases through "third-party payment accounts, mobile or wireless card readers, online or mobile digital wallets, or similar technology will not qualify in a rewards category if the technology is not set up to process the purchase in that rewards category" (OF, [Chase Rewards Category FAQ](https://www.chase.com/personal/credit-cards/rewards-category-faq)). The FAQ page shows no date.

The temporary offers are:

- A **$200 bonus after $500 in 3 months**. It is not available to current cardmembers or to anyone who received a bonus in the past 24 months.
- A 0% intro APR for 15 months.
- DashPass for 6 months, plus up to $10 off quarterly through 12/31/2027.
- The Lyft 2% above ([Chase product page](https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited)).

Freedom Unlimited has **no rotating categories**. The quarterly 5% activation categories belong to Freedom Flex, and evaluation data must not mix the two ([The Points Guy](https://thepointsguy.com/credit-cards/activate-chase-freedom-5x-earnings/)).

### Capital One Quicksilver: 1.5% plus two portals

| Rate | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 1.5% | All other purchases | "Earn unlimited 1.5% cash back on every purchase, every day." Terms: "1.5% cash back on all other purchases." "Earnings will apply to net purchases (purchases minus any credits or returns) only." | "There is no cap to the amount of rewards you can earn on purchases." | None | [QS-PDP / QS-APP](https://www.capitalone.com/credit-cards/quicksilver/) | OV |
| 5% | Capital One Travel | "5% cash back on hotels, vacation rentals and rental cars booked through Capital One Travel using this Rewards card account". "All purchases made outside of Capital One Travel such as hotel incidentals, upgrades or other expenses, will not earn the enhanced earn rate, but will receive the standard 1.5% cash back earn rate." Flights earn 1.5% (PA). | No cap | Book via portal | [QS-APP](https://www.capitalone.com/credit-cards/quicksilver/) | OV |
| 5% | Capital One Entertainment | "Qualifying purchases include tickets purchased on the Capital One Entertainment ticketing platform only, paid for with an eligible Capital One rewards card. Tickets purchased through the Capital One cardholder exclusive pre-sales and tickets purchased directly through the Capital One Hall or Capital One Arena ticketing services are excluded." Footnote: "valid for consumer, non-commercial use only." | No cap | Book via platform | [QS-APP; QS-PDP fn 3](https://www.capitalone.com/credit-cards/quicksilver/) | OV |
| 3% (targeted only) | Grocery and gas, on Discover-network conversions | Not on the public page. Reported in 2026 emails to select cardholders, who must activate the new Discover card. | Unknown | Activation of new card | [Doctor of Credit](https://www.doctorofcredit.com/capital-one-quicksilver-moves-to-discover-network-get-3-cashback-on-gas-grocery-1-5-everywhere/); [Miles to Memories](https://milestomemories.com/capital-one-quicksilver-switching-to-discover-network/) | SEC |

Capital One's own April 2, 2026 article adds **"activities"** to the Capital One Travel 5% list ([Capital One Learn & Grow](https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/)). The application terms do not include activities, so treat the terms as controlling.

Rewards are paid **as cash, not points**. They can be redeemed "for any amount" as a statement credit or check, or through automatic redemption at a set date or threshold. They can also cover purchases posted within the last 90 days, or go toward gift cards, PayPal Pay with Rewards and Amazon Shop with Points. Rates for the non-cash options "may vary." Rewards "will not expire" for the life of the account ([QS-APP / QS-RT](https://www.capitalone.com/credit-cards/quicksilver/)). Statement credits "cannot be used to meet any minimum payment obligations" (QS-PDP fn 8).

The general exclusions are narrow: "Cash advances, balance transfers, fees, interest charges, and checks used to access your account are not considered purchases." Pending transactions earn nothing, merchandise bought with rewards earns nothing, and eligibility is "determined at our sole discretion" ([QS-RT](https://www.capitalone.com/credit-cards/quicksilver/)). **Capital One's published terms do not list gift cards, prepaid loads or P2P payments as ineligible.** A schema should not import those exclusions from other issuers.

The current offer is **$200 after $500 in 3 months**. It is page-specific ("may not be available if you navigate away"), with a 48-month repeat-bonus rule. There is also a 0% intro APR for 15 months ([QS-PDP fn 1](https://www.capitalone.com/credit-cards/quicksilver/)).

### Capital One Savor: 3% on four MCC and merchant-list categories

| Rate | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 3% | "purchases made at grocery stores" | FAQ: "A supermarket, meat locker, freezer, dairy product store and specialty market. Excludes superstores like Walmart® and Target®." Terms: "Grocery purchases made at gas stations, convenience stores, warehouse clubs, discount stores, and super stores (or at grocery stores associated with discount stores or super stores) will earn 1% cash back." | No cap | None | [SV-PDP FAQ / SV-APP](https://www.capitalone.com/credit-cards/savor/) | OV |
| 3% | "dining" | FAQ: "Purchases at restaurants, cafes, bars, lounges, fast-food chains and bakeries." | No cap | None | [SV-PDP FAQ](https://www.capitalone.com/credit-cards/savor/) | OV |
| 3% | "qualified entertainment purchases" | "a ticket purchase made at a movie theatre, record store, video rental location (excluding digital streaming and subscription services), tourist attraction, amusement park, aquarium, zoo, dance hall, billiard and pool establishment, bowling alley, commercial sports promoter (professional or semi-professional live sporting events), theatrical promoter, or concert promoter." Excludes "golf courses, country clubs (including membership fees), collegiate sporting events categorized as "universities", charitable organizations that provide live entertainment, amusement park tickets purchased on third-party sites or on entertainment and resort packages categorized as "travel" or "hotel"." Third-party sites or miscoded vendors earn 1%. | No cap | None | [SV-APP](https://www.capitalone.com/credit-cards/savor/) | OV |
| 3% | "popular streaming services" | "Streaming includes purchases made from eligible music and video streaming services. Some services such as Verizon FIOS On Demand, audiobook subscription and fitness programming are excluded." FAQ examples: "including but not limited to Netflix ®, Hulu ® and Disney +". | No cap | None | [SV-APP / SV-PDP FAQ](https://www.capitalone.com/credit-cards/savor/) | OV |
| 8% | Capital One Entertainment | "Qualifying purchases include tickets purchased on the Capital One Entertainment ticketing platform only..." Same exclusions as Quicksilver (pre-sales; Capital One Hall/Arena). The footnote omits the pre-sale exclusion and adds "Online account required." | No cap | Book via platform | [SV-APP; SV-PDP fn 4](https://www.capitalone.com/credit-cards/savor/) | OV |
| 5% | Capital One Travel | "5% cash back on hotels, vacation rentals and rental cars booked through Capital One Travel". Incidentals and upgrades earn "the standard 1% cash back earn rate". | No cap | Book via portal | [SV-APP](https://www.capitalone.com/credit-cards/savor/) | OV |
| 1% | All other purchases | "1% cash back on all other purchases" | No cap | None | [SV-APP](https://www.capitalone.com/credit-cards/savor/) | OV |

The three official layers (tiles, FAQ, application terms) differ in ways that matter for schema design:

- **Grocery:** the terms add gas stations, convenience stores, warehouse clubs and discount stores to the grocery exclusions.
- **Entertainment:** the terms list video rental, concert promoters and country clubs, which the FAQ does not.
- **Capital One Entertainment:** the pre-sale exclusion appears in the terms but not in the footnote.

**Use the application terms as the gold evidence span.**

The categorization rule is stated plainly. "Capital One uses merchant category codes to determine if a purchase is within one of the additional cash back categories." The terms give examples of miscoding: food trucks, restaurants inside hotels or department stores, and amusement parks that code online tickets as merchandise. They conclude that "Capital One is not responsible for merchant category codes used by merchants." The FAQ adds that third-party payment accounts, mobile or wireless card readers and digital wallets "may not receive a higher percentage reward, depending on how the technology is set up to process the purchase" ([SV-APP / SV-PDP FAQ](https://www.capitalone.com/credit-cards/savor/)).

Rewards, redemption and general exclusions are the same as on Quicksilver. The offer is **$200 after $500 in 3 months** with a 0% intro APR for 12 months, a $0 annual fee and no foreign transaction fee ([SV-PDP](https://www.capitalone.com/credit-cards/savor/)).

### Amex Blue Cash Everyday: three separately capped 3% categories

| Rate | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 3% | "at supermarkets located in the U.S." (tile: "U.S. supermarkets") | "(superstores, convenience stores, warehouse clubs, and meal-kit delivery services are not considered supermarkets)". Rewards-info adds: "A supermarket offers a wide variety of food and household products..." Specialty stores (bakeries, butchers, liquor, wine) are not eligible, and neither are "online superstores (e.g., Amazon)". | "the first $6,000 of eligible purchases across the Card Account in a calendar year (then 1%)" | None | [BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms); [rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html) | OV |
| 3% | "U.S. online retail purchases" | "the purchase must be made on a website or a digital application (an app) from a U.S. retail merchant that sells physical goods or merchandise directly to consumers. To identify eligible online retail purchases, we rely on information provided to us by the merchant. The following are not considered retail purchases: purchases made at restaurants, supermarkets, gasoline stations, or automotive dealers, as well as purchases of travel, entertainment, or other services. Payment must be made online and categorized as an internet transaction by the merchant for the purchase to be eligible." Excludes ordered-online-paid-in-store, in-store wallet or contactless payments, phone or mail orders, and third-party "buy now pay later". | "the first of $6,000 of U.S. online retail purchases across the Card Account (then 1%)". "Calendar year" is not stated in this clause. | None | [BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms) | OV |
| 3% | "purchases of gasoline at gas stations located in the U.S" | "(superstores, supermarkets and warehouse clubs that sell gasoline are not considered gas stations)". Rewards-info: "a merchant that is in the primary business of selling gasoline to consumers". A gas station that is also a convenience store may qualify. Marina and commercial fuel do not. | "the first $6,000 ... across the Card Account (then 1%)" | None | [BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms); [rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html) | OV |
| 1% | All other eligible purchases | "1% on all other eligible purchases" | None | None | [BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms) | OV |

**Each 3% category has its own $6,000 cap.** The product FAQ says "for each category on up to $6,000 per year," and the caps count "across the Card Account", meaning Basic and Additional Cards combined ([BCE product page](https://www.americanexpress.com/us/credit-cards/card/blue-cash-everyday/)). The terms say "calendar year" only in the supermarket clause. Treat calendar year as the likely period for all three, and record the wording gap.

### Amex Blue Cash Preferred: 6% supermarkets and streaming, uncapped except groceries

| Rate | Category (issuer wording) | Definition / exclusions | Cap | Activation | Source | Label |
|---|---|---|---|---|---|---|
| 6% | "at supermarkets located in the U.S." | Same exclusions as BCE | "the first $6,000 of eligible purchases in a calendar year (then 1%)" | None | [BCP terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-preferred-credit-card/25330-10-0#offer-terms) | OV |
| 6% | "U.S. streaming subscriptions from select providers" | "(the current list of select providers is available at americanexpress.com/rewards-info). If a subscription is bundled with another product or service or billed by a third party (such as a digital platform, a cable, telecommunications, or internet provider, or a car manufacturer), the purchase may not be eligible". The list has 32 providers, including Amazon Music Unlimited, Apple TV+, Audible, Disney+, ESPN, HBO Max, Hulu, Kindle Unlimited, Netflix, Peacock, Prime Video, SiriusXM, Spotify and YouTube TV. | None stated | None | [BCP terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-preferred-credit-card/25330-10-0#offer-terms); [rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html) | OV |
| 3% | "transit" | "including trains, taxicabs, ride share services, ferries, tolls, parking, buses, and subways (airfare, car rental and cruises are not considered transit)" | None stated | None | [BCP terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-preferred-credit-card/25330-10-0#offer-terms) | OV |
| 3% | "gasoline at gas stations located in the U.S." | "(superstores, supermarkets and warehouse clubs that sell gasoline are not considered gas stations)" | None stated | None | [BCP terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-preferred-credit-card/25330-10-0#offer-terms) | OV |
| 1% | All other eligible purchases | "1% cash back on all other eligible purchases" | None | None | [BCP terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-preferred-credit-card/25330-10-0#offer-terms) | OV |

Earlier secondary-sourced notes said the BCP gas rate was unverified on an issuer page. The rendered BCP terms confirm it. The rewards-info page has no transit section, so the terms clause is the only official transit definition.

### Amex rules shared by both cards

Both cards earn **"Reward Dollars"** "based on a percentage of the dollar amount of eligible purchases during each billing period." They are redeemable "for statement credits or for eligible items at Amazon.com checkout with no minimum redemption amount," but "cannot use cash back to pay the Minimum Due" ([BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms)). Amex says "Your cash back has the same value at Amazon checkout as it does if you redeem as a statement credit" ([BCP product page](https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/)). That implies **1 Reward Dollar = $1**, although no page states the conversion outright.

The eligible-purchase definition excludes "fees or interest charges, balance transfers, cash advances, purchases of travelers checks, purchases or reloading of prepaid cards, purchases of other cash equivalents., gift cards, person-to-person transactions, or any portion of a purchase that is covered by Reward Dollars at point of sale" (OV, both terms pages). This means **gift cards earn nothing on either Amex card, whatever the merchant category.**

Amex states its categorization rule as follows: "Merchants are assigned codes based on what they primarily sell. ... A purchase with a merchant will not earn additional rewards if the merchant's code is not included in a reward category." Cardholders "may not receive additional rewards" when a merchant uses a third party to sell or to process the transaction, or when "you choose to make a purchase using a third-party payment account or make a purchase using a mobile or digital wallet" (OV, both terms pages). A web-search summary claimed Amex language about "online marketplace (with multiple retailers)" purchases. **That phrase appears nowhere in the BCE/BCP terms, benefit pages or rewards-info page, so it must not be used as an evidence span.**

Neither card has rotating or selectable categories, and the earning categories need no activation. Enrollment applies only to credits. The **Disney Streaming Credit** is $84 a year ($7 a month) on BCE and $120 a year ($10 a month) on BCP. It applies to DisneyPlus.com, Hulu.com or Stream.ESPN.com, requires enrollment, and has no minimum. BCE's **$180 Home Chef credit** still appears in the terms but no longer on the rendered product page. The **Amex Venue Collection concessions credit** (10% back up to $250 per calendar year) is marked "Offer ends 12/31/2026" ([BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms)).

Fees and offers:

| | BCE | BCP |
|---|---|---|
| Annual fee | $0 | "$0 intro annual fee for the first year, then $95" |
| Welcome offer | "AS HIGH AS $200" after $2,000 in 6 months | "AS HIGH AS $300" after $3,000 in 6 months |
| Intro APR | 0% for 15 months | 0% for 12 months |
| Foreign transaction fee | 2.7% | 2.7% |

Sources: [BCE product page](https://www.americanexpress.com/us/credit-cards/card/blue-cash-everyday/), [BCP product page](https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/). Welcome offers vary by applicant.

## Electronics retailers reduce to one channel test

**Best Buy and Newegg are both reported as MCC 5732 ("Electronics Stores")**, but the only merchant-specific evidence comes from an undated community lookup site with no stated method ([CheckMCC: Best Buy](https://check-mcc.com/merchant/best-buy); [CheckMCC: Newegg](https://check-mcc.com/merchant/newegg)). 5732 is the standard network code for electronics sales ([Mastercard Quick Reference Booklet](https://www.mastercard.us/content/dam/public/mastercardcom/na/global-site/documents/quick-reference-booklet-merchant.pdf); [Citi TTS MCC list](https://www.citibank.com/tts/solutions/commercial-cards/assets/docs/govt/Merchant-Category-Codes.pdf)). The notes found no evidence for the alternatives (5734, 5999, 5311), and no dated Doctor of Credit, FlyerTalk or Reddit data point separating online from in-store coding. The same business can code differently across networks or departments ([NerdWallet](https://www.nerdwallet.com/credit-cards/learn/credit-cards-merchant-category-codes-mcc-explained)). **Label the MCC as "community, medium-low confidence."**

The practical good news is that **none of the seven cards pays a bonus on MCC 5732**, so the exact MCC barely affects the recommendation. What matters is Amex's channel test. The official list of eligible online retail types includes **"Computer & Electronic stores"**, alongside "Major retailers (e.g., Amazon.com, Walmart.com)", pet, furniture, department and apparel stores ([rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html)). Amex names neither Best Buy nor Newegg, but both fit the definition when the order is placed and paid on the website or app.

The same page says "only the online purchases at these eligible retail merchants will qualify". **Buy online, pick up in store qualifies "if the merchant classifies it as an online purchase."** A missed 3% can mean "The merchant classified the purchase as in-store purchase" ([rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html)).

The resulting ladder on bestbuy.com and newegg.com is:

1. **BCE 3%**, if paid online and cap remains.
2. **Citi Double Cash 2%** (1% now, 1% on payment) or **Wells Fargo Active Cash 2%**.
3. **Chase Freedom Unlimited 1.5%** or **Quicksilver 1.5%**.
4. **Savor 1%** or **BCP 1%**.

Several edge cases should be labeled "uncertain" rather than "qualifies" in the evaluation set:

- Checkout through PayPal or another third-party payment account falls under Amex's "may not receive additional rewards" clause.
- Affirm, Zip or similar BNPL is explicitly excluded from online retail.
- Newegg Marketplace third-party sellers fall under the third-party-seller clause. The notes found no evidence either way on how they post.
- Geek Squad services, protection plans and installation are plausibly "other services." This is an inference, not confirmed by Amex.
- Gift cards bought on either site earn nothing on Amex. On Citi and Wells Fargo, gift cards are excluded only as loads or reloads and as "pre-paid gift cards," respectively.

Merchant-specific community data exists only as an open Doctor of Credit comment thread from 2023 that would need a manual search ([Doctor of Credit](https://www.doctorofcredit.com/which-online-retailers-earn-3-with-american-express-blue-cash-everyday-card/)).

## A twelve-bucket taxonomy with four rule bases

A common internal enum works as long as each bucket carries a **basis** and per-issuer includes and excludes. Assuming "grocery" means the same thing everywhere would produce wrong answers.

The four bases are:

- **`mcc_group`**: issuer groups merchant codes, and the issuer disclaims responsibility for coding.
- **`channel`**: the transaction must be internet-flagged by the merchant. Only Amex online retail uses it.
- **`merchant_list`**: named providers.
- **`portal`**: the booking must go through the issuer's own site.

Citi's payment-triggered 1% needs its own **`earn_event: payment`** attribute rather than a category. It also needs a Purchase Tracker constraint, and an estimator should display it as "2% if paid (1% at purchase)."

| Internal key | Basis | Cards | Material definitional differences |
|---|---|---|---|
| `base` | all purchases | all 7 | Exclusion lists differ. Citi, WF and Amex exclude gift-card or prepaid loads and P2P; Capital One lists neither; WF alone names digital currency ([Citi PDF](https://www.citi.com/CRD/PDF/DoubleCashThankyouTC.pdf); [WF](https://creditcards.wellsfargo.com/active-cash-credit-card/)) |
| `online_retail` | channel + merchant type | BCE | U.S. physical-goods merchant, internet-flagged. Excludes BNPL, phone or mail, paid-in-store, services, travel, restaurants, supermarkets, gas, auto dealers ([rewards-info](https://www.americanexpress.com/us/rewards-info/retail.html)) |
| `grocery` | mcc_group | BCE, BCP ("U.S. supermarkets"); Savor ("grocery stores") | **Amex excludes specialty food stores; Capital One includes "specialty market", meat lockers and dairy.** Both exclude superstores and warehouse clubs. Capital One also excludes gas stations and convenience stores; Amex excludes convenience stores and meal kits. Amex counts online grocery as supermarket. |
| `gas` | mcc_group | BCE, BCP | Amex: primary business selling gasoline; excludes superstores, supermarkets and warehouse clubs; gas-plus-convenience may qualify; marina and commercial fuel excluded. EV charging not addressed. |
| `dining` | mcc_group | Chase FU, Savor | **Bakeries: Savor includes, Chase excludes.** Chase includes takeout and "eligible delivery services" and excludes caterers and meal kits. Both warn about restaurants inside hotels and stadiums. |
| `drugstore` | mcc_group | Chase FU | Excludes warehouse clubs, discount stores, and grocery stores with pharmacies |
| `entertainment` | mcc_group | Savor | Ticket-based venue list. Excludes golf, country clubs, collegiate "universities", charity events and third-party ticket sites. |
| `streaming` | merchant_list | BCP (6%), Savor (3%) | **Amex publishes a 32-provider list including Audible and Kindle Unlimited; Capital One excludes audiobooks and fitness and publishes only examples.** Both warn about bundled or third-party billing. |
| `transit` | mcc_group | BCP | Trains, taxis, rideshare, ferries, tolls, parking, buses, subways. Excludes airfare, car rental, cruises. |
| `lyft_promo` | merchant_list, temporary | Chase FU | 2% total through 2027-09-30 |
| `portal_travel_all` | portal | Chase FU 5% | Prepaid travel via chasetravel.com or phone; FROSCH and Valerie Wilson excluded |
| `portal_travel_hotel_car` | portal | Citi DC 5%; Quicksilver and Savor 5% | **Citi covers attractions but not air; Capital One covers vacation rentals but not flights or incidentals** |
| `portal_entertainment` | portal | Quicksilver 5%, Savor 8% | Capital One Entertainment tickets; pre-sales and Capital One Hall/Arena excluded |

For the schema, each rule needs the following fields:

- `rate_is_total` (true for Chase, Capital One and Amex; Citi's "additional 3%" is an increment on 2%)
- `cap {amount, period, scope: per_category | account}`
- `post_cap_rate`
- `activation_required`
- `valid_from` / `valid_to`
- `source_url`, `quote`, `quote_status (OV|OF|PA|SEC)`, `checked_on`

Each merchant needs `expected_mcc`, `mcc_confidence` and `mcc_sources`. Each recommendation needs a `payment_path` modifier (direct card, PayPal, wallet, BNPL) that lowers confidence. Chase, Capital One and Amex each warn about wallets and third-party payment accounts, and Amex excludes BNPL outright from online retail.

## What changed in 2025–2026 and which claims are now stale

The table below lists the dated changes. Any document asserting the "stale" column should be flagged.

| Card | Change | Date | Stale claims to flag | Source |
|---|---|---|---|---|
| Citi Double Cash | Citi Travel hotels, car rentals and attractions made permanent at 5% total | Effective 2025-05-18 | "Additional 4% ... through 6/30/2026"; any end date on Citi Travel | SEC, [Upgraded Points (updated 2026-09-17)](https://upgradedpoints.com/news/citi-permanent-5x-earnings-double-cash-custom-cash/) |
| Wells Fargo Active Cash | Official bonus is $100 after $500 in 3 months | Observed 2026-09-28; drop date unknown | "$200 bonus" (still common in 2026 reviews) | [WF](https://creditcards.wellsfargo.com/active-cash-credit-card/); contra SEC [Upgraded Points](https://upgradedpoints.com/credit-cards/reviews/wells-fargo-active-cash/) |
| Chase Freedom Unlimited | Temporary $250 bonus, then back to $200; card design refresh; no rate change | 2026-03-16 to 2026-04-30 | "$250 bonus" | SEC, [NerdWallet (snippet)](https://www.nerdwallet.com/credit-cards/news/chase-freedom-unlimited-changes-welcome-bonus-march-2026); [Doctor of Credit](https://www.doctorofcredit.com/chase-launches-new-design-on-chase-freedom-unlimited/) |
| Capital One Savor | SavorOne renamed Savor; the old $95 Savor had closed to new applicants in July 2024 | 2024-10-22 | "Savor = $95 fee, 4% dining" | SEC, [Upgraded Points](https://upgradedpoints.com/news/capital-one-changes-savorone-savor-card/) |
| Capital One SavorOne | Revived as a separate $39 fair-credit card with the same earn rates | 2025-08-20 | "SavorOne = the no-fee card" | SEC, [Upgraded Points](https://upgradedpoints.com/news/capital-one-savorone-card-relaunch/); [WTOP](https://wtop.com/news/2025/09/capital-one-brings-back-the-savorone-card-for-those-with-fair-credit/) |
| Capital One Quicksilver | Targeted move to the Discover network with 3% grocery/gas; activation required; old cards stopped 2026-07-09; later wave with a 2026-09-01 deadline | Emails 2026-04-21 onward | "Quicksilver has 3% grocery/gas" (true only for converted accounts); "Quicksilver is always Visa/Mastercard" | SEC, [Doctor of Credit](https://www.doctorofcredit.com/capital-one-quicksilver-moves-to-discover-network-get-3-cashback-on-gas-grocery-1-5-everywhere/); [Miles to Memories](https://milestomemories.com/capital-one-quicksilver-switching-to-discover-network/); [Perkmon](https://perkmon.com/blog/capital-one-quicksilver-discover-3-percent-2026) |
| Capital One Quicksilver | 5% Capital One Entertainment now in the terms | Date added unconfirmed; present by 2026-04-02 | Any Quicksilver doc without it | [Capital One Learn & Grow](https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/) |
| Amex BCE/BCP | Disney Bundle credit became the Disney Streaming Credit: no $9.99 minimum; BCP raised to $10/month ($120/year); standalone Disney+, Hulu and ESPN eligible | 2025-08-01 per DoC; reported 2025-11-25 by UP | "$9.99 minimum", "Disney Bundle credit", "Plus.espn.com", "BCP $84/$7" | SEC, [Doctor of Credit](https://www.doctorofcredit.com/american-express-blue-cash-everyday-blue-cash-preferred-enhanced-streaming-benefits-disney-hulu-espn/); [Upgraded Points](https://upgradedpoints.com/news/amex-blue-cash-cards-disney-streaming-credit/) |
| Amex BCP | Streaming list expanded to "nearly 3 dozen" services | 2025 | Short pre-2025 streaming lists | SEC, [Upgraded Points](https://upgradedpoints.com/news/amex-blue-cash-cards-disney-streaming-credit/) |
| Amex BCE | Home Chef $180 credit removed from the rendered product page but still in the terms | Observed 2026-09-28 | Treat as possibly phasing out | [BCE terms](https://www.americanexpress.com/us/credit-cards/card-application/apply/prospect/terms/blue-cash-everyday-credit-card/25330-10-0#offer-terms) |

The notes found no evidence of changes to earning rates or caps on Wells Fargo, Chase Freedom Unlimited, public Quicksilver, Savor, BCE or BCP during 2025–2026. BCE's current 3% gas and online retail structure dates from the July 2022 refresh ([Business Wire](https://www.businesswire.com/news/home/20220714005286/en/American-Express-Enhances-Blue-Cash-Everyday-Card-with-New-Design-Cash-Back-Rewards-and-Benefits)).

## Open uncertainties to resolve before labeling gold data

| # | Uncertainty | Why it matters |
|---|---|---|
| 1 | Citi, Wells Fargo and Chase quotes came through a summarizing fetch (OF) and need character-level re-checks, including Chase "eligible delivery" vs "eligible delivery services" | Evidence-span exact match |
| 2 | No official Citi definition of "attractions", of what counts as a Citi Travel booking, or of prepaid vs pay-at-property hotels | Portal-rule scope |
| 3 | Citi's 5%-total wording is on the product pages only; the terms PDF (March 2022) is silent; no Citi press release found | Source authority for the Citi Travel rule |
| 4 | Citi welcome bonus not visible officially (template blanks); $200/$1,500/6 months is secondary | Offer extraction |
| 5 | Chase cap-free status rests on the word "unlimited"; no explicit "no cap" sentence; FAQ page undated | Cap field |
| 6 | Chase Amazon Shop with Points value ($0.008) garbled; Chase Ultimate Rewards agreement and Wells Fargo Rewards Program Terms not retrieved | Redemption values |
| 7 | Capital One's Quicksilver Travel "activities" (Learn & Grow, 2026-04-02) vs application terms (no activities) | Conflict between official sources |
| 8 | No official terms for the targeted Quicksilver 3% grocery/gas: definitions, superstore exclusions and cap all unknown; opt-out and wave dates conflict across secondary sources | Per-account rule variants |
| 9 | Capital One publishes no MCC lists or complete streaming list; Amex publishes no MCC lists or transit merchant examples | MCC mapping is inferred |
| 10 | Amex BCE online retail and gas clauses omit "calendar year"; counting of returns against caps not stated | Cap period |
| 11 | No official conversion of 1 Amex Reward Dollar = $1 (implied only) | Cash value field |
| 12 | Best Buy and Newegg MCC 5732 from an undated community site only; no online vs in-store data; no data on Newegg Marketplace, PayPal routing, Geek Squad or activation postings | Merchant map confidence |
| 13 | Amex treatment of PayPal-routed, marketplace-seller and in-app wallet payments for online retail is only "may not" | Label these uncertain, not ineligible |
| 14 | Disney credit change date (2025-08-01 vs 2025-11-25); Home Chef status; pre-2025 BCP streaming list not collected | Stale-data dating |
| 15 | Wells Fargo $200 to $100 bonus change date unknown; Savor 8% Capital One Entertainment history since 2022 unverified | Stale-data dating |
| 16 | Full cardholder agreements (Capital One, Chase, Wells Fargo) not reviewed | Hidden exclusions |

## Conclusion

The hard part of this problem is not the rates, which are few and stable. It is that the same English category word maps to different merchant sets per issuer, and that only some rules can be evaluated from what a Chrome extension actually sees. At checkout the extension observes the domain and the payment path, not the MCC that will post. Channel rules (Amex online retail) and portal rules (which never fire on retail sites) can therefore be decided with high confidence. MCC rules can only be predicted from a community-sourced merchant map. For the evaluation set, the most informative cases are the ones where issuers disagree or hedge:

- Walmart.com: eligible as Amex online retail, yet Walmart is excluded as a supermarket.
- Bakeries: dining at Capital One, excluded at Chase.
- Audible: 6% streaming at Amex, excluded at Capital One.
- BNPL or PayPal checkouts at bestbuy.com.
- Citi's payment-contingent 1%.

The 2025–2026 changes point to a design requirement as well. Targeted, per-account variants such as the Discover-network Quicksilver mean a card product name no longer determines its rules, so the schema should let a user's own account override the public product template. Every rule should also carry its checked-on date, so that bonus figures that expired in 2025 or 2026 can be caught and flagged.
