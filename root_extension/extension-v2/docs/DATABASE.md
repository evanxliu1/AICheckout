# Database Documentation

**Complete guide to Supabase database, caching, and Chrome storage**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Table Structure](#table-structure)
5. [JSONB Rewards Format](#jsonb-rewards-format)
6. [Row Level Security (RLS)](#row-level-security-rls)
7. [Triggers & Functions](#triggers--functions)
8. [Migrations](#migrations)
9. [Seed Data](#seed-data)
10. [Supabase Client](#supabase-client)
11. [Caching Strategy](#caching-strategy)
12. [Chrome Storage](#chrome-storage)
13. [Best Practices](#best-practices)
14. [Troubleshooting](#troubleshooting)

---

## Overview

The extension uses **Supabase** (PostgreSQL) as the backend database for credit card data. This provides a scalable, real-time, and easily manageable data layer with built-in security through Row Level Security (RLS).

**Key Benefits:**
- 🗄️ **PostgreSQL** - Powerful relational database
- 🔒 **Row Level Security** - Built-in access control
- 🚀 **Real-time** - Instant data updates (future feature)
- 📊 **JSONB** - Flexible rewards structure
- 🔄 **Caching** - 1-hour TTL for performance
- 🌐 **Hosted** - No infrastructure management

**Connection:** Direct from extension using Supabase JS client

---

## Architecture

### Data Flow

```
Supabase (PostgreSQL)
      ↓
Supabase JS Client (extension)
      ↓
1-hour cache (chrome.storage.local)
      ↓
Application state (Zustand)
      ↓
UI Components
```

### Caching Layers

```
Level 1: Supabase Database (source of truth)
   ↓
Level 2: Chrome Local Storage (1-hour cache)
   ↓
Level 3: Zustand Store (runtime state)
```

**Cache Invalidation:** Time-based (1 hour TTL)

---

## Database Schema

### ERD (Entity Relationship Diagram)

```
┌─────────────────────────────────────────┐
│            credit_cards                  │
├─────────────────────────────────────────┤
│ id            UUID (PK)                  │
│ name          TEXT                       │
│ annual_fee    NUMERIC                    │
│ rewards       JSONB                      │
│ description   TEXT                       │
│ is_active     BOOLEAN                    │
│ created_at    TIMESTAMPTZ                │
│ updated_at    TIMESTAMPTZ                │
└─────────────────────────────────────────┘

Indexes:
- idx_credit_cards_is_active (is_active)

Policies:
- Allow public read access to active cards
```

### Table: credit_cards

**Purpose:** Store credit card information for AI recommendations

**File:** `supabase/migrations/001_create_credit_cards_table.sql`

```sql
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  annual_fee NUMERIC NOT NULL DEFAULT 0,
  rewards JSONB NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Table Structure

### Column Definitions

#### `id` - UUID (Primary Key)

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

- **Type:** UUID (Universally Unique Identifier)
- **Default:** Auto-generated using `gen_random_uuid()`
- **Purpose:** Unique identifier for each card
- **Example:** `"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"`

---

#### `name` - TEXT (Required)

```sql
name TEXT NOT NULL
```

- **Type:** TEXT (unlimited length string)
- **Nullable:** No
- **Purpose:** Official credit card name
- **Examples:**
  - `"Chase Freedom Flex"`
  - `"American Express Gold Card"`
  - `"Citi Double Cash"`

---

#### `annual_fee` - NUMERIC (Required)

```sql
annual_fee NUMERIC NOT NULL DEFAULT 0
```

- **Type:** NUMERIC (precise decimal)
- **Default:** `0`
- **Purpose:** Annual fee in US dollars
- **Examples:**
  - `0` (no annual fee)
  - `95` ($95 annual fee)
  - `250` ($250 annual fee)

**Why NUMERIC?** Avoids floating-point precision issues with REAL/FLOAT

---

#### `rewards` - JSONB (Required)

```sql
rewards JSONB NOT NULL
```

- **Type:** JSONB (binary JSON, indexed)
- **Nullable:** No
- **Purpose:** Flexible rewards structure
- **Structure:** `{category: value}`

**Example:**
```json
{
  "groceries": "5% cashback",
  "dining": "4x points",
  "travel": "3x points",
  "all": "1% cashback"
}
```

**See:** [JSONB Rewards Format](#jsonb-rewards-format) for details

---

#### `description` - TEXT (Optional)

```sql
description TEXT
```

- **Type:** TEXT
- **Nullable:** Yes
- **Purpose:** Brief description of card benefits
- **Example:** `"Great for rotating 5% categories and online shopping. No annual fee."`

---

#### `is_active` - BOOLEAN

```sql
is_active BOOLEAN DEFAULT TRUE
```

- **Type:** BOOLEAN
- **Default:** `TRUE`
- **Purpose:** Whether card should be included in recommendations
- **Usage:** Soft delete (set to FALSE instead of deleting row)

---

#### `created_at` - TIMESTAMPTZ

```sql
created_at TIMESTAMPTZ DEFAULT NOW()
```

- **Type:** TIMESTAMPTZ (timestamp with timezone)
- **Default:** Current timestamp
- **Purpose:** Track when card was added

---

#### `updated_at` - TIMESTAMPTZ

```sql
updated_at TIMESTAMPTZ DEFAULT NOW()
```

- **Type:** TIMESTAMPTZ
- **Default:** Current timestamp
- **Auto-update:** Via trigger (see [Triggers](#triggers--functions))
- **Purpose:** Track last modification

---

## JSONB Rewards Format

### Structure

```json
{
  "category": "reward_value",
  "category2": "reward_value2"
}
```

### Category Examples

| Category | Description |
|----------|-------------|
| `groceries` | Supermarkets, grocery stores |
| `dining` | Restaurants, cafes, bars |
| `travel` | Flights, hotels, rental cars |
| `entertainment` | Movies, concerts, streaming |
| `online` | E-commerce purchases |
| `all` | Catch-all for other purchases |

### Reward Value Formats

**Cashback:**
```json
"groceries": "5% cashback"
"all": "2% cashback"
```

**Points:**
```json
"dining": "4x points"
"travel": "3x points"
```

**Mixed:**
```json
"dining": "4x Membership Rewards points"
"rotating": "5% cashback (rotating categories)"
```

### Real Examples

**Chase Freedom Flex:**
```json
{
  "groceries": "5% cashback",
  "entertainment": "3% cashback",
  "online": "5% cashback",
  "travel": "5% cashback (rotating)",
  "all": "1% cashback"
}
```

**Amex Gold:**
```json
{
  "groceries": "4x points",
  "dining": "4x points",
  "travel": "3x points",
  "all": "1x points"
}
```

**Citi Double Cash:**
```json
{
  "all": "2% cashback"
}
```

### Benefits of JSONB

1. **Flexible** - Add new categories without schema changes
2. **Queryable** - Can query JSON fields directly
3. **Indexed** - Supports GIN indexes for fast lookups
4. **Type-safe** - PostgreSQL validates JSON format

### Querying JSONB

```sql
-- Get cards with groceries rewards
SELECT name, rewards->'groceries' as grocery_reward
FROM credit_cards
WHERE rewards ? 'groceries';

-- Get cards with 4x points or more
SELECT name, rewards
FROM credit_cards
WHERE rewards @> '{"dining": "4x points"}';
```

---

## Row Level Security (RLS)

### What is RLS?

Row Level Security allows you to control which rows users can access based on policies. This is a PostgreSQL security feature built into Supabase.

### Enabled for credit_cards

```sql
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
```

### Policy: Public Read Access to Active Cards

```sql
CREATE POLICY "Allow public read access to active cards"
  ON credit_cards
  FOR SELECT
  USING (is_active = TRUE);
```

**What it does:**
- Allows unauthenticated users to SELECT rows
- Only returns rows where `is_active = TRUE`
- Prevents access to inactive/deleted cards

**Security Benefits:**
1. ✅ Extensions can read active cards without authentication
2. ✅ Inactive cards are hidden automatically
3. ✅ No accidental data exposure
4. ✅ Simplifies client-side code

### Optional: Admin Write Access

```sql
-- Commented out in migration, but available
CREATE POLICY "Allow authenticated write access"
  ON credit_cards
  FOR ALL
  USING (auth.role() = 'authenticated');
```

**Usage:** For future admin panel to manage cards

---

## Triggers & Functions

### Auto-update `updated_at` Column

**Function:**
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Trigger:**
```sql
CREATE TRIGGER update_credit_cards_updated_at
  BEFORE UPDATE ON credit_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**How it works:**
1. Before any UPDATE on `credit_cards`
2. Automatically set `updated_at = NOW()`
3. No manual timestamp management needed

**Example:**
```sql
-- Update card
UPDATE credit_cards
SET annual_fee = 95
WHERE name = 'Chase Freedom Flex';

-- updated_at is automatically set to current time
```

---

## Migrations

### Migration File Structure

```
supabase/
└── migrations/
    └── 001_create_credit_cards_table.sql
```

### Running Migrations

**Manual (Supabase Dashboard):**
1. Go to https://app.supabase.com
2. Select your project
3. Navigate to SQL Editor
4. Copy contents of `001_create_credit_cards_table.sql`
5. Run the SQL

**With Supabase CLI:**
```bash
# Initialize Supabase (first time)
supabase init

# Link to remote project
supabase link --project-ref your-project-id

# Run migrations
supabase db push
```

### Migration Contents

1. **Create table** - `credit_cards` with all columns
2. **Create index** - On `is_active` for performance
3. **Create trigger function** - `update_updated_at_column()`
4. **Create trigger** - `update_credit_cards_updated_at`
5. **Enable RLS** - Row Level Security
6. **Create policy** - Public read access to active cards
7. **Add comments** - Documentation for each column

---

## Seed Data

### Seed File Structure

```
supabase/
└── seed/
    └── 001_seed_credit_cards.sql
```

### Running Seeds

**Manual (Supabase Dashboard):**
1. Go to SQL Editor
2. Copy contents of `001_seed_credit_cards.sql`
3. Run the SQL

**With Supabase CLI:**
```bash
supabase db reset  # Runs migrations + seeds
```

### Initial Cards

**1. Chase Freedom Flex**
```sql
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Chase Freedom Flex',
  0,
  '{
    "groceries": "5% cashback",
    "entertainment": "3% cashback",
    "online": "5% cashback",
    "travel": "5% cashback (rotating)",
    "all": "1% cashback"
  }'::jsonb,
  'Great for rotating 5% categories and online shopping. No annual fee.',
  TRUE
);
```

**2. Amex Gold**
```sql
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Amex Gold',
  250,
  '{
    "groceries": "4x points",
    "dining": "4x points",
    "travel": "3x points",
    "all": "1x points"
  }'::jsonb,
  'Earns 4x points at U.S. supermarkets and restaurants. Excellent for foodies and families.',
  TRUE
);
```

**3. Citi Double Cash**
```sql
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Citi Double Cash',
  0,
  '{
    "all": "2% cashback"
  }'::jsonb,
  'Simple 2% cashback on everything. No annual fee. Great for general use.',
  TRUE
);
```

---

## Supabase Client

### Client Initialization

**Location:** `src/services/supabase.ts`

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Get credentials from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Singleton client
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase credentials not configured');
    }
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseClient;
}
```

### Environment Variables

**File:** `.env`

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Get from:** Supabase Dashboard → Settings → API

### Fetching Active Cards

```typescript
export async function getActiveCards(forceRefresh = false): Promise<CreditCard[]> {
  try {
    // 1. Check cache first
    if (!forceRefresh) {
      const isStale = await areCachedCardsStale();
      if (!isStale) {
        const cachedCards = await getCachedCards();
        if (cachedCards.length > 0) {
          return cachedCards;
        }
      }
    }

    // 2. Fetch from Supabase
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    // 3. Transform and cache
    const cards: CreditCard[] = data.map((card: any) => ({
      id: card.id,
      name: card.name,
      annualFee: Number(card.annual_fee),
      rewards: card.rewards,
      description: card.description || '',
      isActive: card.is_active,
      createdAt: card.created_at,
      updatedAt: card.updated_at
    }));

    await setCachedCards(cards);

    return cards;
  } catch (error) {
    // Fallback to cached cards
    const cachedCards = await getCachedCards();
    if (cachedCards.length > 0) {
      return cachedCards;
    }

    throw error;
  }
}
```

---

## Caching Strategy

### Why Cache?

1. **Performance** - Reduce latency (cache: ~5ms, Supabase: ~200ms)
2. **Cost** - Reduce API calls to Supabase
3. **Offline** - Work without network connection
4. **Reliability** - Fallback on network errors

### Cache TTL: 1 Hour

```typescript
const ONE_HOUR = 60 * 60 * 1000; // 3600000ms

export async function areCachedCardsStale(): Promise<boolean> {
  const lastFetch = await getFromStorage('lastCardsFetch');
  if (!lastFetch) return true;

  return Date.now() - lastFetch > ONE_HOUR;
}
```

### Cache Flow

```
Request cards
   ↓
Check lastCardsFetch timestamp
   ↓
Is it < 1 hour old?
   ├─ YES → Return cached cards from chrome.storage.local
   └─ NO  → Fetch from Supabase
              ↓
           Store in chrome.storage.local
              ↓
           Update lastCardsFetch = Date.now()
              ↓
           Return cards
```

### Force Refresh

```typescript
// Bypass cache and fetch fresh data
const cards = await getActiveCards(true);
```

### Cache Storage

**Where:** Chrome Local Storage (`chrome.storage.local`)

**Keys:**
- `cachedCards` - Array of CreditCard objects
- `lastCardsFetch` - Timestamp of last fetch

**Example:**
```json
{
  "cachedCards": [
    {
      "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "name": "Chase Freedom Flex",
      "annualFee": 0,
      "rewards": {
        "groceries": "5% cashback",
        "all": "1% cashback"
      },
      "description": "...",
      "isActive": true,
      "createdAt": "2024-10-01T12:00:00Z",
      "updatedAt": "2024-10-01T12:00:00Z"
    }
  ],
  "lastCardsFetch": 1727784000000
}
```

---

## Chrome Storage

### Storage API

**Location:** `src/utils/storage.ts` (168 lines)

### Type-Safe Helpers

```typescript
// Generic storage getter
async function getFromStorage<K extends keyof StorageData>(
  key: K
): Promise<StorageData[K] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] ?? null);
    });
  });
}

// Generic storage setter
async function setInStorage<K extends keyof StorageData>(
  key: K,
  value: StorageData[K]
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve();
    });
  });
}
```

### Card Caching Functions

```typescript
// Get cached cards
export async function getCachedCards(): Promise<CreditCard[]> {
  const cards = await getFromStorage('cachedCards');
  return cards || [];
}

