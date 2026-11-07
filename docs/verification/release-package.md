# Extension package verification

The record of the AI Checkout package uploaded to the Chrome Web Store. Values in double square brackets are filled at submission (milestone 15.7) from the coordinator's build of the exact upload ZIP; `node scripts/check-release-docs.mjs --release` refuses this file while any of them is left. An intended action is never recorded as done.

## Version 2.1.0 (Release A)

### Artifact

| Field | Value |
| --- | --- |
| File | `extension/artifacts/ai-checkout-2.1.0.zip` |
| Size | [[ZIP_BYTES]] bytes, [[ZIP_FILE_COUNT]] files |
| SHA-256 | `[[ZIP_HASH]]` |
| Inventory | `extension/artifacts/ai-checkout-2.1.0.inventory.json` |
| Source revision | `[[SOURCE_REVISION]]` on `main` |
| Build | `npm run build:hosted --workspace=ai-checkout-extension`, then `npm run package --workspace=ai-checkout-extension` |
| Reproduced | A second `build:hosted` at the same revision gave SHA-256 `[[REPRODUCED_HASH]]` |

### Bundled data

| Field | Value |
| --- | --- |
| Card catalog | `[[CATALOG_VERSION]]`, verified `[[CATALOG_VERIFIED_AT]]`, expires `[[CATALOG_EXPIRES_AT]]` |
| Store list (merchant release) | `[[MERCHANTS_VERSION]]` |
| Compared with hosted | `/v1/catalog` served `[[HOSTED_CATALOG_VERSION]]` and `/v1/merchants` served `[[HOSTED_MERCHANTS_VERSION]]` on [[BUNDLES_CHECKED_ON]] |

### Manifest

From the inventory, checked on [[MANIFEST_CHECKED_ON]]:

- `permissions`: `activeTab`, `alarms`, `scripting`, `storage`
- `host_permissions`: `https://*/*` and `https://ai-checkout-api.onrender.com/*`
- `catalogOrigin`: `https://ai-checkout-api.onrender.com`

