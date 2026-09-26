# Local input protection

Implemented and verified locally September 26, 2026. This records application behavior and its limits; it is not an independent security audit or Chrome Web Store approval. The final public identity, privacy/support URLs, installed-Chrome checks and other release gates remain in [BUILD_STATUS](../../BUILD_STATUS.md).

## Stored record and key lifetime

The worker wraps the existing state service in `extension/src/state/vault-service.ts`. The same `checkoutStateV1` local-storage key now holds an authenticated encrypted envelope containing the complete validated AppState: selected products, reported limits, working purchase, cart metadata, saved-comparison metadata and optional downloaded catalog. No second plaintext state copy is written.

`vault-crypto.ts` uses browser Web Crypto, AES-GCM with a 256-bit key, a fresh random 12-byte IV for each write, and a 128-bit authentication tag. PBKDF2-HMAC-SHA256 derives the key from the local passphrase and a random 16-byte salt using 600,000 iterations. Version 1 accepts 15–256 JavaScript string characters; unrelated words are recommended. The KDF parameters are fixed by the versioned schema, not trusted from arbitrary stored input. The JSON plaintext is limited to 512 KiB before encryption. Decoding checks canonical base64, exact cryptographic field lengths, authenticated decryption, runtime state schema and matching revision.

Authenticated additional data binds a domain separator, format version, random vault identity, KDF, iteration count, salt, cipher and revision. Those header fields, IV and ciphertext length are public metadata; they are not financial fields. Every write uses a new IV. Altered authenticated headers/ciphertext fail to decrypt. The format does not detect rollback to a complete older valid encrypted record by someone who can replace profile files.

The derived raw key is serialized **only** in `chrome.storage.session` under `checkoutVaultSessionV1`, alongside its matching random vault identity. The passphrase is never persisted. `chrome.storage.local` and `chrome.storage.session` are explicitly restricted to `TRUSTED_CONTEXTS` before handling messages or tab events. Only the exact packaged popup sender may use the worker API. Page scripts cannot request wallet data or retrieve either storage area. No new permission, account, network request or model call is introduced.

The session key survives popup closure and normal worker shutdown. Lock, successful deletion, browser restart and extension reload/update clear it; the next use requires the passphrase. The UI unmounts private controls/results when a lock/delete/identity event arrives, including in another open extension view. While unlocked, decrypted values necessarily exist in worker/popup memory. Operation queues discard completed response values instead of retaining a previous plaintext result. Temporary byte arrays are cleared where practical, but JavaScript strings, Chrome and operating-system memory cannot be promised secure erasure.

## Setup, migration and failures

- First use shows the data categories, local handling, passphrase requirements and unrecoverability before accepting private inputs. Matching phrases and a separate explicit disclosure checkbox are required. The worker accepts only the current disclosure version in a strict setup request. There is no remote consent log.
- A valid previous plaintext AppState produces a migration screen, not the wallet screen. Protecting atomically replaces the active local key with an encrypted record. A failed persistent write leaves the old record intact; a failed session-key write leaves an encrypted record that can be unlocked. Historical disk, backup or other external copies cannot be erased by this migration.
- Existing encrypted or unrecognized data cannot be overwritten by a setup request. Wrong phrases and authenticated corruption return a generic unlock failure. Unsupported/damaged record formats provide explicit deletion/reset, not a silent empty wallet.
- Lock clears session storage. A failed lock remains visibly failed; the UI does not claim the session is locked.
- Deletion clears the session key before local storage. If disk clearing fails, the data remains encrypted and the UI reports failure. Every deletion path requires the explicit permanent-deletion checkbox; a passphrase is not required to delete. Successful deletion returns to protection setup in all open views.
- One worker queue serializes domain writes, tab invalidation, lock and deletion. A delayed cart read cannot complete after deletion and recreate data. Locked captures are rechecked against document identity and age before later use.

## Evidence

- Ten native-Web-Crypto unit tests cover authenticated round trips, fresh IVs, wrong phrases/identities, tampered headers/ciphertext, bounded schemas, setup/consent, migration, disk/session write failures, corrupted records, browser-session loss, worker recreation, lock, deletion failures and delayed-read/deletion ordering.
- Eight gate component tests cover explicit acceptance, phrase matching, migration messaging, wrong-phrase retry, immediate private-view removal while status is pending, failed lock/deletion feedback, damaged-data reset, state-accurate disclosure, unlocked deletion confirmation and connection recovery. Seven worker-authorization checks cover exact sender and initialization failure of either storage area. Existing comparison/state tests continue to run.
- The complete extension suite passes **230 unit/component tests and five packaging tests**. Root lint and workspace type checks pass.
- Seven default packaged Chromium flows pass. They include real browser restart with an empty session store and required unlock; an observed natural worker stop with preserved unlock/result; paused capture/popup closure; navigation/temporary-permission revocation; both merchant fixtures; cross-window wallet changes, lock and deletion; wrong-phrase rejection; plaintext migration; and confirmed reset. Two separately gated catalog/ZIP cases are intentionally skipped by the default command.
- A real isolated injected script, after native toolbar activation, is denied both local and session storage reads. A privileged test inspection observes only an encrypted envelope on disk, no fixture wallet/amount/passphrase strings, and a session-only key. Inspection helpers run outside the shipped application; no production test bypass was added.

The separately configured HTTPS catalog and extracted-upload-ZIP results are recorded with the final artifact in [package verification](release-package.md). Screenshots are temporary inspection evidence, not final store assets. These browser tests use Chromium 153.0.8010.12 and synthetic inputs/retailer fixtures; they do not establish normal installed-Chrome or a new live-retailer pass for this changed build.

## Reproduce and limits

```sh
npm run test --workspace extension
npm run typecheck
npm run lint
npm run build --workspace extension
PLAYWRIGHT_BROWSERS_PATH=/tmp/aicheckout-playwright npm run test:browser --workspace extension
```

Use the installed Playwright browser path appropriate to the machine. The browser tests create disposable profiles and use a synthetic test phrase. Never use a real passphrase or shopping data in a test trace. Forgotten passphrases are not recoverable; changing a passphrase currently requires deleting and setting up again. Protection depends on the phrase's strength and does not defend against a compromised device, an unlocked profile, operating-system memory capture, external copies or an attacker rolling back a valid encrypted record. No forensic-erasure claim is made. Public privacy/support links remain a release requirement.

References checked during implementation: Chrome's [storage/session and access-level documentation](https://developer.chrome.com/docs/extensions/reference/api/storage), MDN's [key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) and [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), and OWASP's [PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Use of these primitives is not a certification of the application or its platform.
