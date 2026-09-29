# Packaged extension lifecycle verification

The September 26 protected-input build reruns these lifecycle flows successfully. The session-only unlock key survives normal worker shutdown; a full browser restart requires the local passphrase before restoring saved inputs. See [protection evidence](local-protection.md). Earlier checkpoint details below remain historical observations.

Observed locally on September 26, 2026 with Playwright 1.63.0 and its bundled Chromium 153. Tests load the normal built Manifest V3 extension in isolated profiles. The cart is the sanitized observed Best Buy summary fixture; these checks do not add live retailer or issuer-eligibility evidence.

## Verified behavior

| Scenario | Evidence and result |
| --- | --- |
| Close the native popup during an unfinished cart read | A page debugger pauses the actual packaged reader at injection. Storage still has no capture when the native popup is destroyed. Resuming the reader saves the amount; reopening restores $27.23, leaves confirmation unchecked, and shows no comparison until explicit confirmation. No production function is replaced. |
| Reload the captured merchant document | Chrome's real navigation event clears the capture/comparison. Reopening shows no old cart result; reading and confirming the new document works. |
| Navigate to a different origin | The old capture clears and Chrome denies script injection using the former temporary grant. Returning to Best Buy does not revive that grant. A new native toolbar action grants access and the normal read/confirmation/comparison flow works. |
| Natural background-worker shutdown | Close the popup and disconnect Playwright's debugging connection while keeping the owned Chromium process and merchant tab alive. Confirm no worker debugger remains attached. A page-only protocol observer receives the extension's `stopped` status after the idle interval; no stop command or simulated clock is used. |
| Reopen after actual worker shutdown | Reconnect and activate the native toolbar action. The worker has a later `performance.timeOrigin`, and the saved estimate is restored from storage with confirmation unchecked. |
| Cart changes without navigation after recovery | Change the fixture's displayed total, close/reopen the popup, and confirm the saved comparison is hidden with a refresh notice. The page must be reread before the saved captured comparison can be used. |

The manifest still has only `storage`, `activeTab`, and `scripting`, with no persistent host permissions in the default build. Debugging capabilities belong to the isolated test harness; the shipped extension has no debugger permission or test hooks.

## Reproduce

From the repository root, with Node 24 and the bundled Chromium installed:

```sh
npm run build --workspace=ai-checkout-extension
npm run test:browser --workspace=ai-checkout-extension -- e2e/lifecycle.spec.ts
```

The idle scenario allows 75 seconds overall and requires an actual browser-reported stopped state within 50 seconds. The test does not poll worker APIs during this interval because doing so changes the lifecycle under test. Lifecycle timestamps/status transitions are saved as `worker-lifecycle.json` under the test output directory and attached to the report. Owned browser processes are closed in cleanup; no personal browser profile is used.

An initial attempt left Playwright attached and the worker remained running for the observation window. That attempt did **not** prove shutdown. The final harness owns the browser separately, disconnects Playwright for the idle interval, and observes only the merchant-page ServiceWorker domain. Both a stopped status and a new execution time origin are required, rather than a new Playwright Worker object or an elapsed delay alone.

The directly owned browser uses the relevant startup defaults from pinned Playwright 1.63.0, including suppression of first-run/keychain prompts and popup/background-rendering interference. Keep those settings aligned when upgrading the browser/test framework. The native-action helper activates the merchant tab and has a 10-second action deadline. A pre-fix repeat hung while opening the popup; after the setup changes, both a targeted idle run and the full default suite passed consecutively. This is local repeatability evidence, not remote CI execution.

The final full default suite passed five tests in 41 seconds. The HTTPS catalog case is intentionally skipped there and uses `npm run test:catalog:browser` with its separate configured build.

## Scope limits

These tests establish normal popup closure, page navigation/access revocation, and recovery after natural idle termination. They do not simulate an OS/browser process crash during a storage write or forced worker termination in the middle of a pending operation. The separate full-browser restart test covers durable completed results; bounded-reader/unit checks cover timeouts, late completion, failed storage, and deletion. A final normal Chrome installation and combined native-toolbar/live-cart smoke test remain release gates.

References: [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Chrome termination testing](https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer), [Playwright extension testing and idle suspension](https://playwright.dev/docs/chrome-extensions).