// Set cached cards (also updates timestamp)
export async function setCachedCards(cards: CreditCard[]): Promise<void> {
  await setInStorage('cachedCards', cards);
  await setInStorage('lastCardsFetch', Date.now());
}

// Check if cache is stale
export async function areCachedCardsStale(): Promise<boolean> {
  const lastFetch = await getFromStorage('lastCardsFetch');
  if (!lastFetch) return true;

  const ONE_HOUR = 60 * 60 * 1000;
  return Date.now() - lastFetch > ONE_HOUR;
}
```

### Other Storage Functions

**OpenAI API Key:**
```typescript
export async function getOpenAIKey(): Promise<string>
export async function setOpenAIKey(key: string): Promise<void>
export function validateOpenAIKey(key: string): boolean
```

**Latest Recommendation:**
```typescript
export async function getLatestRecommendation(): Promise<string>
export async function setLatestRecommendation(rec: string): Promise<void>
```

**Utility Functions:**
```typescript
export async function clearAllStorage(): Promise<void>
export async function getAllStorageData(): Promise<StorageData>
export async function getStorageInfo(): Promise<{bytesInUse, quotaBytes, percentUsed}>
export async function exportSettings(): Promise<string>
export async function importSettings(jsonString: string): Promise<void>
```

### Storage Quota

**Chrome Extension Limit:** 10MB (chrome.storage.local.QUOTA_BYTES)

**Current Usage:** ~5-10KB for 3 cards + metadata

**Check Usage:**
```typescript
const info = await getStorageInfo();
console.log(`Using ${info.bytesInUse} / ${info.quotaBytes} bytes (${info.percentUsed.toFixed(2)}%)`);
```

---

## Best Practices

### Database Design

1. **Use UUID for IDs** - Better than auto-increment for distributed systems
2. **JSONB for flexibility** - Rewards can vary per card without schema changes
3. **Soft deletes** - Use `is_active = FALSE` instead of DELETE
4. **Timestamps** - Always include `created_at` and `updated_at`
5. **Indexes** - Add for frequently queried columns (e.g., `is_active`)

### Supabase Usage

1. **Connection Pooling** - Supabase handles this automatically
2. **RLS Policies** - Always use for security
3. **Anon Key in Extension** - Safe for read-only operations
4. **Service Role Key** - Only use on server-side (if using backend API)
5. **Error Handling** - Always check `error` from Supabase responses

### Caching

1. **Cache Aggressively** - 1 hour TTL is reasonable for rarely-changing data
2. **Fallback to Cache** - Return cached data on network errors
3. **Force Refresh Option** - Allow bypassing cache when needed
4. **Clear on Logout** - Reset cache when user logs out (future feature)

### Chrome Storage

1. **Type Safety** - Use TypeScript interfaces for storage data
2. **Error Handling** - Check `chrome.runtime.lastError`
3. **Quota Monitoring** - Alert users when approaching limit
4. **Backup/Export** - Provide export settings functionality

---

## Troubleshooting

### Issue: "Supabase credentials not configured"

**Cause:** Missing `.env` file or environment variables

**Solution:**
1. Create `.env` file in `extension-v2/` directory
2. Add credentials:
   ```env
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. Get from: Supabase Dashboard → Settings → API
4. Rebuild: `npm run build`

