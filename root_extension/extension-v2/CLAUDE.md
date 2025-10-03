# CLAUDE.md - Extension V2

**Navigation map for AI assistants working on the Credit Card Recommender Chrome Extension**

---

## 🎯 Quick Facts

**Status:** ✅ Production-ready MVP
**Location:** `/Users/evanliu/Projects/CreditCardAI/root_extension/extension-v2/`
**Tech Stack:** React 19 + TypeScript 5.8 + Vite 7 + Tailwind CSS 3.4 + Zustand 5
**Database:** Supabase (PostgreSQL)
**AI:** OpenAI GPT-3.5 Turbo
**Bundle Size:** ~367KB (~109KB gzipped)

---

## 🗺️ Architecture Overview

```
User clicks extension
        ↓
Popup.tsx orchestrates flow
        ↓
Content script extracts cart items (Hybrid Registry Pattern)
        ↓
Fetch credit cards from Supabase (1-hour cache)
        ↓
Build prompt + call OpenAI GPT-3.5 Turbo
        ↓
Display recommendation in popup + on-page banner
```

---

## 📁 Project Structure

```
extension-v2/
├── src/
│   ├── content/
│   │   ├── extractors/          # 📦 Cart extraction (Hybrid Registry)
│   │   │   ├── ExtractorRegistry.ts
│   │   │   ├── BaseExtractor.ts
│   │   │   ├── ConfigExtractor.ts
│   │   │   ├── GenericExtractor.ts
│   │   │   ├── sites/           # Custom extractors
│   │   │   └── configs/         # Config-driven extractors
│   │   └── index.ts
│   ├── services/
│   │   ├── api.ts               # 🤖 OpenAI integration
│   │   └── supabase.ts          # 💾 Database operations
│   ├── popup/
│   │   └── Popup.tsx            # 🎨 Main UI orchestrator
│   ├── components/
│   │   ├── CartItemsList.tsx    # 🛒 NEW: Display cart items
│   │   ├── RecommendationCard.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── LoadingState.tsx
│   │   └── ErrorBoundary.tsx
│   ├── store/
│   │   └── useStore.ts          # 🔄 Zustand state management
│   ├── utils/
│   │   └── storage.ts           # 🔧 Chrome storage helpers
│   └── types/
│       └── index.ts             # 📝 TypeScript interfaces
├── docs/                        # 📚 Detailed documentation
│   ├── CART_EXTRACTION.md       # How extractors work
│   ├── AI_RECOMMENDATIONS.md    # How OpenAI integration works
│   ├── DATABASE.md              # How Supabase + caching works
│   ├── UI_COMPONENTS.md         # How React UI works
│   └── STORAGE_BUILD.md         # How storage + build works
├── supabase/
│   ├── migrations/              # Database schema
│   └── seed/                    # Sample data
├── dist/                        # 🏗️ Build output (load in Chrome)
├── manifest.json                # Chrome extension config
└── package.json
```

---

## 🎯 Feature Index

### ✅ Implemented Features

| Feature | Description | Deep Dive |
|---------|-------------|-----------|
| **Cart Extraction** | Hybrid Registry Pattern, O(1) lookup, 100+ sites scalable | → `docs/CART_EXTRACTION.md` |
| **AI Recommendations** | OpenAI GPT-3.5 Turbo with prompt engineering | → `docs/AI_RECOMMENDATIONS.md` |
| **Card Database** | Supabase with 1-hour caching, RLS policies | → `docs/DATABASE.md` |
| **UI Components** | React + Zustand state, CartItemsList (NEW) | → `docs/UI_COMPONENTS.md` |
| **Storage & Build** | Chrome storage utilities, Vite build system | → `docs/STORAGE_BUILD.md` |

### 🚧 Planned Features

- [ ] More site extractors (Amazon, Target, Walmart)
- [ ] Admin UI for card management
- [ ] Recommendation history
- [ ] Multi-card comparison view

---

## 🧭 When Working On...

### Adding a New Site Extractor
**Read:** `docs/CART_EXTRACTION.md`
**Files to modify:**
- Config-driven (5 min): `src/content/extractors/configs/simple-sites.config.ts`
- Custom class (20 min): `src/content/extractors/sites/YourSiteExtractor.ts`

### Modifying AI Prompts
**Read:** `docs/AI_RECOMMENDATIONS.md`
**Files to modify:** `src/services/api.ts` (see `buildPrompt()`)

### Adding a UI Component
**Read:** `docs/UI_COMPONENTS.md`
**Files to modify:**
- Create component: `src/components/YourComponent.tsx`
- Add to state: `src/store/useStore.ts`
- Use in popup: `src/popup/Popup.tsx`

### Changing Database Schema
**Read:** `docs/DATABASE.md`
**Files to modify:**
- Migration: `supabase/migrations/00X_your_change.sql`
- Types: `src/types/index.ts`
- Service: `src/services/supabase.ts`

### Configuring Build/Storage
**Read:** `docs/STORAGE_BUILD.md`
**Files to modify:**
- Storage: `src/utils/storage.ts`
- Build: `vite.config.ts`, `manifest.json`

---

## 🔑 Key Types

