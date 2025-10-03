# CLAUDE.md - Extension V2

This file provides comprehensive guidance to Claude Code (claude.ai/code) when working with the modernized Chrome Extension (extension-v2).

---

## Project Overview

**Credit Card Recommender Extension V2** is a production-ready Chrome extension built with modern web technologies that provides AI-powered credit card recommendations for online shopping.

### Status: ✅ PRODUCTION-READY (MVP Complete)

**What Works:**
- ✅ React + TypeScript UI with Tailwind CSS styling
- ✅ Supabase database integration with caching
- ✅ OpenAI GPT-3.5 Turbo recommendations
- ✅ Cart extraction from e-commerce sites
- ✅ Settings management (API key storage)
- ✅ On-page recommendation banners
- ✅ Error handling and loading states
- ✅ Build system with Vite + @crxjs/vite-plugin

---

## Architecture

### Tech Stack

```
Frontend:       React 19 + TypeScript 5.8
Build:          Vite 7 + @crxjs/vite-plugin (Manifest V3)
Styling:        Tailwind CSS 3.4
State:          Zustand 5
Data Fetching:  Direct API calls (OpenAI, Supabase)
Database:       Supabase (PostgreSQL)
AI:             OpenAI GPT-3.5 Turbo
Bundle Size:    ~365KB (~108KB gzipped)
```

### Project Structure

```
extension-v2/
├── src/
│   ├── background/
│   │   └── index.ts              # Service worker (lifecycle, message passing)
│   ├── content/
│   │   └── index.ts              # Auto-injected on all pages (cart extraction, banners)
│   ├── popup/
│   │   ├── Popup.tsx             # Main popup component (orchestrator)
│   │   └── index.tsx             # Popup entry point
│   ├── components/
│   │   ├── ErrorBoundary.tsx    # React error boundary
│   │   ├── LoadingState.tsx     # Loading spinner/skeleton
│   │   ├── RecommendationCard.tsx # Displays recommendation
│   │   └── SettingsModal.tsx    # API key configuration
│   ├── services/
│   │   ├── api.ts               # OpenAI API client + prompt building
│   │   └── supabase.ts          # Supabase client + card fetching
│   ├── store/
│   │   └── useStore.ts          # Zustand global state
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── utils/
│   │   ├── storage.ts           # Chrome storage helpers
│   │   └── cartExtraction.ts    # Cart extraction strategies (unused)
│   └── styles/
│       └── globals.css          # Tailwind + custom styles
├── supabase/
│   ├── migrations/
│   │   └── 001_create_credit_cards_table.sql
│   ├── seed/
│   │   └── 001_seed_credit_cards.sql
│   └── SETUP.md                 # Database setup guide
├── api/                         # Optional Node.js backend (not used)
├── public/
│   └── icons/                   # Extension icons
├── dist/                        # Build output (load in Chrome)
├── manifest.json                # Chrome extension manifest
├── .env.example                 # Environment template
└── package.json
```

---