These must match the [permission justifications](../release/store-listing.md#permission-justifications-dashboard-copy).

### ZIP browser test

`npm run test:package:browser --workspace=ai-checkout-extension` on [[ZIP_TEST_DATE]], Chromium [[CHROMIUM_VERSION]] (from `zip-verification.json`). The test verifies the archive and every extracted file against the inventory, installs the extracted ZIP in a fresh profile, picks the sample cards, reads a fixture cart from the popup and compares (or, after the bundled catalog's expiry, shows the expiry notice), checks the granted permissions and origins, and confirms that **Delete all local data** leaves local and session storage empty. Result: [[ZIP_TEST_RESULT]].

## Packaging checks

`extension/scripts/release-package.mjs` runs these on every package:

- Require the reviewed Manifest V3 shape, the matching package version, the expected entry points and icons, the four permissions, `https://*/*` plus at most one catalog origin, the badge content script and its one web-accessible resource. A new manifest capability requires a deliberate change to the packaging policy.
- Include only the current runtime file layout. Reject unexpected files, source maps and symlinks, and exclude known duplicate icon copies, Vite metadata and Finder metadata.
- Verify entry files, popup asset references, PNG headers and dimensions, and bounded file sizes. Scan text for development references and a few recognizable private-credential patterns. This is a conservative tripwire, not a full secret scanner or proof that arbitrary JavaScript is safe.
- Archive sorted paths with fixed timestamps and modes and stripped ZIP metadata. Check ZIP integrity, compare the complete file list, and decompress each entry to verify it matches the inspected bytes before replacing the artifact.
- Write an inventory beside the ZIP. A failed preflight keeps the previous artifact. The two final file replacements are each atomic; consumers still compare the inventory hash with the ZIP, as the browser test does.

## Reproduce

From the repository root, with Node 24, dependencies and Playwright Chromium installed:

```sh
npm run test:package --workspace=ai-checkout-extension
npm run build:hosted --workspace=ai-checkout-extension
npm run test:package:browser --workspace=ai-checkout-extension
shasum -a 256 extension/artifacts/ai-checkout-2.1.0.zip
```

`test:package:browser` packages the existing `extension/dist` and runs the ZIP browser test; it doesn't rebuild the source, so build first after any change. The browser run saves `zip-verification.json` and screenshots under the ignored `extension/test-results/`, which later Playwright runs may replace.

The checks follow Chrome's [publishing preparation](https://developer.chrome.com/docs/webstore/prepare) and [icon guidance](https://developer.chrome.com/docs/extensions/reference/manifest/icons).

## History: version 2.0.0 (2026-09-26)

Kept as written. Version 2.0.0 was never uploaded; it had no host permissions and read carts only from the toolbar popup.

Verified locally on September 26, 2026. This is a development artifact, not a claim of release readiness, live merchant compatibility, hosted deployment, or Chrome Web Store approval.

### Artifact and evidence

The current default build produces `extension/artifacts/ai-checkout-2.0.0.zip` (116,697 bytes; 14 files). Its SHA-256 is `5c8800d4b22fb79a2dae33b3017f9f4f8788002072e9afff62e46a2aa6036c0d`. It includes the two-merchant `.2` pilot, Newegg subtotal flow, passphrase-protected local inputs with disclosure, lock and confirmed deletion, and the new vector-derived cart icons. The adjacent `.inventory.json` records the archive hash, every included file's hash and size, release version, permissions, and optional catalog origin. These are local integrity records, not signed provenance.

Only icon artwork changed after the protected-input checkpoint (127,211 bytes, SHA-256 `3979eb3e2f19e923d83b9a2b796b4423167a7b1c4a05ed32cd08717ec1ce5016`); application JavaScript/CSS and permissions are unchanged. The earlier 123,243-byte two-merchant package (SHA-256 `d8818ecad4032f5616026b8db0e15adea7e6527cbebdbc209e4f2d20b15be81d`) predates local encryption. The still earlier single-merchant archive was 121,413 bytes. Historical records retain their original hashes.

The extracted ZIP, rather than the original build folder, passed a native action test in Chromium 153.0.8010.12. The test verifies the archive and all extracted hashes, installs it into a fresh isolated profile, accepts the protection disclosure and sets a test passphrase, selects both owned cards, reports zero previous online-retail spend, reads the sanitized Best Buy $27.23 summary, and explicitly confirms online eligibility and purchase exclusions. It displays Blue Cash Everyday at $0.81 and Quicksilver at $0.40, then explicitly confirms deletion and verifies both local and session storage are empty and protection setup returns. These are fixture estimates, not observed savings or issuer-category verification.

The default ZIP has only `storage`, `activeTab`, and `scripting` permissions and no host permission. The existing CRXJS-generated web-accessible resource remains limited to the packaged reader file; adding Newegg did not change extension access. Optional configured builds may have one exact HTTPS catalog origin, recorded in the inventory. The separate configured-catalog test was rerun successfully for the protected-input source, covering refresh and offline restart.

The protected-input build passes seven default browser flows; [storage/lifecycle evidence](local-protection.md) includes restart, idle-worker recovery, migration, wrong-phrase rejection, cross-window locking and deletion. The [earlier live Newegg record](newegg-live-2026-09-26.json) belongs to the previous artifact and its original hashes remain unchanged. Its combined live flow passed at two quantities with cleanup, but it is not final-build evidence for this new ZIP. The extracted-ZIP test remains the distinct Best Buy fixture flow above. Normal installed-Chrome, final live merchant and store-upgrade checks remain pending.

The original icon files all contained 500×500 images. A previous checkpoint corrected their dimensions; the current checkpoint replaces their tiny embedded lettering with a shared vector cart using the existing blue. Exports are 16×16, 48×48 and 128×128. The 128px export has 96px artwork and 16px transparent padding, checked pixel by pixel and inspected on light/dark surfaces. The extracted-ZIP native fixture test passed again after this change. [Store-media evidence](../release/assets/README.md) includes five actual-popup screenshots, the promotional PNG and the labeled offline shopper recording; these are not store approval or live merchant verification.

### Packaging checks

- Require the reviewed Manifest V3 shape, matching package version, expected entry points/icons, and exact permissions. New manifest capabilities require deliberate updates to the packaging policy.
- Include only the current runtime file layout. Reject unexpected files, source maps and symlinks. Exclude known duplicate icon copies, Vite metadata/scaffold and Finder metadata.
- Verify entry files, popup asset references, PNG headers/dimensions and bounded file sizes. Scan text for development references and a few recognizable private-credential patterns. This is a conservative tripwire, not a comprehensive secret scanner or proof that arbitrary JavaScript is safe.
- Archive sorted paths with fixed timestamps/modes and stripped ZIP metadata. Check ZIP integrity, compare its complete file list, and decompress each entry to verify it matches the inspected bytes before replacing the artifact.
- Write an inventory beside the ZIP. A failed preflight preserves the previous artifact. The two final file replacements are individually atomic; consumers must still compare the inventory hash to the ZIP, as the browser test does.

Five packaging tests pass, including byte reproducibility after input timestamp/mode changes, exact configured-origin reporting, preservation of the prior artifact on rejected manifests, and rejection of unexpected files, symlinks, missing assets, credential-shaped fixtures, development references and wrong icon dimensions. Reproducibility was verified with the local ZIP implementation; byte parity across operating systems/tool versions has not been claimed.

### Reproduce

From the repository root, with Node 24, dependencies and Playwright Chromium installed:

```sh
npm run test:package --workspace=ai-checkout-extension
npm run build --workspace=ai-checkout-extension
npm run test:package:browser --workspace=ai-checkout-extension
```

The last command packages the existing `extension/dist` and runs the ZIP-specific browser test; it does not rebuild source. Always build first after changes. `npm run package --workspace=ai-checkout-extension` performs only packaging/inspection. The ordinary extension test command includes packaging unit tests; the default browser suite skips this separately invoked ZIP flow.

The browser run saves `zip-verification.json` and `zip-comparison.png` under ignored `extension/test-results`. Subsequent Playwright runs may replace that directory. CI now packages and tests the actual ZIP before uploading it with its inventory and browser evidence. Remote Actions execution remains unverified; no commit or push was made for this checkpoint.

The checks follow Chrome's [production testing and root-manifest ZIP guidance](https://developer.chrome.com/docs/webstore/prepare) and [icon guidance](https://developer.chrome.com/docs/extensions/reference/manifest/icons). The full release gates in the [roadmap](../design.md#roadmap) still apply, including normal Chrome installation, the combined Best Buy live-toolbar/cart test, final merchant checks, deployment, live model evaluation, and privacy/support/store materials.
