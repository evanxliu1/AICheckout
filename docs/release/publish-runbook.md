# Publish the 7-card catalog on the hosted review app

This is the human approval step for catalog `2026-09-29.real.1` (seven cards, 17 sources). Only a signed-in reviewer can publish, and only Evan does it; no script or agent publishes. It takes about 20 minutes.

**Deadline:** the catalog expires **2026-10-29 00:00 UTC**. Publish well before then. After it expires the review app refuses to start a draft from it, the database refuses to publish it, and extensions stop using it. A later catalog then needs reverified terms (`npm run catalog:v2` from fresh captures and labels).

## Before you start

Already done (you only verify):

- [x] **Database migrations.** The coordinator pushed both new migrations, `20260930225732_catalog_v2.sql` (catalog v2) and `20261001010350_source_body_limit.sql` (captures up to 120,000 characters; the Citi terms PDF is about 75,000), to the hosted database and checked health. To verify, run `npx supabase migration list --linked` from the repository root: both show in the Remote column. New migrations are applied with `./scripts/db-push.sh --dry-run` first, then `./scripts/db-push.sh`; it reads the database password from the macOS Keychain.
- [x] **Your reviewer account.** `evanliu5566@gmail.com` is a confirmed Supabase Auth user with a row in `catalog_private.reviewers` (provisioned in Phase 1). To add another reviewer later, the operator first creates and confirms their Auth user, then runs this in the Supabase SQL editor:

  ```sql
  insert into catalog_private.reviewers (user_id)
  select id from auth.users where email = 'reviewer@example.com';
  ```

  Never grant reviewer access through user metadata or a public endpoint.

Before you start, check:

- [ ] `phase3-m6-prep` (Start a new draft, merchant captures) is merged into `main` and Render has deployed it. https://ai-checkout-api.onrender.com/health returns `{"status":"ok"}`, and after signing in, https://ai-checkout-api.onrender.com/review/ shows **Start a new draft**.
- [ ] https://ai-checkout-api.onrender.com/v1/catalog returns `{"release":null}`, so nothing is published yet.

Your session lives only in the open tab's memory: **reloading the page or closing the tab signs you out.** That is by design. Unsaved edits are lost on reload, while saved revisions and captures are kept on the server.

On your Mac, in `~/Projects/AICheckout` (the main checkout, not `~/Projects/AICheckout-test`):

- [ ] `evals/curation/real/captures/` holds the 15 issuer captures (`citi-double-cash-product.txt` … `amex-blue-cash-preferred-terms.txt`).
- [ ] `evals/curation/real/merchant-captures/` holds `check-mcc-best-buy.txt` and `check-mcc-newegg.txt`. If the folder is missing, run:

  ```sh
  node scripts/capture-issuer-pages.mjs --sources merchant-sources.json \
    --captures merchant-captures --manifest merchant-manifest.json
  ```

  Each file must contain `MCC code 5732`. These are undated community pages: the capture keeps the catalog's recorded `checkedOn` date (2026-09-28) even though the text was fetched later (the committed hashes are from 2026-10-01). That is expected; do not edit the dates. If the command reports a new hash (`CHANGED since last capture`), the page changed since the committed `merchant-manifest.json`. The review app will then show "Differs from the corpus manifest capture" for that file. Read it and make sure it still says MCC 5732 before you continue.

Both folders are gitignored. They hold copyrighted page text, so never commit them.

## Steps

1. **Sign in.** Open https://ai-checkout-api.onrender.com/review/ and sign in with `evanliu5566@gmail.com` and your password. The free Render instance can take up to a minute to wake up. If the first load times out, reload once before you sign in.
2. **Start a new draft.** With no pending drafts, **Start a new draft** opens on its own. Otherwise, choose **Start a new draft** under Pending drafts.
   - Keep **The catalog bundled with this app** selected.
   - Check the summary: version `2026-09-29.real.1`, 7 cards (17 sources to capture), verified Sep 29, 2026, expires Oct 29, 2026, status **Valid now**.
   - Choose **Create draft**. In the dialog, check "7 cards and 17 sources", then choose **Create the draft**.
   - The new draft opens, with **Matching evidence needed** on every source. Nothing is published yet.
   - If **Create draft** shows an error, don't create another draft right away. The draft may already exist. Reload the page, sign in again, and open the `2026-09-29.real.1` draft from **Pending drafts** if it is there. If a draft of that version is already pending, the app asks you to confirm before it creates a second one; choose the existing draft instead.
