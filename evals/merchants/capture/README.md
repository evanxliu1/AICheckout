# Phase 12 capture tool

Captures real retail pages for the generic reader evaluation (Phase 12.2, [plan](../../../wiki/product/phase-12-reader-eval.md), [protocol](../../../docs/evals/generic-reader-protocol.md#capture-posture)). It drives a headed Chromium on a capture-only profile with Playwright, one site per run, from a committed **recipe**. The posture rules are enforced in code; they don't depend on the operator. No reader, prototype reader or replay hook runs during capture.

```sh
node evals/merchants/capture/capture.mjs check recipes/<domain>.json   # validate a recipe; loads nothing
node evals/merchants/capture/capture.mjs run   recipes/<domain>.json   # robots check, then the recipe's steps
node evals/merchants/capture/capture.mjs serve recipes/<domain>.json   # robots check, recipe steps, then the operator's steps
#   options: --headless  --out <dir>  --profile <dir>  --second-session
npm run test:scripts            # unit tests (schema, robots, guards, platform, control server)
npm run test:capture:browser    # browser tests against the local fixture shop (127.0.0.1 only)
```

## Files

| Path | Committed | What |
| --- | --- | --- |
| `capture.mjs` | yes | CLI and `runSite`: lock, session rule, browser, robots.txt, driver, control server, site record |
| `driver.mjs` | yes | The only page API: `goto`, `click`, `wait`, `snapshot`, `status`, `end`. Every other property throws a `RefusalError` |
| `guards.mjs` | yes | Pure click and stop rules, plus the in-page fact gatherers they use |
| `recipe.mjs` | yes | Zod schemas: recipe `capture-recipe.1`, steps, site record `capture-site-record.1`, exclusion codes |
| `robots.mjs` | yes | RFC 9309 parsing and the protocol's robots rule |
| `platform.mjs` | yes | Platform groups and markers of the protocol |
| `snapshot.mjs` | yes | Snapshot format `capture-snapshot.1` |
| `replay.mjs` | yes | The reader's replay hook (Phase 13); never called by capture |
| `control-server.mjs` | yes | The `serve` mode's local server |
| `tests/` | yes | Unit tests, the fixture shop and browser tests |
| `data/` | **no** (gitignored) | `<domain>/<sessionId>/`: snapshots, `robots.txt`, evidence screenshots, `steps.log.json`, `recipe.recorded.json`, `site-record.json`; `<domain>/sessions.json` |
| `profile/` | **no** (gitignored) | The capture-only Chromium profile. Never Evan's, never signed in |

## Recipes

A recipe is data only (`capture-recipe.1`): the site's registrable `domain` and `origin`, a `listingUrl`, one or two `productUrls`, the `cartPath` and up to three `checkoutPaths` (checked against robots.txt before any page loads), an optional `termsUrl`, an `allowlist` of `{ purpose, target }`, and `steps`. A target is `{ role, name[, exact] }` or `{ selector }`, never coordinates, and a selector may not chain Playwright engines or enter frames (`>>`, `internal:`). Steps are `goto`, `click` (with an optional `purpose`, which must be on the allowlist), `wait` (milliseconds or a target), `snapshot` (an action state, `terms`, or an operator view `view-NN`), and a final `end` with an optional judgement exclusion and `notReached` states. All URLs must be on the recipe's domain and use https (http only on 127.0.0.1 fixtures). Nothing assumes a U.S. host: any country's domain (IDN as punycode) and any language of control names work.

Purposes: `add-to-cart`, `option` (size or colour button, radio or label), `quantity-increment`, `close-popup`, `decline-cookies`, `continue-as-guest`.

The 12.3 operator usually starts with `serve` and a recipe without steps, drives the session over the control server, and commits the session's `recipe.recorded.json` (the steps that ran and the allowlist as it ended) as the site's recipe.

## What the tool refuses (each has a test)

| Rule | How |
| --- | --- |
| No typing, keys, `<select>`, files, coordinates or mouse | The driver has no such method; `type`, `fill`, `press`, `keyboard`, `selectOption`, `setInputFiles`, `mouse`, `clickAt` and any other name throw a `RefusalError`. A source scan test proves no tool file calls them. Targets with `x`, `y` or `position` are refused |
| No clicks on text fields, their labels, selects, options or file inputs | Checked in the page before the click |
| No submit or in-form clicks unless allowlisted | A submit control is clicked only for `add-to-cart`. Any control inside a `<form>` needs an allowlisted purpose, and its form must have no visible text, e-mail or password field, so promo-code, sign-in, newsletter and search forms are never touched. `continue-as-guest` must be outside any form. An `add-to-cart` whose name or form action looks like a promo, sign-in or newsletter control is refused |
| No form submission by script | A non-GET top-level navigation is aborted unless it happens during an allowlisted add-to-cart click |
| No frames | A target that is or contains an `iframe`, `frame`, `object` or `embed` is refused; locators never enter frames |
| Same site only | `goto` must stay on the recipe's registrable domain. A click or redirect that leaves it loads that one page only (a third-party checkout); after that only a `checkout-1` snapshot is allowed and every navigation is aborted. Popups are closed, dialogs dismissed, downloads and service workers blocked |
| Stops | A 401/403 or 429 main document, a visible CAPTCHA or challenge frame, bot-wall or "disable your extensions" wording, or a login route with a visible password field stops the site at once with the protocol code and a screenshot hash. Nothing is retried |
| robots.txt | Fetched once through the browser's request context before any page. `Disallow: /` for `*` or `AICheckoutCapture` excludes the site (`robots-disallow-all`); a disallowed `cartPath` or `checkoutPaths` entry excludes it (`robots-disallow-path`). A cart or checkout snapshot taken on a disallowed path stops the site too. 404 and other 4xx mean no rules; 401/403 and 429 stop as blocked; 5xx or no answer stops as `tool-error` |
| Pace and scale | At least 3 s between navigations and clicks (a shorter pace is accepted only for 127.0.0.1 fixtures), at most 25 top-level navigations, one site at a time (a lock file), one session per site (a second only after a `tool-error` session, on a later UTC day, with `--second-session`) |
| Browser | Persistent profile under `profile/`; a path inside a personal Chrome or Chromium profile is refused. Playwright's default `--disable-extensions`; no extension, proxy or stealth plugin |
| Control server (`serve`) | Bound to 127.0.0.1 on a random port; 32-byte random bearer token (written 0600 to the session folder and removed at the end); refuses any request with an `Origin` or `Sec-Fetch-*` header, a Host other than `127.0.0.1:<port>`, or a non-JSON body; one command at a time; accepts only the driver's steps |

Refusals carry a `code` (`refused-submit`, `refused-in-form`, …) and an `exclusionCode` (`would-need-forbidden-action`, or `tool-error` for operational failures). In `run` mode a refused step ends the session as `tool-error`; in `serve` mode it is returned to the operator and the session continues.

## Snapshots (`capture-snapshot.1`)

One folder per state with `page.mhtml` (CDP `Page.captureSnapshot`, the replay format), `dom.json`, `page.html`, `viewport.png`, `full.png`, `headers.json` (main document URL, status, headers), `meta.json` and `manifest.json` (SHA-256 of each file; the manifest's own SHA-256 is the state's `manifestSha256`).

- **Styles are read lazily.** `dom.json` keeps the element tree with open shadow roots inlined, text, a few attributes and boxes, and reads computed styles (display, visibility, opacity, text decoration, `checkVisibility()`) only on elements that hold their own text. The reader doesn't use a style dump: `replay.mjs` reloads `page.mhtml`, which keeps stylesheets and open shadow roots and runs no scripts, with all network blocked, so a reader reads computed styles from live layout as it will in the product.
- **Global metadata.** `meta.json` records the page's `lang`, a `locale.region` from html `lang`, `og:locale` or `geo.region` with the markers seen, and `currency` markers (ISO codes from `priceCurrency` and price meta tags, counts of currency symbols and ISO codes in the page text). These are metadata for reporting by region; no amount is read. `captureMethod` is `robot`.

## Site record (`capture-site-record.1`)

`site-record.json` is the committable, text-free result of a session: domain, recipe hash, tool and browser version, session number and navigation count, the robots posture (URL, status, hash, the `*` and `AICheckoutCapture` rules, checked paths, decision), the terms URL and copy hash (`prohibitsAutomated` stays `unknown` until the operator reads it), each state's URL and hashes, `notReached`, the third-party checkout host (only when `checkout-1` was captured on it), platform group and marker, events, the stop, and the outcome (`captured` if `cart-1` or `minicart-1` exists; `excluded` with a code and, for judgement codes, the evidence screenshot's SHA-256; `incomplete` after a `tool-error`). 12.3 copies these into `sites.json`.

## Not built: attended capture of blocked sites

A scope addition of 2026-10-06 asked for a pasteable in-page serializer with chunked output, an importer and an attended-candidate list, so the coordinator could capture robot-blocked sites in the Claude desktop browser pane with Evan solving any CAPTCHA. Writing that serializer was refused by the session's permission classifier, so none of it is here; it needs Evan's explicit go-ahead. See the [decision](../../../wiki/decisions/2026-10-06-capture-tool-design.md).
