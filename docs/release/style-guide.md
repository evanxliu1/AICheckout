# House style for public docs

This guide applies to everything a shopper, a Chrome Web Store reviewer or a hiring reader sees: the public site (`apps/site/src`), the root `README.md`, `SECURITY.md`, the package and app READMEs, and the files in `docs/release/` and `docs/verification/`. It doesn't apply to the development wiki (`wiki/`), which has its own [documentation guide](../../wiki/guides/how-to-document.md).

It follows the [Google developer documentation style guide](https://developers.google.com/style) (especially [tone](https://developers.google.com/style/tone) and [highlights](https://developers.google.com/style/highlights)) and the [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/welcome/) (especially [brand voice](https://learn.microsoft.com/style-guide/brand-voice-above-all-simple-human) and the [top 10 tips](https://learn.microsoft.com/style-guide/top-10-tips-style-voice)). Where this page is silent, follow Google, then Microsoft. The privacy policy follows the structure of mainstream product privacy notices: a short summary, then what is collected, how it's used and shared, retention, your choices, children, changes and contact.

## Voice and tone

- Write like a knowledgeable colleague: plain, direct and friendly, never slangy or promotional. Contractions are fine.
- Address the reader as "you". In the privacy policy and support pages, "we" means Evan Liu, the publisher and operator; say so once near the top.
- Use active voice and present tense. Say who does what: "The extension downloads the store list", not "The store list is downloaded".
- Lead with what the reader needs. Put conditions before instructions: "To delete earlier reports, use **Delete my data** before you stop sharing."
- Start instructions with a verb. Number steps that happen in order; use bullets for everything else.
- State facts once, precisely, and stop. Don't restate the heading, pre-announce a section ("This section explains…") or end with a summary sentence.
- Describe limits plainly ("U.S. dollars only", "can't guarantee a reward"). Don't hedge in stacks ("may possibly").

## Words and patterns to avoid

- Filler: "please", "please note", "simply", "just", "easily", "at this time", "in order to", "it's important to note".
- Promotional words: "seamless", "powerful", "robust", "cutting-edge", "effortless", "smart" (as praise).
- AI-writing tells: "not X but Y" contrasts, groups of three added for rhythm, "serves as", "stands as", "ensuring…" and "highlighting…" tails, "Additionally", "crucial", "key" (as an adjective), "landscape", "leverage", em dashes used as commas, and bold on phrases that aren't UI labels or lead-ins.
- Claims about data that aren't exact. Never call usage data "anonymous"; it's pseudonymous, under a random identifier (`scripts/check-release-docs.mjs` refuses "anonymous"). Never say that nothing leaves the device before **Share** without naming the two taps that send a store's domain.
- Internal process in user-facing text: phase numbers, agent names and review steps belong in the wiki. The README may describe the curation process, because it's the project's subject.

## Terminology

Use these terms consistently. Quote extension interface text exactly as it appears, including its British spellings ("recognised").

| Use | Not | Notes |
| --- | --- | --- |
| AI Checkout | the AI Checkout extension (after first use), AIC | Product name; "the extension" is fine on second reference |
| badge | pill, overlay, widget | The element on a cart page; "badge panel" when expanded |
| popup, toolbar popup | extension window, menu | Opened from the toolbar button |
| amount view, rates view | rate mode, fallback | The badge's two views |
| card terms | rules data, catalog data | User-facing. "Card catalog" or "catalog release" in developer text |
| store list | merchant DB, merchant list | User-facing. "Merchant release" in developer text |
| cart reader | extractor, scraper | Never "scrape" |
| usage reports | telemetry, analytics, tracking | User-facing. "Telemetry" only in developer text |
| random identifier | install ID, user ID, anonymous ID | User-facing. `install_id` in developer text |
| Share, Not now, Stop sharing, Delete my data, Delete all local data | opt in, opt out, wipe | Exact interface labels, in bold when they're something to choose |
| issuer | bank, provider | "Bank" only when quoting the interface ("card or bank name") |
| verifier agents, agent-verified | reviewers, human-verified | Never imply a person checked something an agent checked |
| publish, release | push, ship, deploy (for catalogs) | A catalog is published as a release |

## Capitalization and punctuation

- Sentence case for titles, headings, table headers, buttons described in prose and link text. Capitalize product names (Chrome Web Store, American Express) and interface labels exactly as shown.
- No serial comma ("cards, settings and purchase inputs"). This deviates from Google and Microsoft on purpose: the extension's shipped interface and consent text don't use it, and the docs must match them word for word. Revisit both together if the extension copy changes.
- Use straight quotes in Markdown and code; the site's JSX uses typographic quotes and apostrophes (“ ” ’), as it does today.
- Don't end headings with a period or colon.
- Use an en dash for numeric ranges (65–83%, 1–6 days); avoid em dashes in prose.

## Dates, numbers, money and percentages

- Write dates as `YYYY-MM-DD` (2026-11-06), never "today", "last week" or a two-digit year. Times are UTC and say so (03:17 UTC). This is a standing project rule and is unambiguous in every locale.
- A dated document carries one "Last updated" line near the top. Update it on every substantive change to a policy.
- Money: U.S. dollars with a dollar sign and two decimals ($3.00, $1,000.00). Ranges: $1.00–$3.00.
- Percentages: numerals with a percent sign and no space (3%, 99.2%). Rates in prose: "3% back", "1.5% on all other purchases".
- Use numerals for 10 and above and for any measurement, count of cards or stores, time or version (178 cards, 90 days, 15 minutes, version 2.1.0). Spell out one to nine in ordinary prose ("ten largest issuers" is a fixed phrase on the site).
- Version numbers: "version 2.1.0", never "v2.1.0" in prose.

## Headings and structure

- One H1 per page. H2 for sections, H3 for subsections. Don't skip levels.
- Make headings descriptive and task-based where possible ("Delete your data", "Report a problem").
- Bold lead-ins ("**What leaves the page.**") are fine for a bulleted list of parallel definitions. Don't use them as a substitute for headings in long prose.
- Tables for parallel facts (troubleshooting, permissions, results). Keep cells to one or two sentences.
- Put UI labels in bold, file names, paths, commands, endpoints and identifiers in code font.

## Links

- Use descriptive link text that says where the link goes: "see the [privacy policy](privacy-policy.md)", not "click here" or a bare URL in running text.
- Mark external links on the site with the `isExternal` link prop, which adds "(opens in a new tab)".
- Link to the page that owns a fact instead of repeating it. The privacy policy and the event dictionary are the authority on data; the store listing and support pages summarize them and must not contradict them.
- Relative links in Markdown; absolute `https://ai-checkout-api.onrender.com/…` URLs only in text that is pasted outside the repository (the store listing, reviewer instructions).

## Keeping the public pages true

- The privacy policy and support pages exist twice: `docs/release/*.md` and `apps/site/src/pages.tsx`. Change both in the same commit.
- Before a release, run `node scripts/check-release-docs.mjs --release`, `npm run telemetry:check` and the site tests (`npm run test --workspace=@ai-checkout/site`).
- When the code and a public page disagree, the code is right. Fix the page, and record the fix in the wiki log.