3. **Attach all sources at once.** Under **Source evidence**, open **Capture all missing sources**.
   - Choose **Load capture files**.
   - In the file picker, select all 15 files in `evals/curation/real/captures/` (Cmd-A in that folder).
   - Choose **Load capture files** again and select both files in `evals/curation/real/merchant-captures/`. Each load adds to the texts already loaded.
   - The note should say each file loaded. Each source field should show its character count and **Matches the corpus manifest capture**. If any field says it differs, or a source stays empty, stop and check that file before going on.
   - The button should now read **Capture 17 of 17 missing sources and attach**. Choose it.
   - Wait for "Captured 17 sources and attached them to a new draft revision." Every source card should now show **Matching evidence captured** and a SHA-256 that **matches the corpus manifest**.
4. **Review.**
   - **What changes** compares the draft with the published catalog. With nothing published yet, every field is new.
   - Open **All proposed card rules** and read every rule and condition against the issuer pages: open **Read source terms** on each source card, or the captured text.
   - Key facts to confirm:
     - Citi: 2% (1% at purchase, 1% when paid).
     - Blue Cash Everyday: 3% on U.S. online retail up to $6,000 per year, then 1%.
     - Blue Cash Preferred: 6% at U.S. supermarkets.
     - Chase Freedom Unlimited: 1.5% base.
     - Wells Fargo Active Cash: 2%.
     - Quicksilver: 1.5%.
     - Savor: 1% base.
   - Merchants: Best Buy and Newegg are MCC 5732 (low confidence, from an undated community lookup). Amazon is online retail with a marketplace caveat.
   - If something is wrong, fix it under **Correct draft data** (**Cards and rules** or **JSON**), save, and review again. Each save is a new revision and needs fresh approval.
5. **Approve.**
   - Check **I checked the full source terms and all proposed rules and conditions.**
   - Write a **Review note** of at least 10 characters, saying what you checked. Example: "Checked all 7 cards' rates, caps, activation and U.S.-only conditions against the 15 issuer captures and both MCC pages on 2026-10-..".
   - Choose **Publish reviewed terms**.
6. **Confirm.** The dialog **Publish 2026-09-29.real.1?** opens with focus on **Cancel**. Check the revision, 7 cards, 17 sources and the expiry (Oct 29, 2026, 12:00 AM UTC), then choose **Publish release**. The page shows "Published 2026-09-29.real.1 as release N". Note N: it is 1 on a database with no earlier release.
7. **Verify.** Open https://ai-checkout-api.onrender.com/v1/catalog, or run `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 300`. Instead of `{"release":null}`, it must return a release with `"version":"2026-09-29.real.1"` and the same `"sequence"` N as the success message. Then tell the coordinator, who checks a hosted extension build (`npm run build:hosted`) against it.

## If something is blocked

| What you see | What to do |
| --- | --- |
| The page does not load or `/health` times out | Render is waking the free instance. Wait a minute and reload; you will need to sign in again. If it stays down, ask the coordinator to check the Render deploy log. |
| Signed in, but the app says reviewer access is required | The account has no row in `catalog_private.reviewers`. `evanliu5566@gmail.com` should already have one; check you used that address. For another account, the operator runs the SQL above. |
| No **Start a new draft** button | The deployed review app predates `phase3-m6-prep`. Ask the coordinator to check the merge and deploy. |
| **Create draft** says the bundled catalog cannot be used | It has expired, or the clock is wrong. After 2026-10-29 the catalog must be rebuilt from reverified terms; don't change your computer's date. |
| A capture field says **Differs from the corpus manifest capture** | The file is not the one recorded in the manifest: wrong file, edited, or recaptured. Load the right file. Recapture only if the page really changed, then reread it. |
| A capture fails with a length or "could not be captured" error | Check `npx supabase migration list --linked` shows `20261001010350` on the remote. If it does, check the file is the right one and under 120,000 characters. Nothing is attached until every capture succeeds, so retrying is safe. |
| A button is disabled with "Save or discard the unsaved input in … first" | Another editor or capture form has unsaved input. Save or discard it, as the message says. |
| **Publish** fails with a stale revision or head error | Someone saved or published in between. Choose **Reload latest draft** and review the new revision. If **Before you publish** says "Published terms changed. Rebase this draft…", choose **Rebase draft for review**, review again, and approve again. |
| Signed out unexpectedly | The page was reloaded or the session ended. Sign in again and open the draft from **Pending drafts**. Saved revisions and captures are kept; unsaved edits are not. |
| `/v1/catalog` still returns `{"release":null}` after publishing | Reload the review app and check the draft shows **Published**. If it does and the endpoint still says null after a minute, tell the coordinator; don't publish again. |
