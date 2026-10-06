# Browser-pane capture trial (2026-10-06)

Trial only, not part of the evaluation (`generic-reader-protocol.7`). Pages may be used as development data or discarded. Operator: a Claude Code subagent driving the Claude desktop app's built-in browser pane (`mcp__Claude_Browser__*`), logged out, between 22:46 and 22:52 UTC. Data (gitignored): `capture/data/pane-trial/<domain>/<state>/{dom.json,meta.json}`; format `pane-trial-dom.1` (element tree with open shadow roots inlined, attribute subset, direct text, computed styles and boxes only on text-holding elements; empty non-interactive subtrees pruned; hrefs without query). No MHTML, HTML, screenshots or headers were kept.

| Site | Robot | Pane | States | Export bytes (approx tokens) |
| --- | --- | --- | --- | --- |
| apple.com | reached | reached, no block | empty-cart, cart-1 (no drawer: add goes straight to the bag) | 134,954 (34k); 173,998 (43k) |
| homedepot.com | HTTP 403 | reached, no block | empty-cart, minicart-1, cart-1 | 146,756 (37k); 105,303 (26k); 101,415 (25k) |
| notino.nl | HTTP 403 | reached, no block (cookie banner: necessary only) | cart-1 only: empty `/cart/` redirects home; add shows an inline confirmation, no drawer | 45,090 (11k) |

Deviations from the protocol's listing rule, accepted for a trial: home depot's first nav candidates are category landing pages without tiles; the operator went to a Bath subcategory listing (Toilet Seats) instead of following the one main-content step mechanically. Apple's listing was the Store page. Cart pages were opened by URL, not by clicking the cart link.

Nothing was typed, submitted (except add-to-cart) or bought; no checkout control was clicked.