## How It Works - Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER INTERACTION                                              │
│    User clicks extension icon → Popup.tsx renders               │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 2. INITIALIZATION                                                │
│    - Check chrome.storage for API key                           │
│    - Load cached recommendation (if exists)                     │
│    - Display initial state or cached data                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 3. GET RECOMMENDATION BUTTON CLICKED                             │
│    handleGetRecommendation() executes                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 4. CONTENT SCRIPT READY CHECK (Retry Loop)                      │
│    - Wait for window.__CC_extractCartItems to exist            │
│    - Retry up to 5 times × 200ms = 1 second max                │
│    - Throw error if not ready after retries                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 5. EXTRACT CART ITEMS                                           │
│    - chrome.scripting.executeScript() calls:                   │
│      window.__CC_extractCartItems()                            │
│    - Returns: CartItem[] with {name, price?, quantity?}        │
│    - Throws error if empty cart                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 6. FETCH CREDIT CARDS                                           │
│    cardAPI.getCards() from services/api.ts                     │
│    └─→ getActiveCards() from services/supabase.ts             │
│        ├─ Check cache (chrome.storage)                         │
│        │  └─ TTL: 1 hour (3600000ms)                          │
│        ├─ If stale/missing: Fetch from Supabase               │
│        │  SELECT * FROM credit_cards                          │
│        │  WHERE is_active = TRUE                              │
│        │  ORDER BY name                                       │
│        └─ Fallback to cached cards on network error           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 7. BUILD LLM PROMPT                                             │
│    buildPrompt(cartItems, site, cards)                         │
│    Combines:                                                    │
│    - Cart items (extracted from page)                          │
│    - Site URL (current tab)                                    │
│    - Available cards (from Supabase)                           │
│    Returns: Formatted prompt string                            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 8. CALL OPENAI API                                              │
│    POST https://api.openai.com/v1/chat/completions             │
│    {                                                            │
│      model: "gpt-3.5-turbo",                                   │
│      messages: [{role: "user", content: prompt}],              │
│      max_tokens: 120,                                          │
│      temperature: 0.7                                          │
│    }                                                            │
│    Returns: JSON response text                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 9. PARSE RESPONSE                                               │
│    - Strip markdown code blocks (```json ... ```)              │
│    - JSON.parse() to extract:                                  │
│      {                                                          │
│        card: string,                                           │
│        rewards: {category: reward, ...},                       │
│        merchant: string,                                       │
│        category: string                                        │
│      }                                                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│ 10. DISPLAY RESULTS                                             │
│     - Update Zustand store: setRecommendation(rec)             │
│     - RecommendationCard.tsx renders in popup                  │
│     - Create on-page banner:                                   │
│       chrome.scripting.executeScript() calls:                  │
│       window.__CC_createBanner(html)                           │
│     - Banner appears top-right with close button               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Components Deep Dive

### 1. Popup.tsx (Main Orchestrator)

**Location:** `src/popup/Popup.tsx`

**Responsibilities:**
- Orchestrates the entire recommendation flow
- Manages UI state (loading, error, recommendation)
- Handles API key validation
- Triggers cart extraction and LLM calls
- Creates on-page banners

**Key Function: handleGetRecommendation()**

```typescript
const handleGetRecommendation = async () => {
  setLoading(true);

  // 1. Get API key from chrome.storage
  const apiKey = await getOpenAIKey();

  // 2. Get active tab
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});

  // 3. Wait for content script (retry loop - up to 5 tries)
  let retries = 0;
  while (retries < 5) {
    const ready = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__CC_extractCartItems === 'function'
    });
    if (ready[0]?.result) break;
    await sleep(200ms);
    retries++;
  }

  // 4. Extract cart items
  const cartItems = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__CC_extractCartItems()
  });

  // 5. Get recommendation from API
  const rec = await cardAPI.getRecommendation(cartItems, site, apiKey);

  // 6. Display in popup + create banner
  setRecommendation(rec);
  createBannerOnPage(rec);
};
```

### 2. Content Script (Auto-Injected)

**Location:** `src/content/index.ts`

**Manifest Configuration:**
```json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["src/content/index.ts"]
  }]
}
```

**IMPORTANT:** Content script is **auto-injected** by manifest. DO NOT manually inject via `chrome.scripting.executeScript()` with file path.

**Exposed Global Functions:**

1. **window.__CC_extractCartItems()**
   - Extracts cart items from page DOM
   - Uses 4 strategies:
     - Cart containers (id/class="cart", "basket", etc.)
     - Checkout pages (order summaries)
     - Product pages (single item)
     - Fallback (elements with price patterns)
   - Returns: `CartItem[]`

2. **window.__CC_createBanner(html: string)**
   - Creates fixed-position banner (top-right)
   - Animated slide-in
   - Close button (×)
   - Stores in chrome.storage for persistence

3. **window.buildLLMPrompt()** (Deprecated - now in api.ts)
4. **window.callOpenAIChat()** (Deprecated - now in api.ts)

### 3. API Service Layer

**Location:** `src/services/api.ts`

**Class: CardAPIClient**

```typescript
class CardAPIClient {
  async getCards(): Promise<CreditCard[]>
  async getRecommendation(cartItems, site, apiKey): Promise<Recommendation>
  private buildPrompt(cartItems, site, cards): string
  private callOpenAI(prompt, apiKey): Promise<string>
  private parseRecommendation(llmResponse): Recommendation
}
```

