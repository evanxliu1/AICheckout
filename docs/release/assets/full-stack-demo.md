# Full-stack portfolio recording

[Watch the captioned MP4](full-stack-demo.mp4) · [Captions](full-stack-demo.vtt) · [Capture and verification evidence](full-stack-capture.json) · [Media provenance](full-stack-media.json)

Recorded 2026-10-03. Duration: 59.5 seconds. Actual 1280×800 review interface, unscaled inside a 1280×960 H.264 video with an explanatory footer. No audio narration. The [underlying WebM](full-stack-demo.webm) is retained for provenance and lacks the persistent presentation labels; use the MP4 for public demonstration.

This connects the built React interface to the compiled Node/Fastify API, real local Supabase Auth and PostgreSQL. The model response is intercepted and synthetic. The 2.5% example is invented, not issuer terms or measured model accuracy. Its source identifier retains the registered issuer URL so the existing source-pack guard runs; no issuer website is fetched. All accounts, sources, runs and draft publications are disposable local fixtures. No live provider call, actual charge or hosted publication occurred.

## Transcript

| Time | Step | Explanation |
| --- | --- | --- |
| 00:00 | Sign in to review | Disposable local account. React connects to the compiled Node API and local Supabase Auth. |
| 00:03 | Start from a saved draft | A revision and captured source identify the input. These invented 2.5% terms are demonstration data. |
| 00:08 | Request bounded extraction | The real SDK runs through a blocked, simulated transport. No live model call or provider charge occurs. |
| 00:12 | Inspect facts and exact quotations | Each field points to a saved source span. Matching evidence is a mechanical check, not proof of correct interpretation. |
| 00:18 | Review every condition | A reviewer identifies which existing rules cover a condition and records a reason before applying anything. |
| 00:24 | Approve a draft change | The proposed rate changes from 1.5% to the invented 2.5%. A review note and fresh acknowledgement are required. |
| 00:30 | Apply without publishing | The API creates a new draft revision and records the review. The public catalog remains unchanged. |
| 00:34 | Inspect the saved review | The saved application records the revision and condition decisions. Refreshing a run reads the ledger without another model request. |
| 00:39 | Inspect context and accounting | The saved run exposes prompt/schema versions, context identity and attempts. Token and cost values here are simulated. |
| 00:45 | Publish in a separate action | A second review confirms the complete draft. Publication is bound to its exact revision, hash and current catalog head. |
| 00:54 | Verify the public result | The local public endpoint now returns the reviewed revision. Cleanup restores the previous head and removes all demo records. |

## Verified boundaries

- Unauthenticated/ordinary accounts are rejected with 401/403 before recording.
- Extraction returns an evidence-checked proposal; application requires condition decisions, a note and acknowledgement.
- Applying creates exactly one new draft revision while the public head stays unchanged.
- Refreshing reads the saved run; the run count remains one.
- Separate publication changes the local public endpoint to the reviewed synthetic catalog.
- The browser persists no authentication data in localStorage, sessionStorage or cookies; no page errors or external browser requests occurred.
- Cleanup removes both disposable accounts and their sources/drafts/runs, restores the prior public head and restores the prior curation policy.

Source/build fingerprint: `51c7b4c811b6eb814d8e921c7caaaa454680b45690cb0abf4f0c2b111353b42a`. The capture manifest records all 100 source/input files and 9 compiled files by hash; this identifies the dirty worktree content without claiming a commit or remote CI run. The renderer refuses changed inputs. Recorded token/cost fields exercise accounting with simulated prices; they are not provider billing.

## Reproduce

With Node 24, workspace dependencies, the disposable local Supabase stack, Playwright Chromium and ffmpeg/ffprobe available:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/aicheckout-playwright npm run release:portfolio
```

Use your own installed Playwright browser path. The command builds both apps, records the explicitly gated local fixture, composes the video and verifies playback, captions, hashes and cleanup. It does not reset the database or deploy. The normal browser suite skips this recording. Regenerate when source/build inputs change; no cross-platform byte parity is claimed.

The first capture attempt used an unregistered example URL and was correctly rejected before extraction. The fixture was corrected to retain the registered identity; the production guard was not weakened.

Still required: independent source/label review, funded live model evaluation with failure/latency/cost results, hosted deployment, and final installed-Chrome/testing evidence. See the [portfolio plan](../portfolio-demo.md) and [release requirements](../README.md).