---

### Issue: "No active cards found in database"

**Cause:** Database is empty or all cards have `is_active = FALSE`

**Solution:**
1. Run seed file: `supabase/seed/001_seed_credit_cards.sql`
2. Or manually insert cards via Supabase SQL Editor

**Check:**
```sql
SELECT name, is_active FROM credit_cards;
```

---

### Issue: Cards not updating after database changes

**Cause:** Cache is still valid (< 1 hour old)

**Solution:**
1. Wait for cache to expire (1 hour)
2. Or force refresh:
   ```typescript
   const cards = await getActiveCards(true);
   ```
3. Or clear storage:
   ```typescript
   await clearAllStorage();
   ```

---

### Issue: RLS policy blocking reads

**Cause:** Policy misconfigured or cards have `is_active = FALSE`

**Debug:**
```sql
-- Check policy
SELECT * FROM pg_policies WHERE tablename = 'credit_cards';

-- Check cards
SELECT name, is_active FROM credit_cards;
```

**Solution:**
- Ensure policy allows SELECT where `is_active = TRUE`
- Set cards to active: `UPDATE credit_cards SET is_active = TRUE`

---

### Issue: Storage quota exceeded

**Cause:** Too much data in chrome.storage.local

**Check:**
```typescript
const info = await getStorageInfo();
if (info.percentUsed > 80) {
  alert('Storage nearly full!');
}
```

