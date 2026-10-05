# Phase 10 merchant feasibility probe

Working folder for the 25-site probe of 2026-10-05 ([plan](../../../wiki/product/phase-10-feasibility-probe.md), [report](../../../docs/evals/merchant-probe-2026-10.md)). Prototype tooling only; nothing here ships.

| Path | Committed | What |
| --- | --- | --- |
| `sites.json` | yes | The 25 domains with Tranco rank, band, platform and outcome codes (no page text) |
| `labels.json` | yes | Labeler 1's displayed totals per snapshot: amounts in cents and kinds, the `dom.json` SHA-256, two recorded corrections |
| `reader-results.json` | yes | Prototype reader runs 1 and 2: result, amount, kind, timing per snapshot |
| `tools/driver.mjs` | yes | Control server around one headed Chromium with the probe profile. It has no fill, type, press or submit call |
| `tools/prototype-reader.mjs` | yes | Design steps 1–3 plus a simple decide, over the `dom.json` snapshots |
| `tools/frame-ext/` | yes | Test extension: mounts a `chrome-extension://` iframe the way the badge does (Q4) and writes 2 MiB to `chrome.storage.local` (Q6) |
| `data/` | **no** (gitignored) | `tranco-647LX.csv`, home-page fetches, `notes.jsonl`, `views/` screenshots, reader run outputs and `sites/<domain>/<state>/` snapshots |
| `profile/` | **no** (gitignored) | The probe's own Chromium profile (never Evan's) |

Each snapshot folder `data/sites/<domain>/<minicart|cart|checkout>/` holds `dom.json` (body tree with display, visibility, opacity, text decoration, font weight and size, box per element; open shadow roots inlined; closed roots and iframes absent), `page.html`, `page.mhtml` (CDP `Page.captureSnapshot`), `screenshot.png` (full page) and `meta.json` (URL, time, main-document response headers including CSP, shadow-root counts from CDP, iframe list, SHA-256 of every file).

## Second labeler

Label each snapshot from `screenshot.png` (and `data/views/<domain>-<state>.png`, the viewport at capture) without reading `labels.json` or `reader-results.json` first. For each snapshot record every displayed summary total row as `{kind, amountCents}` with kinds `afterCredit`, `estimatedTotal`, `subtotal`, and the expected value: the displayed amount of the most preferred kind in the top frame, or null when none is shown (or only inside a cross-origin iframe). Then compare with `labels.json`; disagreements go to an adjudicator who is neither labeler.

## Re-running the reader

```sh
node evals/merchants/probe/tools/prototype-reader.mjs            # table + summary against labels.json
node evals/merchants/probe/tools/prototype-reader.mjs --rows ikea.com/checkout   # debug rows (local terminal only)
```

The driver needs a local display: `node evals/merchants/probe/tools/driver.mjs`, then POST one JSON command at a time to `127.0.0.1:8765` (`goto`, `links`, `buttons`, `click`, `clickxy`, `capture`, `frametest`, `storage`).
