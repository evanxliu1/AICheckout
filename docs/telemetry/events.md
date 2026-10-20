# AI Checkout usage report dictionary

Generated from the telemetry contract (`packages/catalog-review/src/telemetry.ts`, schema version 1) by `npm run telemetry`; `npm run telemetry:check` fails in CI when this file is stale. Do not edit by hand.

AI Checkout sends usage reports only after the shopper chooses **Share** on the onboarding screen (or turns sharing on in Settings), and only in builds made with usage reporting on. Every report carries the envelope below under a **random identifier**: no name, email or browsing history. The identifier is created when sharing starts and cleared by **Stop sharing** and **Delete my data**; a later Share creates a new one. The two shopper-initiated events (`store_suggested`, `problem_reported`) are sent on the shopper's own tap whether sharing is on or not, and carry no identifier when it is off.

**No automatic event carries a store name, domain, web address, page text or card number.** A store's registrable domain travels only on the two tap events. Amounts are integer cents. Raw reports are kept for 90 days; the service stores at most 500 events per identifier per day and 20,000 per day in all, and accepts batches of at most 50 events and 65,536 bytes. The extension keeps at most 200 unsent events on the device and sends them every 15 minutes while any wait, or at once when 50 are waiting, at consent and on each tap.

## Envelope (every event)

| Field                | Type                                                                                        | Meaning                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `event_id`           | UUID v4                                                                                     | Client-generated id; a repeated id is stored once                                                                                          |
| `client_at`          | string ISO 8601 timestamp in UTC (`Z`)                                                      | When the extension built the event (UTC)                                                                                                   |
| `install_month`      | string matching `^[0-9]{4}-(0[1-9]\|1[0-2])$`                                               | Month the random identifier was created (YYYY-MM)                                                                                          |
| `days_since_install` | one of `0`, `1-6`, `7-13`, `14-29`, `30-59`, `60+`                                          | Days since the identifier was created, bucketed                                                                                            |
| `consent_version`    | always `1`                                                                                  | Version of the consent text the shopper accepted                                                                                           |
| `schema_version`     | always `1`                                                                                  | Version of this event dictionary                                                                                                           |
| `extension_version`  | string of at most 20 characters matching `^[0-9]+\.[0-9]+\.[0-9]+$`                         | Extension version                                                                                                                          |
| `catalog_version`    | string of at most 80 characters matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$` | Card catalog in effect                                                                                                                     |
| `merchants_version`  | string of at most 80 characters matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$` | Merchant release in effect                                                                                                                 |
| `reader_version`     | string matching `^[a-z0-9-]{1,40}$`                                                         | Cart reader version (generic-reader-v1)                                                                                                    |
| `install_id`         | UUID v4 on automatic events; UUID v4 or null on `store_suggested` and `problem_reported`    | Random identifier created at consent; reset by Stop sharing and Delete my data. On the two tap events null when the shopper is not sharing |

## Events

### `consent_granted`

**When:** Once, when the shopper chooses Share on the onboarding consent screen or turns sharing back on in Settings; queued first, so it doubles as the install event. Stop sharing and Delete my data clear the identifier; a later Share mints a new one and sends this again.

_No fields beyond the envelope._

### `onboarding_completed`

**When:** Once, with `consent_granted`, when Share is chosen on the onboarding screen.

| Field         | Type                 | Meaning                        |
| ------------- | -------------------- | ------------------------------ |
| `cards_count` | integer from 0 to 20 | Cards picked during onboarding |

### `wallet_changed`

**When:** With `consent_granted` (the cards owned when sharing starts) and on every save of the card list in the popup.

| Field      | Type                                                                                 | Meaning                                                               |
| ---------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `card_ids` | array of string of at most 80 characters matching `^[a-z0-9][a-z0-9-]*$`, at most 20 | Catalog ids of the owned cards (never numbers, last four or balances) |

### `recommendation_shown`

**When:** Once per distinct recommendation in a tab (the reading, store, payment path and top card) when the badge shows the amount or rates view, and in the popup when a read cart is compared or the rates view is shown. A comparison of an amount the shopper typed is not reported (nothing was read). In this version the rates view's `withheld_reason` is always `withheld` (the reader's finer reasons stay on the device).

| Field                | Type                                                                                                                                                                                                           | Meaning                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `surface`            | one of `badge`, `popup`                                                                                                                                                                                        | Where the recommendation appeared                                              |
| `view`               | one of `amount`, `rates`                                                                                                                                                                                       | Which view the badge or popup showed                                           |
| `withheld_reason`    | string matching `^[a-z][a-z0-9-]{0,39}$`, or null                                                                                                                                                              | Reader code when the amount was withheld (rates view); null in the amount view |
| `page`               | one of `cart`, `checkout`, `popup-read`                                                                                                                                                                        | Where the reading came from                                                    |
| `store_kind`         | one of `named`, `generic`                                                                                                                                                                                      | Whether the merchant release named the store or the generic profile applied    |
| `evidence_basis`     | one of `issuer`, `mcc`, `corroborated`, `definition`, `default`, `none`                                                                                                                                        | Evidence behind the store category                                             |
| `category`           | one of `electronics`, `general-merchandise`, `supermarkets`, `gas`, `ev-charging`, `dining`, `drugstores`, `entertainment`, `streaming`, `transit`, `department-stores`, `home-improvement`, `wholesale-clubs` | Merchant category used for the comparison                                      |
| `amount_cents`       | integer from 0 to 99,999,999, or null                                                                                                                                                                          | Cart amount read, in integer cents (amount view only); never with a domain     |
| `amount_kind`        | one of `total`, `estimated-total`, `subtotal`, or null                                                                                                                                                         | Which amount was read (amount view only)                                       |
| `top_card_id`        | string of at most 80 characters matching `^[a-z0-9][a-z0-9-]*$`                                                                                                                                                | Catalog id of the recommended card                                             |
| `cards_count`        | integer from 1 to 20                                                                                                                                                                                           | Cards in the wallet                                                            |
| `ranking_may_change` | boolean                                                                                                                                                                                                        | Whether an unanswered choice or gate could change the ranking                  |

