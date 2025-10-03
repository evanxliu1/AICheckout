# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Checkout Chrome Extension** - An AI-powered credit card recommendation system that analyzes shopping cart contents and suggests the optimal credit card for maximizing rewards.

**Current Status:** ✅ Production-ready MVP (extension-v2/)

## Repository Structure

```
/Users/evanliu/Projects/CreditCardAI/
├── root_extension/              # This directory
│   ├── extension/              # ⚠️ LEGACY - Vanilla JS v1 (archived, not actively developed)
│   ├── extension-v2/           # ✅ CURRENT - Modern React/TypeScript implementation
│   └── CLAUDE.md               # This file
├── simulation/                  # Node.js/Express simulation app for testing
└── README.md
```

### Active Development: extension-v2/

**Location:** `/Users/evanliu/Projects/CreditCardAI/root_extension/extension-v2/`

**Tech Stack:**
- **Frontend:** React 19 + TypeScript 5.8
- **Build System:** Vite 7 + @crxjs/vite-plugin (Chrome Extension Manifest V3)
- **Styling:** Tailwind CSS 3.4
- **State Management:** Zustand 5
- **Database:** Supabase (PostgreSQL with caching)
- **AI:** OpenAI GPT-3.5 Turbo
- **Bundle Size:** ~365KB (~108KB gzipped)

### Legacy Code: extension/

**⚠️ ARCHIVED - NOT ACTIVELY MAINTAINED**

The `extension/` directory contains the original vanilla JavaScript proof-of-concept with:
- 3 hardcoded cards in `cards.json`
- Manual DOM manipulation
- Inline styles
- No database integration

**This code is kept for reference only.** All new development should happen in `extension-v2/`.

## How It Works (High-Level)

```
User shops online → Clicks extension icon → Extension extracts cart items from page
                                           ↓
                         Fetches credit cards from Supabase (cached 1 hour)
                                           ↓
                    Sends cart + cards to OpenAI GPT-3.5 Turbo for analysis
                                           ↓
                  Displays recommendation in popup + on-page banner
```

## Key Architecture Components (extension-v2/)

### 1. **Content Script** (`src/content/index.ts`)
- Auto-injected on all web pages via manifest
- **Hybrid Registry Pattern** for cart extraction (O(1) lookup, scalable to 100+ sites)
  - `ExtractorRegistry` - Central registry managing site-specific extractors
  - `BaseExtractor` - Abstract class with helper methods
  - `SephoraExtractor` - Custom extractor for Sephora (tested ✅)
  - `ConfigExtractor` - Config-driven extractors (5 min to add new site)
  - `GenericExtractor` - Universal fallback for unknown sites
- Exposes global functions:
  - `window.__CC_extractCartItems()` - Extract cart from current page
  - `window.__CC_createBanner(html)` - Display recommendation banner
  - `window.__CC_getRegistryInfo()` - Debug: registry information

### 2. **Popup UI** (`src/popup/Popup.tsx`)
- React-based extension popup
- Orchestrates recommendation flow:
  1. Check for API key in chrome.storage
  2. Wait for content script to be ready (retry loop)
  3. Extract cart items via content script
  4. Fetch cards from Supabase (with caching)
  5. Build LLM prompt and call OpenAI
  6. Display recommendation in UI + create on-page banner
- Components:
  - `RecommendationCard` - Displays card suggestion
  - `SettingsModal` - API key management
  - `LoadingState` - Skeleton loader
  - `ErrorBoundary` - Error handling

### 3. **API Services**
- **`src/services/supabase.ts`** - Database operations with 1-hour TTL caching
- **`src/services/api.ts`** - OpenAI integration and prompt engineering

### 4. **Storage Utilities** (`src/utils/storage.ts`)
- Type-safe Chrome storage helpers
- Manages API keys, card cache, recommendations

### 5. **Background Service Worker** (`src/background/index.ts`)
- Minimal lifecycle management
- Message passing between components

## Database Schema

**Supabase Table:** `credit_cards`

```sql
CREATE TABLE credit_cards (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  annual_fee NUMERIC DEFAULT 0,
  rewards JSONB NOT NULL,        -- {"groceries": "5% cashback", ...}
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Caching Strategy:**
- Cards cached in chrome.storage.local for 1 hour
- Fallback to cache on network errors
- Manual refresh available

## Development (extension-v2/)

### Quick Start

```bash
cd extension-v2/

# Install dependencies
npm install

# Build extension
npm run build