**Solution:**
- Clear old recommendations: `await setLatestRecommendation('')`
- Clear all storage: `await clearAllStorage()`

---

### Debugging Tips

**1. Test Supabase Connection:**
```typescript
import { testConnection } from './services/supabase';

const isConnected = await testConnection();
console.log('Supabase connected:', isConnected);
```

**2. Check Cached Data:**
```typescript
const data = await getAllStorageData();
console.log('Storage data:', data);
```

**3. Monitor Cache Staleness:**
```typescript
const isStale = await areCachedCardsStale();
console.log('Cache is stale:', isStale);
```

**4. Test SQL Directly:**
- Go to Supabase Dashboard → SQL Editor
- Run test queries:
  ```sql
  SELECT * FROM credit_cards WHERE is_active = TRUE;
  ```

---

## Summary

The database layer provides:

- ✅ **Supabase PostgreSQL** - Scalable, managed database
- ✅ **JSONB Rewards** - Flexible structure for card benefits
- ✅ **Row Level Security** - Built-in access control
- ✅ **1-hour Caching** - Performance optimization
- ✅ **Chrome Storage** - Local persistence
- ✅ **Type Safety** - TypeScript throughout
- ✅ **Error Handling** - Fallbacks and retries

**Key Files:**
- Migration: `supabase/migrations/001_create_credit_cards_table.sql`
- Seed: `supabase/seed/001_seed_credit_cards.sql`
- Client: `src/services/supabase.ts`
- Storage: `src/utils/storage.ts`

**Connection String:**
```
https://<project-id>.supabase.co
```

**Cache TTL:** 1 hour (3600000ms)

---

*Last updated: October 2024*
*Part of extension-v2 documentation suite - see `CLAUDE.md` for navigation*