```typescript
// Cart item from page extraction
interface CartItem {
  name: string;
  price?: string;
  quantity?: number;
}

// Credit card from database
interface CreditCard {
  id: string;
  name: string;
  annualFee: number;
  rewards: Record<string, string>;  // JSONB: {"groceries": "5% cashback"}
  description: string;
  isActive: boolean;
}

// AI recommendation result
interface Recommendation {
  card: string;
  rewards: Record<string, string>;
  merchant: string;
  category: string;
}
```

See `src/types/index.ts` for complete definitions.

---

## ⚡ Quick Commands

```bash
# Development
cd extension-v2/
npm install                 # Install dependencies
npm run build              # Build extension
npm run dev                # Dev mode with watch
npm run lint               # Check code quality

# Testing
node test-supabase.js      # Test Supabase connection

# Loading in Chrome
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select extension-v2/dist/ directory
# 5. Click extension icon to test
```

---

## 🔄 Data Flow Sequence

```
1. User clicks extension icon
   ↓
2. Popup.tsx: Check API key in chrome.storage
   ↓
3. User clicks "Get Recommendation"
   ↓
4. Popup.tsx: Wait for content script (retry loop 5×200ms)
   ↓
5. Content script: window.__CC_extractCartItems()
   → ExtractorRegistry.extractItems(hostname)
   → Returns CartItem[]
   ↓
6. Store cart items: setCartItems(items)
   ↓
7. Fetch cards: cardAPI.getCards()
   → supabase.getActiveCards()
   → Check cache (1-hour TTL)
   → Fetch from Supabase if stale
   ↓
8. Get recommendation: cardAPI.getRecommendation(items, site, apiKey)
   → buildPrompt(items, site, cards)
   → callOpenAI(prompt, apiKey)
   → parseRecommendation(response)
   ↓
9. Display results:
   → setRecommendation(rec)
   → CartItemsList renders (NEW)
   → RecommendationCard renders
   → Create on-page banner
```

---

## 🎨 Component Hierarchy

```
Popup.tsx (orchestrator)
├── ErrorBoundary (error catching)
├── Header (title + settings button)
├── Content (conditional):
│   ├── LoadingState (skeleton/spinner)
│   ├── Error display (red alert)
│   ├── Success state:
│   │   ├── CartItemsList (NEW - display cart items)
│   │   └── RecommendationCard (display recommendation)
│   └── Initial state ("Get Recommendation" button)
└── SettingsModal (overlay for API key)
```

---

## 🗄️ State Management (Zustand)

```typescript
// src/store/useStore.ts
interface AppState {
  // State
  apiKey: string;
  cards: CreditCard[];
  recommendation: Recommendation | null;
  cartItems: CartItem[] | null;        // NEW
  isLoading: boolean;
  error: string | null;
  showSettings: boolean;

  // Actions
  setApiKey(key: string): void;
  setCards(cards: CreditCard[]): void;
  setRecommendation(rec: Recommendation | null): void;
  setCartItems(items: CartItem[] | null): void;  // NEW
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setShowSettings(show: boolean): void;
  reset(): void;
}
```

---

## 💾 Database Schema

```sql
-- Supabase table: credit_cards
CREATE TABLE credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  annual_fee NUMERIC NOT NULL DEFAULT 0,
  rewards JSONB NOT NULL,           -- {"groceries": "5% cashback"}
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_credit_cards_is_active ON credit_cards(is_active);
```

**See:** `docs/DATABASE.md` for complete schema, RLS policies, and caching.

---

## 🚨 Important Reminders

### DO NOT:
- ❌ Manually inject content script with file path (auto-injected by manifest)
- ❌ Use Tailwind CSS v4 (breaks build - use v3.4)
- ❌ Store OpenAI key in .env (users configure via Settings modal)

### ALWAYS:
- ✅ Test on multiple e-commerce sites before deploying
- ✅ Use type-safe storage helpers from `src/utils/storage.ts`
- ✅ Update cache timestamp when storing cards
- ✅ Handle errors gracefully with user-friendly messages

### Critical Details:
- Content script is **auto-injected by manifest** - popup waits via retry loop
- @crxjs plugin bundles `.ts` → `.js` in `dist/assets/`
- Supabase cards cached for 1 hour with fallback on errors
- OpenAI limited to 120 tokens for cost efficiency

---

## 🆕 Recent Changes

**October 2024:**
- ✅ Added `CartItemsList.tsx` component to display extracted cart items
- ✅ Updated Zustand store with `cartItems` state
- ✅ Popup now shows cart items above recommendation card
- ✅ Expandable UI for 6+ items ("Show X more items")
- ✅ Total calculation with partial total support

---

## 📚 Detailed Documentation

For deep dives into specific features, see:

- **`docs/CART_EXTRACTION.md`** - Hybrid Registry Pattern, extractors, adding sites
- **`docs/AI_RECOMMENDATIONS.md`** - OpenAI integration, prompt engineering, parsing
- **`docs/DATABASE.md`** - Supabase schema, caching, RLS policies
- **`docs/UI_COMPONENTS.md`** - React components, state management, CartItemsList
- **`docs/STORAGE_BUILD.md`** - Chrome storage, build system, environment setup

---

## 🔗 Related Files

- **Parent CLAUDE.md:** `/Users/evanliu/Projects/CreditCardAI/root_extension/CLAUDE.md` (project overview)
- **User README:** `README.md` (user-facing documentation)
- **Environment:** `.env.example` (environment variable template)

---

*Last updated: October 2024*
*This is a navigation map - for detailed technical documentation, see the `docs/` directory*