# Load in Chrome
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select extension-v2/dist/ directory
```

### Environment Setup

Create `.env` in `extension-v2/`:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Note:** OpenAI API key is NOT in .env - users configure it via the extension's Settings modal.

### File Structure

```
extension-v2/
├── src/
│   ├── background/          # Service worker
│   ├── content/             # Content script + cart extractors
│   │   ├── extractors/      # Hybrid Registry Pattern
│   │   │   ├── ExtractorRegistry.ts
│   │   │   ├── BaseExtractor.ts
│   │   │   ├── ConfigExtractor.ts
│   │   │   ├── GenericExtractor.ts
│   │   │   ├── sites/       # Custom extractors (Sephora, etc.)
│   │   │   └── configs/     # Config-driven sites
│   │   └── index.ts
│   ├── popup/               # React popup UI
│   ├── components/          # Reusable components
│   ├── services/            # API clients (Supabase, OpenAI)
│   ├── store/               # Zustand state management
│   ├── types/               # TypeScript interfaces
│   └── utils/               # Helper functions
├── supabase/                # Database migrations & seeds
├── dist/                    # Build output (load this in Chrome)
├── manifest.json            # Chrome extension manifest
├── CLAUDE.md                # Detailed documentation
├── SITE_EXTRACTORS.md       # Cart extractor implementation guide
└── README.md                # User-facing documentation
```

---

## Features Implemented ✅

### Core Functionality
- ✅ **Chrome Extension (Manifest V3)** - Modern React/TypeScript architecture
- ✅ **Supabase Integration** - Dynamic card database with 1-hour caching
- ✅ **OpenAI GPT-3.5 Turbo** - AI-powered recommendations
- ✅ **Settings Management** - Secure API key storage in chrome.storage
- ✅ **On-Page Banners** - Recommendation display with animations
- ✅ **Error Handling** - Graceful fallbacks and user-friendly errors
- ✅ **Loading States** - Skeleton loaders and progress indicators

### Cart Extraction (Hybrid Registry Pattern) ✅
- ✅ **ExtractorRegistry** - O(1) site lookup, scalable to 100+ sites
- ✅ **BaseExtractor** - Abstract class with DRY helper methods
- ✅ **ConfigExtractor** - Config-driven extractors (5 min to add new site)
- ✅ **GenericExtractor** - Universal fallback for unknown sites
- ✅ **SephoraExtractor** - First custom implementation (tested & working)
- ✅ **Comprehensive Documentation** - SITE_EXTRACTORS.md guide

### Build & Development
- ✅ **Vite 7 Build System** - Fast builds with HMR
- ✅ **@crxjs/vite-plugin** - Chrome Extension bundling
- ✅ **TypeScript 5.8** - Full type safety
- ✅ **Tailwind CSS 3.4** - Modern styling
- ✅ **Bundle Optimization** - ~365KB (~108KB gzipped)

---

## What's Next - Development Roadmap

### Phase 1: Core Improvements (High Priority)

#### 1. Enhanced Cart Extraction
- [ ] Add extractors for major e-commerce sites:
  - Amazon (custom class - complex DOM)
  - Target (config or custom)
  - Walmart (config or custom)
  - Best Buy (config)
  - Ulta (config - placeholder exists)
  - eBay (custom)
  - Etsy (custom)
- [ ] Implement MutationObserver for AJAX cart updates (SPA support)
- [ ] Add confidence scoring to extracted items
- [ ] Create test suite with mock e-commerce pages
- [ ] Add visual feedback showing extracted items in popup

#### 2. Better Error Handling
- [ ] Implement exponential backoff for retries
- [ ] Add user-triggered retry buttons (no page refresh needed)
- [ ] Create ErrorCard component with actionable suggestions
- [ ] Add offline detection with cached recommendation fallback
- [ ] Log errors to chrome.storage for debugging

#### 3. Loading States & Feedback
- [ ] Multi-step progress (Extracting → Fetching → Analyzing)
- [ ] Show extracted cart items before recommendation
- [ ] Enhanced skeleton loader matching RecommendationCard
- [ ] Toast notifications for success/errors
- [ ] Smooth animation for recommendation reveal

### Phase 2: Card Management (Medium Priority)
- [ ] Admin interface for card CRUD operations
- [ ] Card categories & tags (Premium, No-Fee, Travel, etc.)
- [ ] Bulk import from CSV/JSON
- [ ] Card image upload to Supabase Storage

### Phase 3: Advanced Features (Low Priority)
- [ ] Recommendation history tracking
- [ ] User preferences (cashback vs points, max annual fee)
- [ ] Favorite cards feature
- [ ] Multi-card comparison view (top 3 recommendations)
- [ ] Context menu integration
- [ ] Keyboard shortcuts (Alt+C)

### Phase 4: Performance & Optimization (Ongoing)
- [ ] Bundle size optimization (<200KB target)
- [ ] Code splitting with React.lazy()
- [ ] Implement cache versioning
- [ ] API rate limiting
- [ ] Performance monitoring

### Phase 5: Testing & Quality
- [ ] Unit tests with Vitest (>80% coverage)
- [ ] E2E tests with Playwright
- [ ] Cross-site testing (10+ e-commerce sites)
- [ ] Performance benchmarking

### Phase 6: Chrome Web Store Publishing
- [ ] Create promotional graphics & screenshots
- [ ] Write privacy policy
- [ ] Prepare store listing
- [ ] Submit for review

### Phase 7: Cross-Platform
- [ ] Firefox extension port
- [ ] Mobile browser support (Kiwi, Firefox Mobile)

---

## Important Notes for Development

### DO NOT:
- ❌ Work on `extension/` directory (it's legacy/archived)
- ❌ Manually inject content script with file path (use manifest auto-injection)
- ❌ Use Tailwind CSS v4 (breaks build - use v3.4)
- ❌ Store OpenAI key in .env (users configure via Settings modal)
- ❌ Create new files unless absolutely necessary

### ALWAYS:
- ✅ Work in `extension-v2/` directory
- ✅ Test on multiple e-commerce sites before deploying
- ✅ Validate API keys before storing
- ✅ Handle errors gracefully with user-friendly messages
- ✅ Update cache timestamp when storing cards
- ✅ Use type-safe storage helpers from `src/utils/storage.ts`
- ✅ Prefer editing existing files over creating new ones

### Critical Implementation Details
- Content script is **auto-injected by manifest** - do NOT manually inject
- @crxjs plugin bundles `.ts` files to `.js` in `dist/assets/`
- Popup waits for content script via retry loop (5 × 200ms)
- Supabase cards cached for 1 hour with fallback on errors
- OpenAI API calls limited to 120 tokens for cost efficiency

---

## Quick Reference

### Common Commands

```bash
# Development (in extension-v2/)
npm install              # Install dependencies
npm run build           # Build extension
npm run dev             # Dev mode with watch
npm run lint            # Check code quality