**Key Implementation Details:**

1. **USE_BACKEND_API Flag**
   - Default: `false` (direct Supabase + OpenAI)
   - Set to `true` to use Node.js backend (see `api/server.js`)

2. **Prompt Engineering**
   ```
   You are a helpful assistant that recommends credit cards.

   Cart items: [list]
   Website: example.com
   Available cards: [with rewards]

   Infer merchant category, recommend best card.

   Respond ONLY with JSON (no markdown):
   {
     "card": "Card Name",
     "rewards": {"category": "reward"},
     "merchant": "website",
     "category": "inferred category"
   }
   ```

3. **Response Parsing**
   - Strips markdown code blocks (```json ... ```)
   - Validates required fields
   - Throws descriptive errors

### 4. Supabase Service

**Location:** `src/services/supabase.ts`

**Key Function: getActiveCards()**

```typescript
async function getActiveCards(forceRefresh = false): Promise<CreditCard[]> {
  // 1. Check cache (unless forceRefresh)
  if (!forceRefresh && !await areCachedCardsStale()) {
    return await getCachedCards();
  }

  // 2. Fetch from Supabase
  const { data } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('is_active', true)
    .order('name');

  // 3. Transform snake_case → camelCase
  const cards = data.map(card => ({
    id: card.id,
    name: card.name,
    annualFee: card.annual_fee,  // Transform
    rewards: card.rewards,
    description: card.description,
    isActive: card.is_active     // Transform
  }));

  // 4. Cache results (1 hour TTL)
  await setCachedCards(cards);

  return cards;
}
```

**Cache Strategy:**
- TTL: 1 hour (3600000ms)
- Stored in: `chrome.storage.local`
- Keys: `cachedCards`, `lastCardsFetch`
- Fallback: Returns cached cards on network error

### 5. Storage Utilities

**Location:** `src/utils/storage.ts`

**Type-Safe Storage API:**

```typescript
// Generic storage with TypeScript types
async function getFromStorage<K extends keyof StorageData>(key: K)
async function setInStorage<K extends keyof StorageData>(key: K, value: StorageData[K])

// Specific helpers
async function getOpenAIKey(): Promise<string>
async function setOpenAIKey(key: string): Promise<void>
async function getCachedCards(): Promise<CreditCard[]>
async function setCachedCards(cards: CreditCard[]): Promise<void>
async function areCachedCardsStale(): Promise<boolean>

// Validation
function validateOpenAIKey(key: string): boolean  // Must start with "sk-"

// Advanced
async function getAllStorageData(): Promise<StorageData>
async function getStorageInfo(): Promise<{bytesInUse, quotaBytes, percentUsed}>
async function exportSettings(): Promise<string>
async function importSettings(json: string): Promise<void>
async function clearAllStorage(): Promise<void>
```

### 6. State Management (Zustand)

**Location:** `src/store/useStore.ts`

```typescript
interface AppState {
  // State
  apiKey: string;
  cards: CreditCard[];
  recommendation: Recommendation | null;
  isLoading: boolean;
  error: string | null;
  showSettings: boolean;

  // Actions
  setApiKey: (key: string) => void;
  setCards: (cards: CreditCard[]) => void;
  setRecommendation: (rec: Recommendation | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setShowSettings: (show: boolean) => void;
  reset: () => void;
}
```

**Usage:**
```typescript
const { recommendation, setRecommendation } = useStore();
```

---

## Database Schema

### Table: `credit_cards`

```sql
CREATE TABLE credit_cards (
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

**Sample Record:**
```json
{
  "id": "uuid",
  "name": "Chase Freedom Flex",
  "annual_fee": 0,
  "rewards": {
    "groceries": "5% cashback",
    "entertainment": "3% cashback",
    "online": "5% cashback",
    "travel": "5% cashback (rotating)",
    "all": "1% cashback"
  },
  "description": "Great for rotating 5% categories...",
  "is_active": true,
  "created_at": "2024-10-01T...",
  "updated_at": "2024-10-01T..."
}
```

**Indexes:**
- `idx_credit_cards_is_active` on `is_active`

**RLS Policies:**
- Public read access to active cards
- (Optional) Authenticated write access for admin

---

## Build & Development

### Development Workflow

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Load in Chrome
# 1. chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select dist/
```

