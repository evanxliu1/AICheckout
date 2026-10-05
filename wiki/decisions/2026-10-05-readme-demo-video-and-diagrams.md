---
type: Decision
title: README demo video (Ocean cinematic, extension only) and SVG diagrams
description: Evan chose an extension-only motion-graphic demo in the Ocean cinematic style for the README, committed under docs/readme/ and embedded inline from a GitHub upload; the README's Mermaid chart became hand-drawn light/dark SVG diagrams.
status: accepted
tags: [decision, docs, release, design]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T04:30:00Z
sources:
  - resource: ../../README.md
    title: Repository README
  - resource: ../../docs/readme/demo.mp4
    title: Demo video
---

# README demo video (Ocean cinematic, extension only) and SVG diagrams (2026-10-05)

## Context
Evan asked on 2026-10-04 for an up-to-date repository README with better-looking flow charts, and for a motion-graphic demo video showing the real, current extension: smooth, slow, product-film style, not an announcement. Subagents made five style directions from one brief, then five more on a script Evan revised. The README's only chart was a GitHub Mermaid flowchart. GitHub plays videos inline only from `user-attachments` URLs, which are created by an upload in the GitHub web UI; a repository MP4 shows as a link.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Extension-only script, Ocean cinematic style** | Chosen | Evan's pick after two rounds; he cut the uncertainty-range, engine, curation and eval beats ("focus only on the extension"; a later video may cover curation) and rewrote the copy to sound less machine-written |
| One-camera, calm-light, editorial or blueprint style | Rejected | Evan preferred the Ocean cut of the same script |
| Animated GIF preview in the README | Rejected | 11 MB even at 640 px and 10 fps, with banding on the navy gradients |
| **`user-attachments` upload embedded inline, MP4 committed as source** | Chosen | GitHub plays it inline; Evan uploaded it once in the web UI (10 MB limit, hence the CRF 24 encode) |
| Poster image linked to the committed MP4 | Superseded | Used until the upload existed; a click opened the file page, not a player |
| Styled Mermaid | Rejected | Limited layout and theming control |
| **Hand-drawn SVG, light and dark variants in `<picture>`** | Chosen | Matches the Ocean palette and follows GitHub's theme |

## Decision
- The README hero is the video itself, embedded from a `user-attachments` upload; the source copy is `docs/readme/demo.mp4`: 40.6 s, 1920×1080, 60 fps, about 9.5 MB (H.264 CRF 24, under GitHub's 10 MB upload limit).
- The video uses real captures of the extension built from `main` on 2026-10-04: popup tabs at 3×, and the badge on a neutral "Sample Store" cart served at a supported cart URL. The savings history was filled through the normal badge flow with a clock shim in a copy of the service-worker loader; there is no retailer branding.
- On-screen text, verbatim:
  1. "Add the cards you already have." / "Search 178+ cards from the biggest U.S. issuers."
  2. "Then shop the way you normally do."
  3. "At checkout, use the best card."
  4. "Every card you own, side by side."
  5. "Keep track of your savings."
  6. "Your cards stay in your browser." / "No card numbers or credit card information, ever."
  7. "Know which card to use before you pay."
- "178+" and "the biggest U.S. issuers" are deliberate, because card and merchant expansion are under way.
- The README diagrams are `docs/readme/{architecture,curation}-{light,dark}.svg`.

## Consequences
- The video's scene source, render harness and captures are not in the repository; they were made in a session scratchpad, so the video is not reproducible from the repo. If the UI changes visibly, the video must be remade. It is presentation media, not hash-pinned release media ([release media](../ops/release-media.md)).
- Evan uploaded the MP4 in the GitHub web UI on 2026-10-05; the README embeds its `user-attachments` URL, which plays inline. The committed `docs/readme/demo.mp4` stays as the source copy and the header row's link; no poster image is kept.
- An independent review (agent-verified) corrected the README and diagram wording before merge. Quotes that don't match the page are flagged for review, not rejected. The catalog is bundled, and the `/v1/catalog` refresh is optional. The real catalog is verified by agents and published by a person, not reviewed condition by condition. All seven held-out rows are shown.

## Status
Accepted 2026-10-05 by Evan Liu.
