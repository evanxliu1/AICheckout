# Release preparation

The Chrome Web Store material for AI Checkout **2.1.0** (Release A, [plan](../../wiki/product/phase-15-release-a.md)): what Evan submits, what the public pages say, how reviewers test it, and the record of what was submitted. Rewritten 2026-10-20 for the extension on `main` after Phase 15.1–15.4: the badge at any https store through the generic cart reader (the three site adapters, order detection and the savings history are gone), the store list matched on the device, card terms and the store list refreshed at install and weekly, and optional usage reporting behind one consent question. These are drafts until the release record below says otherwise; nothing here is evidence of submission or approval.

## Contents

| File | What it is |
| --- | --- |
| [store-listing.md](store-listing.md) | Every dashboard field: listing copy, single purpose, permission justifications, remote-code answer, privacy-tab answers, the CC BY attribution sentence |
| [privacy-policy.md](privacy-policy.md) | The policy published at `/privacy/` (the site page in `apps/site/src/pages.tsx` renders the same text) |
| [support.md](support.md) | The support page published at `/support/` |
| [reviewer-instructions.md](reviewer-instructions.md) | The dashboard's test instructions and the manual tester script |
| [assets/README.md](assets/README.md) | Store images and media; regenerated against the 2.1.0 ZIP in milestone 15.6 (the committed media still show 2.0.0) |
| [privacy-review.md](privacy-review.md), [deployment-runbook.md](deployment-runbook.md), [publish-runbook.md](publish-runbook.md), [portfolio-demo.md](portfolio-demo.md) | Dated internal records from the 2.0.0 preparation (September and early October 2026); superseded where they describe the retired per-store adapters or a build with no network requests, kept for history |

Behaviour is documented from the code; the development record is the wiki ([extension](../../wiki/system/extension.md), [cart badge](../../wiki/system/cart-badge.md), [public site](../../wiki/system/public-site.md)). The public pages are served by the API from `apps/site/dist` ([site README](../../apps/site/README.md)); `/privacy/`, `/support/`, `/credits/` and `/uninstalled/` must load over HTTPS without authentication before submission.

## Inputs from Evan

| Input | Used for | State |
| --- | --- | --- |
| Publisher name | Listing, policy operator line | **Evan Liu** (assumed; Evan to confirm) |
| Support email | Listing support email, policy contact, support page | **`SUPPORT_EMAIL_TBD`** in every file; `node scripts/check-release-docs.mjs --release` fails while it remains |
| Trader or non-trader declaration | Dashboard | **Non-trader** recommended; Evan to confirm (a legal statement about him) |
| Developer account, fee, two-step verification | Dashboard | Evan only |
| `EXTENSION_IDS` on Render | The API's `Origin` filter on `/v1/events` | Set after the first draft upload shows the extension id ([plan, section 6](../../wiki/product/phase-15-release-a.md#6-web-store-submission-checklist)) |
| GitHub private vulnerability reporting enabled | `SECURITY.md` and the support page point to it | Evan to check |

Never put passwords, payment details, provider keys, tokens or private contact details in these files.

## Gates before submission (milestone 15.7)

- [ ] `npm run build:hosted --workspace=ai-checkout-extension`, `npm run package`, `npm run test:package:browser --workspace=ai-checkout-extension` on the exact ZIP; the inventory's SHA-256, bundled catalog (the renewal, `2026-10-2x.renewal.2`) and bundled store list recorded in [`docs/verification/release-package.md`](../verification/release-package.md).
- [ ] `node scripts/check-release-docs.mjs --release`: no wording from before the adapters were retired, the random-identifier wording everywhere (never a claim that reports cannot be linked), no support-email placeholder and none of Evan's pending confirmations left (the rules are in `scripts/lib/release-docs.mjs`; this line is worded so it does not trip them itself).
- [ ] `npm run telemetry:check`: the dictionary matches the contract; the consent copy covers every event (`extension/tests/telemetry-ui.test.tsx`).
- [ ] The independent reviewer pass (Opus, agent-verified): policy, listing, privacy-tab answers, consent copy, dictionary and the ZIP's behaviour agree; the remote-code answer holds on the ZIP; the permission justifications match `dist/manifest.json`.
- [ ] Both GitHub workflows green on the submitted revision.
- [ ] Catalog release 4 published before 2026-11-04T00:00Z and bundled in the ZIP ([renewal](../../wiki/ops/catalog-release.md#renewing-a-catalog-before-it-expires)).
- [ ] Store assets regenerated against the 2.1.0 ZIP (15.6) and matching the listing copy.
- [ ] `/privacy/`, `/support/`, `/credits/`, `/uninstalled/` load on the deployed site.
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

Keep earlier hashes and published catalogs immutable. Official requirements last checked 2026-10-20: [publishing preparation](https://developer.chrome.com/docs/webstore/prepare), [publisher registration](https://developer.chrome.com/docs/webstore/register), [privacy dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [images](https://developer.chrome.com/docs/webstore/images), [2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026). Recheck the dashboard at submission.