### Build Output (`dist/`)

```
dist/
├── manifest.json                    # Generated manifest
├── assets/
│   ├── index.ts-BQeXNPZ1.js        # Content script bundle
│   ├── popup-BYjKH-3r.js           # Popup bundle
│   └── popup-xcMwP_k_.css          # Styles
├── src/
│   ├── background/
│   │   └── index.ts.js             # Background worker
│   └── popup/
│       └── index.html              # Popup HTML
├── icons/                           # Extension icons
└── service-worker-loader.js
```

### Environment Variables

**Required in `.env`:**
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Not in .env (user configures via UI):**
- OpenAI API Key → Stored in chrome.storage

### TypeScript Configuration

**Important Settings in `tsconfig.app.json`:**
```json
{
  "types": ["vite/client", "chrome"],  // Chrome API types
  "verbatimModuleSyntax": false,       // Allow React imports
  "noUnusedLocals": false,             // Relax for development
  "noUnusedParameters": false
}
```

### Tailwind CSS Version

**Using Tailwind v3.4** (not v4)
- Reason: v4 has PostCSS compatibility issues with @crxjs/vite-plugin
- v3 is stable and works perfectly

---

## Testing

### Manual Testing Checklist

**Basic Functionality:**
- [ ] Extension loads without errors
- [ ] Settings modal opens/closes
- [ ] API key saves and persists
- [ ] Supabase fetches cards
- [ ] Cart extraction works
- [ ] Recommendation displays in popup
- [ ] Banner appears on page
- [ ] Close button removes banner

**Error Handling:**
- [ ] Missing API key shows error
- [ ] Invalid API key format detected
- [ ] Empty cart shows error message
- [ ] Network errors handled gracefully
- [ ] Content script not ready retries

**E-commerce Site Testing:**
- [x] Sephora (confirmed working)
- [ ] Amazon
- [ ] Target
- [ ] Walmart
- [ ] Best Buy
- [ ] Generic checkout pages

### Debug Tools

**Popup Console:**
```
Right-click extension icon → Inspect popup
```

**Page Console:**
```
F12 → Console → Run:
window.__CC_extractCartItems()
```

**Storage Inspection:**
```typescript
import { getAllStorageData } from './utils/storage';
const data = await getAllStorageData();
console.log(data);
```

---

## Known Issues & Limitations

### Current Limitations

1. **Cart Extraction Accuracy**
   - Works well on standard e-commerce sites
   - May miss items on custom/complex layouts
   - No support for AJAX-loaded carts (SPA navigation)

2. **LLM Response Quality**
   - Limited to 120 tokens (budget constraint)
   - Sometimes returns markdown despite instructions
   - May hallucinate card names not in database

3. **Caching**
   - 1-hour TTL may be too long for frequent updates
   - No cache invalidation mechanism
   - No indication to user when using cached data

4. **Error Recovery**
   - Retry logic exists but limited (5 tries × 200ms)
   - No exponential backoff
   - No user-triggered retry without page refresh

5. **Security**
   - API keys stored in plain text (chrome.storage)
   - No encryption at rest
   - All API calls visible in DevTools

6. **Performance**
   - Bundle size could be optimized (~365KB)
   - No code splitting
   - No lazy loading of components

7. **User Experience**
   - No loading progress indicator (just spinner)
   - No card comparison feature
   - No recommendation history
   - No user preferences/favorites

### Critical Bugs

**None currently identified** ✅

### Warnings

- Content script must be ready before extraction (retry loop handles this)
- Tailwind v4 breaks build (use v3 only)
- DO NOT manually inject content script `.ts` files

---

## Next Steps & Roadmap

### Phase 1: Core Improvements (High Priority)

#### 1.1 Enhanced Cart Extraction
**Goal:** Improve accuracy across more e-commerce platforms

**Tasks:**
- [ ] Add site-specific extractors (Amazon, Target, Walmart, etc.)
- [ ] Implement MutationObserver for AJAX cart updates
- [ ] Add confidence scoring to extracted items
- [ ] Create test suite with mock e-commerce pages
- [ ] Add visual feedback showing extracted items in popup