### `badge_expanded`

**When:** Each time the badge panel is opened.

| Field  | Type                     | Meaning                              |
| ------ | ------------------------ | ------------------------------------ |
| `view` | one of `amount`, `rates` | Which view the badge or popup showed |

### `badge_dismissed`

**When:** Each time "Dismiss for this tab" is chosen.

| Field  | Type                     | Meaning                              |
| ------ | ------------------------ | ------------------------------------ |
| `view` | one of `amount`, `rates` | Which view the badge or popup showed |

### `site_disabled`

**When:** Each time "Not on this site" is chosen; the host stays on the device.

| Field        | Type                      | Meaning                                                                     |
| ------------ | ------------------------- | --------------------------------------------------------------------------- |
| `store_kind` | one of `named`, `generic` | Whether the merchant release named the store or the generic profile applied |

### `amount_typed`

**When:** Each time an amount is typed into the badge panel.

| Field                        | Type                                             | Meaning                                                  |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `relative_difference_bucket` | one of `<1%`, `1-5%`, `5-20%`, `>20%`, `no-read` | How far the typed amount was from the read one, bucketed |

### `popup_opened`

**When:** When the popup opens on a tab and reads it (or cannot: a payment page, a non-web tab). Not sent when the popup opens with no cards, or keeps a cart already read or compared in that tab.

| Field          | Type                                                                                    | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `read_outcome` | one of `found`, `withheld`, `not-a-cart`, `empty`, `non-usd`, `payment-page`, `non-web` | What the reader found on the open tab                                       |
| `store_kind`   | one of `named`, `generic`                                                               | Whether the merchant release named the store or the generic profile applied |

### `release_refresh`

**When:** Per release checked by the weekly alarm (`weekly`, with its retry) and for the card catalog on "Check for updated terms" (`manual`).

| Field          | Type                                                                                                 | Meaning                                    |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `kind`         | one of `catalog`, `merchants`                                                                        | Which release was refreshed                |
| `outcome`      | one of `ok`, `skipped`, `failed`                                                                     | Outcome of the refresh                     |
| `from_version` | string of at most 80 characters matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$`, or null | Version before the refresh                 |
| `to_version`   | string of at most 80 characters matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+\.[0-9]+$`, or null | Version after the refresh, when it changed |
| `trigger`      | one of `install`, `weekly`, `manual`                                                                 | What started the refresh                   |

### `error`

**When:** Per caught request failure in the worker, at most 20 a day.

| Field     | Type                                     | Meaning                                              |
| --------- | ---------------------------------------- | ---------------------------------------------------- |
| `code`    | string matching `^[a-z][a-z0-9-]{0,39}$` | Error code; never a message or stack trace           |
| `surface` | string matching `^[a-z][a-z0-9-]{0,39}$` | Where it happened (badge, popup, onboarding, worker) |

### `store_suggested` (shopper-initiated; may carry no identifier)

**When:** On the shopper’s tap on "Suggest this store" (popup) or "Store not recognised? Suggest it" (badge panel), at a store the merchant release does not name. Sent whether sharing is on or not; `install_id` is null when it is off.

| Field    | Type                                                                                                      | Meaning                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `domain` | string of at most 253 characters matching `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$` | Registrable domain of the tab (for example shop.example), sent only on this tap |
| `page`   | one of `cart`, `checkout`, `popup-read`                                                                   | Where the reading came from                                                     |

### `problem_reported` (shopper-initiated; may carry no identifier)

**When:** On the shopper’s tap on "Send report" under "Report a problem" in the popup, with one of the fixed reasons; there is no free text. `view` and `withheld_reason` describe the badge in that tab (`withheld_reason` is always `withheld` in the rates view). Sent whether sharing is on or not; `install_id` is null when it is off.

| Field             | Type                                                                                                      | Meaning                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `domain`          | string of at most 253 characters matching `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$` | Registrable domain of the tab (for example shop.example), sent only on this tap |
| `reason`          | one of `wrong-amount`, `no-badge`, `wrong-store`, `wrong-card`, `other`                                   | Fixed reason; there is no free text                                             |
| `view`            | one of `amount`, `rates`, or null                                                                         | The view shown, or null when there was no badge                                 |
| `withheld_reason` | string matching `^[a-z][a-z0-9-]{0,39}$`, or null                                                         | Reader code when the amount was withheld (rates view); null in the amount view  |

## Not sent in this release

Reserved names, never emitted by this version: `offer_impression`, `offer_click`, `opportunity`. Stop sharing sends nothing (the queue and the identifier are cleared on the device); Delete my data is a request to the service (`POST /v1/events/delete` with the current identifier), not an event.
