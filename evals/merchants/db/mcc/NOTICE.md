# Data attribution (the `mcc` evidence basis)

The merchant release's `mcc` evidence (records whose `evidence.basis` is `mcc`, release `2026-10-11.mcc.1` and later) is derived from openly licensed public card-transaction datasets. The datasets themselves are not redistributed here. `manifest.json` records each one's URL, publisher, licence, fetch date, SHA-256 and row count; `results.json` holds per-store aggregates only (at most 12 merchant-descriptor and merchant-category description fragments with row counts per store, and description tallies). Add this notice wherever the release is listed or credited (Phase 15: the Web Store listing and the site's credits).

**Changes made to the source data:** the transactions were pooled across the datasets, matched to store records by merchant descriptor, and aggregated to per-store counts by merchant category description; no row, amount, cardholder, agency or date is kept or published.

| Dataset | Publisher | Licence |
| --- | --- | --- |
| [Purchase Card (PCard) Fiscal Year 2022](https://data.ok.gov/dataset/pcard-fy-2022), [Fiscal Year 2023](https://data.ok.gov/dataset/purchase-card-pcard-fiscal-year-2023), [Fiscal Year 2024](https://data.ok.gov/dataset/purchase-card-pcard-fiscal-year-2024) | State of Oklahoma, Office of Management and Enterprise Services (data.ok.gov) | [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). This product uses the data; the State of Oklahoma does not endorse it |
| [Purchase Card Transactions](https://opendata.dc.gov/datasets/DCGIS::purchase-card-transactions) | Government of the District of Columbia, Office of the Chief Technology Officer (Open Data DC) | Public domain, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); attribution requested. Data retrieved from the Open Data DC catalog |
| [GSA Purchase Card Transactions, April–June 2020 (3rd quarter, US Bank)](https://catalog.data.gov/dataset/gsa-purchase-card-transactions-apr-june-2020-3rd-qtr-us-bank) | U.S. General Services Administration (GSA SmartPay), via catalog.data.gov | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Merchant category codes are mapped through the Visa Merchant Data Standards Manual (April 2026, marked "VISA PUBLIC", © 2026 Visa); `codes.json` cites it. The Visa manual is referenced, not reproduced.