**Files to modify:**
- `src/content/index.ts` - Add site-specific strategies
- `src/types/index.ts` - Add confidence score to CartItem

#### 1.2 Better Error Handling
**Goal:** Graceful degradation and user-friendly error messages

**Tasks:**
- [ ] Implement exponential backoff for retries
- [ ] Add user-triggered retry buttons (don't require page refresh)
- [ ] Create ErrorCard component with actionable suggestions
- [ ] Add offline detection and fallback to cached recommendations
- [ ] Log errors to chrome.storage for debugging

**Files to create/modify:**
- `src/components/ErrorCard.tsx` - New component
- `src/services/api.ts` - Add exponential backoff
- `src/utils/retry.ts` - Retry logic utility

#### 1.3 Loading States & Feedback
**Goal:** Better UX during async operations

**Tasks:**
- [ ] Add progress steps (Extracting → Fetching cards → Getting recommendation)
- [ ] Show extracted cart items before recommendation
- [ ] Add skeleton loader that matches RecommendationCard
- [ ] Implement toast notifications for success/errors
- [ ] Add animation for recommendation reveal

**Files to modify:**
- `src/components/LoadingState.tsx` - Multi-step progress
- `src/components/Toast.tsx` - New component
- `src/popup/Popup.tsx` - Integrate progress steps

---

### Phase 2: Card Management (Medium Priority)

#### 2.1 Admin Interface for Card Management
**Goal:** Allow adding/editing/removing cards without SQL

**Tasks:**
- [ ] Create admin popup page (separate from main popup)
- [ ] Build CardManager component with CRUD operations
- [ ] Implement Supabase auth for admin access
- [ ] Add card image upload (store in Supabase Storage)
- [ ] Create card validation (required fields, reward format)
- [ ] Add bulk import from CSV/JSON

**Files to create:**
- `src/admin/` - New directory for admin UI
  - `AdminPopup.tsx` - Main admin interface
  - `CardEditor.tsx` - Form for editing cards
  - `CardList.tsx` - Table of all cards
- `manifest.json` - Add admin page entry
- `src/services/supabase.ts` - Add write operations

**Supabase Changes:**
- Enable authentication
- Update RLS policies for admin writes
- Create admin role

#### 2.2 Card Categories & Tags
**Goal:** Better organization and filtering of cards

**Tasks:**
- [ ] Add categories field to database (Premium, No-Fee, Business, etc.)
- [ ] Add tags array (Travel, Cashback, Points, etc.)
- [ ] Implement filtering in recommendation logic
- [ ] Show category badges in UI
- [ ] Allow users to filter by category in settings

**Database migration:**
```sql
ALTER TABLE credit_cards ADD COLUMN categories TEXT[];
ALTER TABLE credit_cards ADD COLUMN tags TEXT[];
```

---

### Phase 3: Advanced Features (Low Priority)

#### 3.1 Recommendation History
**Goal:** Track and display past recommendations

**Tasks:**
- [ ] Create recommendations table in Supabase
- [ ] Store each recommendation with timestamp, site, cart
- [ ] Build History tab in popup
- [ ] Add analytics dashboard (most recommended card, etc.)
- [ ] Export history as CSV

**Database schema:**
```sql
CREATE TABLE recommendations (
  id UUID PRIMARY KEY,
  card_id UUID REFERENCES credit_cards(id),
  merchant TEXT,
  category TEXT,
  cart_items JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3.2 User Preferences & Favorites
**Goal:** Personalize recommendations

**Tasks:**
- [ ] Add user preferences (prefer cashback vs points)
- [ ] Implement favorite cards feature
- [ ] Exclude cards user doesn't have
- [ ] Annual fee tolerance setting
- [ ] Card application links in recommendations

**Storage schema:**
```typescript
interface UserPreferences {
  favoriteCards: string[];        // Card IDs
  excludedCards: string[];        // Card IDs
  preferCashback: boolean;
  maxAnnualFee: number;
  onlyCardsIOwn: boolean;
}
```

#### 3.3 Multi-Card Comparison
**Goal:** Show top 3 recommendations instead of just 1

**Tasks:**
- [ ] Modify LLM prompt to return top 3 cards
- [ ] Create ComparisonView component
- [ ] Add side-by-side card comparison
- [ ] Highlight best category for each card
- [ ] Calculate total rewards for cart across cards

**UI Changes:**
- `src/components/ComparisonView.tsx` - New component
- `src/popup/Popup.tsx` - Toggle between single/comparison view

#### 3.4 Browser Extension Features
**Goal:** Full Chrome extension capabilities

**Tasks:**
- [ ] Context menu integration (right-click → "Get card recommendation")
- [ ] Browser action badge with cart item count
- [ ] Automatic recommendations (trigger on cart page load)
- [ ] Keyboard shortcuts (Alt+C for recommendation)
- [ ] Omnibox integration (type "card" in address bar)

**Manifest changes:**
```json
{
  "commands": {
    "get-recommendation": {
      "suggested_key": {"default": "Alt+C"},
      "description": "Get card recommendation"
    }
  },
  "omnibox": {
    "keyword": "card"
  }
}
```

---

### Phase 4: Performance & Optimization (Ongoing)

#### 4.1 Bundle Size Optimization
**Goal:** Reduce from 365KB to <200KB

**Tasks:**
- [ ] Implement code splitting with React.lazy()
- [ ] Tree shake unused Tailwind classes
- [ ] Replace Zustand with lighter state solution
- [ ] Remove unused dependencies
- [ ] Minify and compress assets
- [ ] Use dynamic imports for heavy components

**Target:**
- Current: ~365KB (~108KB gzipped)
- Goal: <200KB (<70KB gzipped)

#### 4.2 Caching Improvements
**Goal:** Smarter caching strategy

**Tasks:**
- [ ] Implement cache versioning
- [ ] Add manual cache refresh button
- [ ] Show cache age to user ("Cards fetched 30 min ago")
- [ ] Implement background cache refresh
- [ ] Add IndexedDB for larger cache storage
- [ ] Cache recommendations per site

#### 4.3 API Rate Limiting
**Goal:** Prevent excessive API calls

**Tasks:**
- [ ] Implement request throttling
- [ ] Add rate limit indicators in UI
- [ ] Queue recommendations if rapid clicks
- [ ] Show OpenAI usage stats
- [ ] Estimate API costs per month

---

### Phase 5: Testing & Quality Assurance

#### 5.1 Automated Testing
**Goal:** Test coverage >80%

**Tasks:**
- [ ] Set up Vitest for unit tests
- [ ] Test utilities (storage, cartExtraction)
- [ ] Test components (RecommendationCard, SettingsModal)
- [ ] Test services (api, supabase)
- [ ] Mock Chrome APIs for testing
- [ ] Set up CI/CD with GitHub Actions

**Files to create:**
- `src/**/*.test.ts` - Unit tests
- `vitest.config.ts` - Vitest configuration
- `.github/workflows/test.yml` - CI pipeline

#### 5.2 E2E Testing
**Goal:** Automated browser testing

**Tasks:**
- [ ] Set up Playwright
- [ ] Test extension loading
- [ ] Test recommendation flow end-to-end
- [ ] Test settings modal
- [ ] Test error states
- [ ] Test multiple e-commerce sites

#### 5.3 Performance Testing
**Goal:** Measure and optimize performance

**Tasks:**
- [ ] Add performance.mark() calls
- [ ] Measure time-to-recommendation
- [ ] Profile bundle loading time
- [ ] Test on slow networks (3G simulation)
- [ ] Memory leak detection

---

### Phase 6: Chrome Web Store Publishing

#### 6.1 Pre-Publishing Checklist
**Goal:** Prepare for public release

**Tasks:**
- [ ] Create high-quality screenshots (1280×800)
- [ ] Write compelling store description
- [ ] Create promotional graphics
- [ ] Prepare privacy policy document
- [ ] Test on multiple Chrome versions
- [ ] Test on Chromium browsers (Edge, Brave)
- [ ] Remove console.logs from production build
- [ ] Add analytics (respecting privacy)

#### 6.2 Store Listing Requirements
**Goal:** Meet Chrome Web Store requirements

**Tasks:**
- [ ] Create 128×128, 48×48, 16×16 icons (production quality)
- [ ] Write detailed description (132 char summary + full description)
- [ ] Add 5 screenshots showing key features
- [ ] Create 1400×560 promo tile
- [ ] Select correct category (Productivity / Shopping)
- [ ] Add support email
- [ ] Set up website/landing page

#### 6.3 Privacy & Security
**Goal:** Comply with Chrome Web Store policies

**Tasks:**
- [ ] Write comprehensive privacy policy
- [ ] Declare all permissions used and why
- [ ] Add consent for data collection (if any)
- [ ] Implement secure API key storage (consider encryption)
- [ ] Remove unnecessary permissions
- [ ] Add terms of service

**Privacy Policy must cover:**
- What data is collected (API keys, recommendations)
- Where data is stored (chrome.storage.local, Supabase)
- How data is used (recommendations only)
- Third-party services (OpenAI, Supabase)
- Data retention policy

---

### Phase 7: Advanced Analytics & Insights

#### 7.1 Recommendation Analytics
**Goal:** Understand usage patterns

**Tasks:**
- [ ] Track recommendation accuracy (user feedback)
- [ ] Most recommended cards dashboard
- [ ] Popular merchant categories
- [ ] Average cart values by category
- [ ] Peak usage times

**Dashboard metrics:**
- Total recommendations generated
- Top 5 recommended cards
- Most common categories
- Success rate (user accepted recommendation)

#### 7.2 User Feedback System
**Goal:** Improve recommendations over time

**Tasks:**
- [ ] Add thumbs up/down for recommendations
- [ ] "Was this helpful?" prompt
- [ ] Feedback form for incorrect recommendations
- [ ] Send feedback to database for analysis
- [ ] Use feedback to tune prompts

**UI additions:**
- `src/components/FeedbackWidget.tsx`
- Rating stars or thumbs up/down
- Optional comment field

---

### Phase 8: Mobile & Cross-Platform

#### 8.1 Firefox Extension
**Goal:** Port to Firefox

**Tasks:**
- [ ] Test with Firefox Manifest V3
- [ ] Replace Chrome-specific APIs with WebExtensions
- [ ] Test on Firefox Developer Edition
- [ ] Submit to Firefox Add-ons store

#### 8.2 Mobile Support
**Goal:** Mobile browser extensions (Kiwi, Firefox Mobile)

**Tasks:**
- [ ] Test on Kiwi Browser (Android)
- [ ] Optimize UI for small screens
- [ ] Touch-friendly buttons and interactions
- [ ] Test cart extraction on mobile sites

---

## Development Guidelines

### Code Style

**TypeScript:**
- Use explicit types (no `any`)
- Use interfaces for complex types
- Export types from `src/types/index.ts`

**React:**
- Functional components only
- Use hooks (useState, useEffect, custom hooks)
- Prop types as interfaces
- Default exports for components

**Naming Conventions:**
- Components: PascalCase (e.g., `RecommendationCard.tsx`)
- Files: camelCase for utils, PascalCase for components
- Functions: camelCase (e.g., `getActiveCards`)
- Constants: UPPER_SNAKE_CASE (e.g., `USE_BACKEND_API`)

### File Organization

```
src/
├── components/      # Reusable UI components
├── popup/           # Popup-specific components
├── content/         # Content script code
├── background/      # Background worker code
├── services/        # External API clients
├── utils/           # Pure utility functions
├── store/           # State management
├── types/           # TypeScript types
└── styles/          # Global CSS
```

### Git Workflow

**Branches:**
- `main` - Production-ready code
- `dev` - Development branch
- `feature/xxx` - Feature branches

**Commits:**
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Example: `feat: add multi-card comparison view`

---

## Troubleshooting Guide

### Build Issues

**Problem:** `rm -rf node_modules/.tmp && npm run build` fails
**Solution:**
```bash
rm -rf node_modules/.tmp
rm -rf dist
npm run build
```

**Problem:** TypeScript errors about Chrome APIs
**Solution:** Ensure `@types/chrome` is installed and in `tsconfig.app.json`:
```json
{
  "types": ["vite/client", "chrome"]
}
```

### Runtime Issues

**Problem:** "Content script not loaded" error
**Solution:**
- Refresh the page (F5)
- Content script needs time to inject
- Retry loop should handle this automatically

**Problem:** "No cart items found"
**Solution:**
- Navigate to cart/checkout page
- Open DevTools console, run: `window.__CC_extractCartItems()`
- Check if items are actually in DOM

**Problem:** Supabase connection fails
**Solution:**
```bash
node test-supabase.js  # Test connection
# Check .env has correct URL and key
```

**Problem:** Extension won't load in Chrome
**Solution:**
- Load `dist/` directory, not project root
- Check `chrome://extensions/` for errors
- Click Details → Errors for specific issues

### Debugging

**Enable content script logging:**
```typescript
// src/content/index.ts
const DEBUG_MODE = true;  // Set to true
```

**View all storage:**
```javascript
chrome.storage.local.get(null, (data) => console.log(data));
```

**Clear all storage:**
```javascript
chrome.storage.local.clear();
```

---

## Important Reminders

### DO NOT:
- ❌ Manually inject content script with file path (use manifest)
- ❌ Use Tailwind CSS v4 (breaks build)
- ❌ Store OpenAI key in .env (use chrome.storage)
- ❌ Commit .env file to git
- ❌ Use `any` type in TypeScript
- ❌ Create new files without explicit requirement

### ALWAYS:
- ✅ Test on multiple e-commerce sites before deploying
- ✅ Validate API keys before storing
- ✅ Handle errors gracefully with user-friendly messages
- ✅ Update cache timestamp when storing cards
- ✅ Log important operations for debugging
- ✅ Use type-safe storage helpers
- ✅ Prefer editing existing files over creating new ones

---

## Quick Reference

### Useful Commands

```bash
# Development
npm install              # Install dependencies
npm run build           # Build extension
npm run dev             # Dev mode (watch)
npm run lint            # Check code quality

# Testing
node test-supabase.js   # Test Supabase connection

# Debugging
chrome://extensions/    # Extension management
# Right-click icon → Inspect popup (popup console)
# F12 on page (content script console)
```

### Key Files

```
manifest.json           # Extension configuration
src/popup/Popup.tsx     # Main UI orchestrator
src/content/index.ts    # Cart extraction + banners
src/services/api.ts     # OpenAI + prompt building
src/services/supabase.ts # Database operations
src/utils/storage.ts    # Chrome storage helpers
src/types/index.ts      # TypeScript interfaces
```

### Chrome APIs Used

```typescript
chrome.storage.local    # Persistent storage
chrome.tabs.query       # Get active tab
chrome.scripting.executeScript  # Run code in page
chrome.runtime.sendMessage      # Message passing
chrome.runtime.onInstalled      # Extension lifecycle
```

---

## Resources

**Documentation:**
- [Chrome Extensions](https://developer.chrome.com/docs/extensions/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
- [Supabase Docs](https://supabase.com/docs)
- [OpenAI API](https://platform.openai.com/docs)

**Tools:**
- [Chrome Extensions Samples](https://github.com/GoogleChrome/chrome-extensions-samples)
- [Extension Boilerplates](https://github.com/crxjs/chrome-extension-tools)

---

## Changelog

**v2.0.0 (Current)** - Oct 2024
- ✅ React + TypeScript migration complete
- ✅ Supabase database integration
- ✅ Modern build system with Vite
- ✅ Tailwind CSS styling
- ✅ Zustand state management
- ✅ Smart caching with 1-hour TTL
- ✅ Error boundaries and loading states
- ✅ Settings modal with API key management

**v1.0.0** - Previous version
- Vanilla JavaScript implementation
- 3 hardcoded cards
- Basic popup UI
- No database (cards.json)

---

## License

MIT

---

## Contact & Support

**Repository:** `/Users/evanliu/Projects/CreditCardAI/root_extension/extension-v2/`

**Parent Project:** `/Users/evanliu/Projects/CreditCardAI/`

**Related Files:**
- `/root_extension/CLAUDE.md` - Original planning document
- `/extension-v2/README.md` - User-facing documentation
- `/extension-v2/supabase/SETUP.md` - Database setup guide

---

*This document is maintained for Claude Code. Last updated: Oct 2024*
