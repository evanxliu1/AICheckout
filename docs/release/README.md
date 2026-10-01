# Release preparation

Updated October 1, 2026 for extension 2.0.0 (Helios popup) and catalog `2026-09-29.real.1` (seven cards; Best Buy, Newegg and Amazon US). These are reviewable drafts and operating instructions, **not evidence of submission or deployment**. See the [design doc](../design.md) for architecture and roadmap.

## Contents

- [Store listing and dashboard declarations](store-listing.md)
- [Public privacy-policy draft](privacy-policy.md)
- [Public support-page draft](support.md)
- [Reviewer and tester instructions](reviewer-instructions.md)
- [Data-handling audit and release decisions](privacy-review.md)
- [Deployment, maintenance and recovery](deployment-runbook.md)
- [Portfolio demonstration and honest claims](portfolio-demo.md)
- [Store images, offline shopper video and reproducible media evidence](assets/README.md)
- [Full-stack review recording, transcript and cleanup evidence](assets/full-stack-demo.md)

The public drafts describe the **default build without a remote catalog endpoint**. They must be revised and checked against the final artifact if hosted catalog updates are enabled. Neither a successful build nor filling in placeholders satisfies the engineering release gates.

## Inputs still needed from the owner

| Input | Used for | Current state |
| --- | --- | --- |
| Public publisher name | Listing, privacy-policy operator | `[[PUBLISHER_NAME]]` |
| Public support email | Support and privacy requests | `[[SUPPORT_EMAIL]]` |
| Public HTTPS privacy URL | Store privacy field | `[[PRIVACY_URL]]` |
| Public HTTPS support URL | Store support field | `[[SUPPORT_URL]]` |
| Final effective date | Published privacy policy | `[[EFFECTIVE_DATE]]` |
| Publisher account/verification | Dashboard and submission | Not verified; no fee paid by the agent |
| Hosting origin and provider | API/review and public pages | Not selected/configured; no service spending authorized |
| Model account, dated snapshot and budget | Live LLM evaluation | Budget remains $0; no live call authorized |

Do not put passwords, payment details, provider keys, tokens or private contact details in these files. Only the owner can supply public identity/contact choices. Placeholder removal is a content task, not consent to spend or publish.

## Before public submission

- [x] Implement and locally verify passphrase-protected storage, migration, explicit pre-use disclosure, lock and confirmed deletion; update the policy draft. [Design and evidence](../verification/local-protection.md).
- [ ] Close remaining public-link, operating-practice and final-artifact findings in [privacy review](privacy-review.md). Local verification is not store approval.
- [ ] Run both declared merchant flows in normal Chrome using the final artifact. Complete Best Buy's combined native/live check; Newegg's current combined evidence is one anonymous desktop cart.
- [ ] Record a small independent tester pass, including failures and fixes.
- [ ] Verify clean remote application/database CI on the intended revision. Local checks do not prove remote CI.
- [ ] Deploy and verify the API/review stack, catalog maintenance path, HTTPS/proxy behavior, scoped roles, backup/recovery and logs. A disabled curation adapter is the starting configuration.
- [ ] Independently review representative evaluation labels and run the explicitly funded live model evaluation; report failures and cost. This is a portfolio goal, not a Chrome requirement.
- [x] Record the actual local shopper and full-stack review flows with sample/model-simulation labels, reproducible commands and artifact evidence. These do not replace hosted or live-model evidence.
- [ ] Reverify terms near release and publish through human review. Do not extend the existing October 25 UTC expiry just to keep a demo running.
- [ ] Fill public identity/contact fields; publish the actual privacy/support pages and verify they load without authentication.
- [x] Produce five actual-popup screenshots and the required small promotional image; verify icon artwork, padding and light/dark contrast. [Local gallery and evidence](assets/README.md). These are bound to the current development ZIP and require rechecking against the eventual upload artifact.
- [ ] Match permissions, privacy declarations, merchant/card scope, listing copy and screenshots to the exact upload ZIP and inventory hash.
- [ ] Confirm publisher registration/verification, distribution settings and dashboard declarations, then submit only the reviewed artifact. Google decides approval.

## Release record

Create a dated record with the source revision, clean CI run URLs, archive SHA-256/inventory, catalog version/source dates/expiry, API/review deployment identifiers, installed Chrome version/OS, merchant and tester evidence, public document URLs/effective date, final listing text/assets, and submission outcome. Do not fill an evidence field with an intended action. Keep prior artifact hashes and published catalogs immutable.

Official requirements checked September 26: [publishing preparation](https://developer.chrome.com/docs/webstore/prepare), [publisher registration](https://developer.chrome.com/docs/webstore/register), [privacy dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [images](https://developer.chrome.com/docs/webstore/images). Recheck the dashboard at submission.
