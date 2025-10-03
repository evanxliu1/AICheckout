# Supabase Setup Guide

This guide walks you through setting up the Supabase backend for the Credit Card Recommender extension.

## Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create a new account
3. Click **"New Project"**
4. Fill in project details:
   - **Name:** credit-card-recommender (or your preferred name)
   - **Database Password:** Create a strong password (save this!)
   - **Region:** Choose closest to your users
   - **Pricing Plan:** Free tier is sufficient for development
5. Click **"Create new project"**
6. Wait 2-3 minutes for project to be provisioned

## Step 2: Get API Credentials

1. In your project dashboard, click **"Settings"** (gear icon in sidebar)
2. Navigate to **"API"** section
3. Copy the following credentials:
   - **Project URL:** `https://xxxxx.supabase.co`
   - **anon public key:** Starts with `eyJ...`
   - **service_role key:** Starts with `eyJ...` (keep this secret!)

## Step 3: Configure Environment Variables

1. In the `extension-v2/` directory, create a `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```env
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
   ```

3. **Important:** Never commit `.env` to version control! (It's already in `.gitignore`)

## Step 4: Run Database Migrations

1. In Supabase dashboard, click **"SQL Editor"** in the sidebar
2. Click **"New query"**
3. Copy the entire contents of `supabase/migrations/001_create_credit_cards_table.sql`
4. Paste into the SQL editor
5. Click **"Run"** (or press Cmd/Ctrl + Enter)
6. Verify success message appears

### What this migration does:
- Creates `credit_cards` table with proper schema
- Sets up indexes for performance
- Creates `updated_at` trigger for automatic timestamps
- Enables Row Level Security (RLS)
- Creates policy for public read access to active cards

## Step 5: Seed Initial Data

1. Still in SQL Editor, click **"New query"**
2. Copy contents of `supabase/seed/001_seed_credit_cards.sql`
3. Paste and click **"Run"**
4. You should see 3 rows returned (Chase Freedom Flex, Amex Gold, Citi Double Cash)

## Step 6: Verify Database Setup

1. In Supabase dashboard, click **"Table Editor"** in sidebar
2. Click on `credit_cards` table
3. Verify you see 3 credit cards with proper data
4. Check that columns match schema: id, name, annual_fee, rewards, description, is_active, created_at, updated_at

## Step 7: Test API Access (Optional)

You can test API access using curl or Postman:

```bash
curl 'https://xxxxx.supabase.co/rest/v1/credit_cards?select=*' \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Expected response:
```json
[
  {
    "id": "...",
    "name": "Chase Freedom Flex",
    "annual_fee": 0,
    "rewards": {...},
    ...
  },
  ...
]
```

## Troubleshooting

### Error: "relation 'credit_cards' does not exist"
- Make sure you ran the migration SQL (Step 4)
- Check for any error messages in SQL Editor

### Error: "permission denied for table credit_cards"
- Verify RLS policy was created correctly
- Check that `is_active = TRUE` policy exists in Table Editor → RLS section

### Can't see data in Table Editor
- Make sure seed SQL ran successfully (Step 5)
- Try running: `SELECT * FROM credit_cards;` in SQL Editor

### Environment variables not loading
- Verify `.env` file is in `extension-v2/` directory
- Restart Vite dev server: `npm run dev`
- Variables must start with `VITE_` prefix to be exposed to client

## Next Steps

After completing setup:
1. Create Supabase client in `src/services/supabase.ts`
2. Test connection from extension
3. Implement card fetching in extension UI

## Security Notes

- **anon key:** Safe to use in extension (client-side). Protected by RLS policies.
- **service_role key:** Only use in backend API server. Never expose in extension code!
- RLS policies control what data can be accessed with anon key
- Currently configured for read-only access to active cards

## Adding More Cards

To add cards via SQL Editor:
```sql
INSERT INTO credit_cards (name, annual_fee, rewards, description)
VALUES (
  'Card Name',
  95,
  '{"category": "reward value"}'::jsonb,
  'Card description here.'
);
```

## Database Schema Reference

```sql
credit_cards (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  annual_fee NUMERIC DEFAULT 0,
  rewards JSONB NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

### Rewards JSONB Format
```json
{
  "groceries": "5% cashback",
  "dining": "4x points",
  "travel": "3% cashback",
  "all": "1% cashback"
}
```
