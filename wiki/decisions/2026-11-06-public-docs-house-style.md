---
type: Decision
title: "A house style for the public docs and site, following Google and Microsoft, with no serial comma to match the extension's interface text"
description: On Evan's request of 2026-11-06 the public site, READMEs and release docs were rewritten to read like mainstream product documentation; docs/release/style-guide.md records the voice, terminology, dates, money, headings and link rules, and the privacy policy takes the structure of mainstream product privacy notices.
status: accepted
tags: [decision, phase-15, release, docs, site]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-11-06T19:30:00Z
sources:
  - resource: ../../docs/release/style-guide.md
    title: House style for public docs
  - resource: https://developers.google.com/style/tone
    title: Google developer documentation style guide, voice and tone
  - resource: https://learn.microsoft.com/style-guide/top-10-tips-style-voice
    title: Microsoft Writing Style Guide, top 10 tips
---

# A house style for the public docs (2026-11-06)

## Context
Evan asked on 2026-11-06 for a full audit of the live site, the READMEs and the documentation, to "make it sound more official / less ai sounding", following the tone and formatting of official documentation from mainstream companies. The public copy was accurate after the 15.5 reviews but dense, used bold lead-ins and long semicolon chains, and mixed internal process into shopper-facing text. The live audit also found false or stale statements on the site: the architecture diagram still said the extension's only request was a catalog fetch on demand and that the cart reader runs on click, the home page said the bundled catalog was still awaiting a person's review, and the "Build from source" link pointed to a README anchor that no longer exists.

## Options considered
1. Edit sentences in place without a written standard. Cheap, but the next change drifts back.
2. Adopt Google's developer style guide and Microsoft's Writing Style Guide wholesale, including the serial comma.
3. Adopt both guides, with a one-page project style that names the terms and the exceptions.

## Decision
Option 3. [`docs/release/style-guide.md`](../../docs/release/style-guide.md) governs the site, the root and package READMEs, `SECURITY.md` and `docs/release/` and `docs/verification/`. It sets the voice (second person, active, present tense, conditions before instructions, no pre-announcing, no filler or promotional words, the AI-writing tells to avoid), a terminology table (card terms, store list, usage reports, random identifier, badge, amount view, rates view, agent-verified), sentence-case headings, `YYYY-MM-DD` dates and UTC times, money and percentage formats, and descriptive link text. The privacy policy now opens with a summary and follows the section order of mainstream product privacy notices (information stored, read, sent; usage reports; how we use and share information; retention; your choices; children; changes; contact), with "we" defined as Evan Liu.

One deliberate deviation: **no serial comma**. The extension's shipped interface and consent text ("no name, email or browsing history") don't use it, the public pages must match that text word for word, and changing the consent copy is an extension change outside this task. The style guide says to revisit both together.

## Consequences
- The privacy policy's date moved to 2026-11-06 (restructured, no change in what is collected or sent); Evan's pre-submission read of the policy should use this version.
- Quoted interface text keeps the extension's British spellings ("recognised"); docs otherwise use American spelling.
- The site needs a redeploy (merge to `main`) for the live fixes.
- Facts were checked by an independent reviewer subagent against the code (agent-verified, not human-verified); its findings were applied.

## Status
Accepted 2026-11-06 (editor's choice on Evan's request; Evan may flip the serial-comma exception).
