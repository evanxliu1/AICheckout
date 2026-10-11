# Data attribution (the `mcc` evidence basis)

The merchant release's `mcc` evidence (records whose `evidence.basis` is `mcc`, release `2026-10-11.mcc.1` and later) is derived from openly licensed public card-transaction datasets. The datasets themselves are not redistributed here; `manifest.json` records each one's URL, publisher, licence, fetch date, SHA-256 and row count, and `results.json` holds per-store tallies (merchant descriptors and merchant-category descriptions with row counts). Add this notice wherever the release is listed or credited (Phase 15: the Web Store listing and the site's credits).

- **State of Oklahoma, Office of Management and Enterprise Services**: "Purchase Card (PCard)" Fiscal Year 2022, Fiscal Year 2023 and Fiscal Year 2024, published on data.ok.gov under the **Creative Commons Attribution (CC BY)** licence. This product uses the data; the State of Oklahoma does not endorse it.
- **Government of the District of Columbia (Open Data DC)**: "Purchase Card Transactions", public domain (**CC0 1.0**; attribution requested). Data retrieved from the Open Data DC catalog.
- **U.S. General Services Administration (GSA SmartPay)**: "GSA Purchase Card Transactions, April–June 2020 (3rd quarter, US Bank)", via catalog.data.gov, **CC0 1.0**.

Merchant category codes are mapped through the Visa Merchant Data Standards Manual (April 2026, marked "VISA PUBLIC", © 2026 Visa); `codes.json` cites it. The Visa manual is referenced, not reproduced.
