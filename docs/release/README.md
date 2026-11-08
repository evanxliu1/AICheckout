# Release preparation

Chrome Web Store material for AI Checkout **2.1.0** (Release A, [plan](../../wiki/product/phase-15-release-a.md)): what Evan submits, what the public pages say, how reviewers test the extension, and the record of each submission. The files describe the extension on `main`: the badge at any https store through the generic cart reader, the store list matched on the device, card terms and the store list refreshed at install and weekly, and optional usage reporting behind one consent question. They are drafts until the release record below says otherwise; nothing here is evidence of submission or approval. House style for these files and the public site: [style-guide.md](style-guide.md).

## Contents

| File | What it is |
| --- | --- |
| [store-listing.md](store-listing.md) | Every dashboard field: listing copy, single purpose, permission justifications, remote-code answer, privacy-tab answers, the CC BY attribution sentence |
| [privacy-policy.md](privacy-policy.md) | The policy published at `/privacy/` (the site page in `apps/site/src/pages.tsx` renders the same text) |
| [style-guide.md](style-guide.md) | House style for the public docs and the site: voice, terminology, dates, money, headings and links |
| [support.md](support.md) | The support page published at `/support/` |
| [reviewer-instructions.md](reviewer-instructions.md) | The dashboard's test instructions and the manual tester script |
| [assets/README.md](assets/README.md) | Store images and media, regenerated 2026-10-20 (milestone 15.6) against the 2.1.0 hosted-build ZIP whose hash it records |
| [privacy-review.md](privacy-review.md), [deployment-runbook.md](deployment-runbook.md), [publish-runbook.md](publish-runbook.md), [portfolio-demo.md](portfolio-demo.md) | Dated internal records from the 2.0.0 preparation (September and early October 2026); superseded where they describe the retired per-store adapters or a build with no network requests, kept for history |

Behaviour is documented from the code; the development record is the wiki ([extension](../../wiki/system/extension.md), [cart badge](../../wiki/system/cart-badge.md), [public site](../../wiki/system/public-site.md)). The public pages are served by the API from `apps/site/dist` ([site README](../../apps/site/README.md)); `/privacy/`, `/support/`, `/credits/` and `/uninstalled/` must load over HTTPS without authentication before submission.

## Inputs from Evan

| Input | Used for | State |
| --- | --- | --- |
| Publisher name | Listing, policy operator line | **Evan Liu** (Evan confirmed 2026-10-22) |
| Support email | Listing support email, policy contact, support page | **evanliu7788@gmail.com** (Evan, 2026-10-22) |
| Trader or non-trader declaration | Dashboard | **Non-trader** (Evan confirmed 2026-10-22) |
| Developer account, fee, two-step verification | Dashboard | Evan only |
| `EXTENSION_IDS` on Render | The API's `Origin` filter on `/v1/events` | Set after the first draft upload shows the extension id ([plan, section 6](../../wiki/product/phase-15-release-a.md#6-web-store-submission-checklist)) |
| GitHub private vulnerability reporting enabled | `SECURITY.md` and the support page point to it | Enabled (`GET /repos/evanxliu1/AICheckout/private-vulnerability-reporting` returned `enabled: true` on 2026-11-06) |

Never put passwords, payment details, provider keys, tokens or private contact details in these files.

## Gates before submission (milestone 15.7)