# Testing
node test-supabase.js   # Test Supabase connection

# Debugging
chrome://extensions/    # Extension management
# Right-click extension icon → Inspect popup
# F12 on page → Content script console
```

### Key Files (extension-v2/)

```
manifest.json                          # Extension configuration
src/popup/Popup.tsx                    # Main UI orchestrator
src/content/index.ts                   # Cart extraction + banners
src/content/extractors/
  ├── ExtractorRegistry.ts            # O(1) site registry
  ├── BaseExtractor.ts                # Abstract base class
  ├── sites/SephoraExtractor.ts      # Custom extractor
  └── configs/simple-sites.config.ts  # Site configurations
src/services/api.ts                    # OpenAI + prompt building
src/services/supabase.ts               # Database operations
src/utils/storage.ts                   # Chrome storage helpers
src/types/index.ts                     # TypeScript interfaces
CLAUDE.md                              # Comprehensive documentation
SITE_EXTRACTORS.md                     # Extractor implementation guide
```

---

## Resources

**Documentation:**
- [extension-v2/CLAUDE.md](extension-v2/CLAUDE.md) - Comprehensive technical documentation
- [extension-v2/SITE_EXTRACTORS.md](extension-v2/SITE_EXTRACTORS.md) - Cart extractor guide
- [extension-v2/README.md](extension-v2/README.md) - User-facing documentation
- [Chrome Extensions](https://developer.chrome.com/docs/extensions/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
- [Supabase Docs](https://supabase.com/docs)
- [OpenAI API](https://platform.openai.com/docs)

**Parent Project:**
- Main repository: `/Users/evanliu/Projects/CreditCardAI/`
- Simulation app: `/Users/evanliu/Projects/CreditCardAI/simulation/`

---

## Changelog

**v2.0.0 (October 2025)** - Current Version

**What's New:**
- ✅ Complete rewrite with React 19 + TypeScript 5.8
- ✅ Supabase database integration replacing hardcoded cards
- ✅ Modern build system with Vite 7 + @crxjs/vite-plugin
- ✅ Tailwind CSS 3.4 styling
- ✅ Zustand state management
- ✅ Smart caching (1-hour TTL) with fallbacks
- ✅ Hybrid Registry Pattern for cart extraction
  - Scalable to 100+ e-commerce sites
  - Two implementation paths: Config (5 min) or Custom (20 min)
- ✅ Comprehensive error handling and loading states
- ✅ Settings modal with API key management
- ✅ On-page recommendation banners

**v1.0.0** - Legacy Version (Archived)
- Vanilla JavaScript proof-of-concept
- 3 hardcoded cards in cards.json
- Basic DOM extraction with switch-based site detection
- No database, no state management
- Preserved in `extension/` directory for reference

---

*Last updated: October 2025*
*For detailed technical documentation, see [extension-v2/CLAUDE.md](extension-v2/CLAUDE.md)*