- [x] `npm run build:hosted --workspace=ai-checkout-extension`, `npm run package`, `npm run test:package:browser --workspace=ai-checkout-extension` on the exact ZIP; the inventory's SHA-256, bundled catalog (the renewal) and bundled store list recorded in [`docs/verification/release-package.md`](../verification/release-package.md) (2026-11-07).
- [ ] `node scripts/check-release-docs.mjs --release`: no wording from before the adapters were retired, the random-identifier wording everywhere (never a claim that reports cannot be linked), no support-email placeholder, no unfilled `[[…]]` field in the package record and none of Evan's pending confirmations left (the rules are in `scripts/lib/release-docs.mjs`; this line is worded so it does not trip them itself).
- [x] `npm run telemetry:check`: the dictionary matches the contract; the consent copy covers every event (`extension/tests/telemetry-ui.test.tsx`).
- [ ] The independent reviewer pass (Opus, agent-verified): policy, listing, privacy-tab answers, consent copy, dictionary and the ZIP's behaviour agree; the remote-code answer holds on the ZIP; the permission justifications match `dist/manifest.json`.
- [ ] Both GitHub workflows green on the submitted revision.
- [x] Catalog release 4 (the renewal; release 3 expired 2026-11-04T00:00Z) published and bundled in the ZIP ([renewal](../../wiki/ops/catalog-release.md#renewing-a-catalog-before-it-expires)): `2026-11-07.renewal.2`, published 2026-11-07.
- [ ] Store assets regenerated against the submitted ZIP (`npm run release:media` after the renewal is bundled; the hash in `assets/README.md` must match the release record) and matching the listing copy.
- [x] `/privacy/`, `/support/`, `/credits/`, `/uninstalled/` load on the deployed site (HTTP 200 on 2026-11-07; check again on submission day).
- [ ] Upload as a draft first, set `EXTENSION_IDS`, then submit (Evan).

## Release record

One entry per submission, appended here, filled only with what happened (an intended action is not evidence).

```markdown
### 2.1.0 — submitted YYYY-MM-DD

- Source revision: `<sha>` on `main`; CI runs: <extension workflow URL>, <database workflow URL>
- ZIP: `ai-checkout-2.1.0.zip`, SHA-256 `<hash>` (inventory `<path>`); bundled catalog `<version>` (expires <date>), store list `<version>`
- Hosted: `/v1/catalog` serves `<version>`; `/v1/merchants` serves `<version>`; `EXTENSION_IDS` set to `<id>`
- Tested in Chrome <version> on <OS>, <date>; tester pass: <link or "none">
- Listing text: store-listing.md at `<sha>`; assets: assets/README.md at `<sha>`
- Public pages: /privacy/ (last updated <date>), /support/, /credits/, /uninstalled/ checked <date>
- Outcome: <pending | published <date> | rejected <date>: reason, fix, plan amendment>
```

### 2.1.0 — not yet submitted (package prepared 2026-11-07)

- Source revision: built at `db465df1476536a4964f0ade14ec61b032ff54a3` on `main`; final `main` revision and CI runs: pending
- ZIP: `ai-checkout-2.1.0.zip`, SHA-256 `bd9f5ad11cf84940861c710b7c6b756eb2c5b0dcec09b5184b0627048d87f6cd` (inventory `extension/artifacts/ai-checkout-2.1.0.inventory.json`); bundled catalog `2026-11-07.renewal.2` (expires 2026-12-07T00:00Z), store list `2026-10-11.mcc.3`
- Hosted: `/v1/catalog` serves `2026-11-07.renewal.2`; `/v1/merchants` serves `2026-10-11.mcc.3` (checked 2026-11-07); `EXTENSION_IDS`: pending, set after the draft upload
- Tested: the automated ZIP test passed in Chromium 153.0.8010.12 on macOS on 2026-11-07; Evan's own install test in Chrome: pending; tester pass: none
- Listing text: store-listing.md at a pending revision; assets: pending (the store media are not yet regenerated for this ZIP)
- Public pages: /privacy/ (last updated 2026-11-06), /support/, /credits/, /uninstalled/ answered 200 on 2026-11-07
- Outcome: not submitted

Keep earlier hashes and published catalogs immutable. Official requirements last checked 2026-10-20: [publishing preparation](https://developer.chrome.com/docs/webstore/prepare), [publisher registration](https://developer.chrome.com/docs/webstore/register), [privacy dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [images](https://developer.chrome.com/docs/webstore/images), [2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026). Recheck the dashboard at submission.
