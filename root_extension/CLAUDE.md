# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Chrome Extension** component of AI Checkout, a credit card recommendation system that uses OpenAI's GPT to recommend the optimal credit card for online purchases based on merchant category and cart contents.

## Architecture

### Chrome Extension (Manifest V3)
The extension uses Chrome's Manifest V3 architecture with three main components:

1. **background.js** - Service worker (currently minimal/placeholder)
2. **content.js** - Injected into shopping pages to:
   - Extract cart items using DOM selectors
   - Build LLM prompts with cart data, merchant info, and card details
   - Call OpenAI API for recommendations
   - Display recommendation banner on page
   - Intercept console logs for debugging (via `window.__CC_LOG_PATCHED__`)
3. **popup.js/popup.html** - Extension popup UI that:
   - Orchestrates the recommendation flow by injecting content.js
   - Manages OpenAI API key storage
   - Displays structured recommendations with card name, rewards, merchant, category

### Data Flow
1. User clicks extension → popup.js executes
2. popup.js injects content.js into active tab
3. content.js extracts cart items from page DOM
4. Builds prompt with cart items, site URL, and cards from cards.json
5. Calls OpenAI API (gpt-3.5-turbo) with structured JSON response request
6. Parses JSON response with fields: `card`, `rewards`, `merchant`, `category`
7. Displays recommendation in popup and/or on-page banner

### Key Files
- **manifest.json** - Chrome extension configuration (permissions: activeTab, storage, scripting)
- **cards.json** - Credit card database with rewards categories, annual fees, descriptions
- **popup.html** - Extension popup with settings modal for API key management
- **styles.css** - Popup styling

### Modular Functions (window-scoped in content.js)
- `window.extractCartItems()` - DOM scraping for cart data
- `window.buildLLMPrompt(cartItems, site, cards)` - Prompt engineering
- `window.callOpenAIChat(prompt, apiKey)` - OpenAI API wrapper
- `window.createOrUpdateBanner(html)` - On-page recommendation display

## Development

### API Key Setup
Users must configure their OpenAI API key via the Settings button in the popup. Keys are stored in `chrome.storage.local` with key `openaiKey`.

## Parent Repository Structure
This extension is part of a larger repo at `/Users/evanliu/Projects/CreditCardAI/` with:
- **root_extension/** (this directory) - Chrome extension
- **simulation/** - Node.js/Express simulation app for testing recommendation logic
- **README.md** - Overview and setup instructions for both components

The simulation app uses similar logic but runs as a web server (Express.js) with a visualization UI.

## Important Notes
- Uses OpenAI gpt-3.5-turbo model with 120 max_tokens
- LLM responses are expected as JSON with no markdown wrapping
- Popup.js strips markdown code blocks (```json) if present in response
- Debug mode (window.CC_DEBUG) shows console logs in on-page banner
- Cart extraction uses fallback selectors for various e-commerce platforms

---

## Production Upgrade Plan

**Goal:** Transform proof-of-concept Chrome extension (3 hardcoded cards, vanilla JS) into production-ready application with dynamic card database, secure API, and modern React UI.

**Tech Stack:**
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Supabase
- Styling: Tailwind CSS
- Build: Vite with @crxjs/vite-plugin

### Note: Upgraded extension should be created in a new `extension-v2/'` directory. The old `extension` can be kept for reference.

### Phase 1: Backend Infrastructure (Supabase + Node.js)

1. **Supabase Setup**
   - Create Supabase project
   - Configure database and authentication
   - Obtain API credentials (URL, anon key, service role key)

2. **Database Schema**
   - Design `credit_cards` table:
     - `id` (uuid, primary key)
     - `name` (text)
     - `annual_fee` (numeric)
     - `rewards` (jsonb) - flexible rewards structure
     - `description` (text)
     - `created_at`, `updated_at` (timestamps)
   - Add indexes for performance
   - Set up Row Level Security (RLS) policies

3. **Data Seeding**
   - Migrate 3 cards from `cards.json` to Supabase
   - Create seed script for development/testing
   - Add admin interface considerations for card management

4. **Backend API Development**
   - Create Node.js/Express API server
   - Initialize Supabase client with service role key
   - Implement CORS and security headers

5. **API Endpoints**
   - `GET /api/cards` - Fetch all active cards
   - `GET /api/cards/:id` - Fetch single card
   - `POST /api/recommend` - LLM recommendation endpoint
   - `POST /api/cards` - Admin: Create card
   - `PUT /api/cards/:id` - Admin: Update card
   - `DELETE /api/cards/:id` - Admin: Delete card

### Phase 2: Frontend Modernization (React + TypeScript + Vite)

6. **Vite Project Initialization**
   - Create new Vite project: `npm create vite@latest extension-v2 -- --template react-ts`
   - Set up proper directory structure:
     ```
     src/
     ├── background/     # Service worker
     ├── content/        # Content scripts
     ├── popup/          # Popup UI
     ├── components/     # Shared React components
     ├── services/       # API clients
     ├── types/          # TypeScript definitions
     └── utils/          # Helper functions
     ```

7. **Build Configuration**
   - Install `@crxjs/vite-plugin` for Chrome Extension support
   - Configure `vite.config.ts` for manifest v3
   - Set up HMR (Hot Module Replacement) for development
   - Configure build output for extension structure

8. **Dependencies Installation**
   ```json
   {
     "dependencies": {
       "react": "^18.x",
       "react-dom": "^18.x",
       "@supabase/supabase-js": "^2.x",
       "zustand": "^4.x",
       "react-query": "^5.x"
     },
     "devDependencies": {
       "@crxjs/vite-plugin": "^2.x",
       "@types/chrome": "^0.0.x",
       "typescript": "^5.x",
       "tailwindcss": "^3.x",
       "autoprefixer": "^10.x",
       "postcss": "^8.x"
     }
   }
   ```

### Phase 3: Extension Migration

9. **Background Service Worker (TypeScript)**
   - Convert `background.js` to `src/background/index.ts`
   - Add message passing handlers
   - Implement extension lifecycle management
   - Type-safe chrome API usage

10. **Content Script Migration**
    - Convert `content.js` to `src/content/index.ts`
    - Create type definitions for cart extraction:
      ```typescript
      interface CartItem {
        name: string;
        price?: string;
        quantity?: number;
      }
      ```
    - Maintain modular functions with proper exports
    - Add error handling and retry logic

11. **React Popup UI**
    - Create `src/popup/Popup.tsx` as main component
    - Implement component hierarchy:
      - `<Popup />` - Root
      - `<RecommendationCard />` - Display recommendation
      - `<SettingsModal />` - API key management
      - `<LoadingState />` - Skeleton/spinner
      - `<ErrorBoundary />` - Error handling

12. **Settings Modal Component**
    - API key input with validation (starts with `sk-`)
    - Secure storage using chrome.storage.local
    - Toggle visibility for API key
    - Save/cancel with feedback states

13. **Recommendation Display**
    - Card name with icon/branding
    - Rewards breakdown (category → value)
    - Merchant and category inference
    - Loading skeleton during API call
    - Error states with retry button

### Phase 4: Integration & Polish

14. **API Service Layer**
    - Create `src/services/api.ts`:
      ```typescript
      class CardAPIClient {
        async getCards(): Promise<CreditCard[]>
        async getRecommendation(params: RecommendationRequest): Promise<Recommendation>
      }
      ```
    - Supabase client initialization
    - Error handling and type safety
    - Request/response interceptors

15. **Error Handling & UX**
    - Toast notifications for user feedback
    - Retry logic for failed API calls
    - Graceful degradation (fallback to cached cards)
    - Loading states for all async operations
    - User-friendly error messages

16. **Tailwind CSS Styling**
    - Configure Tailwind in `tailwind.config.js`
    - Create design system (colors, spacing, typography)
    - Responsive components
    - Dark mode support (optional)
    - Animations for state transitions

17. **Manifest Updates**
    - Update `manifest.json` for Vite build:
      ```json
      {
        "manifest_version": 3,
        "permissions": ["activeTab", "storage"],
        "host_permissions": ["<all_urls>"],
        "content_security_policy": {
          "extension_pages": "script-src 'self'; object-src 'self'"
        },
        "web_accessible_resources": [{
          "resources": ["assets/*"],
          "matches": ["<all_urls>"]
        }]
      }
      ```

18. **Build & Testing**
    - Run `npm run build` and verify output in `dist/`
    - Load unpacked extension from `dist/` directory
    - Test on multiple e-commerce sites
    - Verify chrome.storage persistence
    - Check network requests in DevTools

19. **End-to-End Verification**
    - Cart extraction → API call → Supabase query → LLM → UI display
    - Settings persistence across browser sessions
    - Error handling (network failures, invalid API keys)
    - Performance metrics (load time, API latency)
    - Browser compatibility

### Migration Notes

- Keep old vanilla JS version in `extension/` directory as reference
- Create new project in `extension-v2/` or rename after migration
- Use feature flags to gradually roll out new functionality
- Document API endpoints and database schema
- Create `.env.example` for environment variables configuration

---

## Detailed Rebuild Plan (Ordered Tasks)

This section provides a step-by-step ordered task list for rebuilding the extension in `extension-v2/`.

### **Phase 1: Project Foundation (Days 1-2)**

#### Task 1.1: Initialize Vite + React + TypeScript Project
- [ ] Run `npm create vite@latest . -- --template react-ts` in `extension-v2/`
- [ ] Verify package.json, tsconfig.json, and vite.config.ts created
- [ ] Run `npm install` to install base dependencies

#### Task 1.2: Install Chrome Extension Dependencies
- [ ] Install `@crxjs/vite-plugin` for Manifest V3 support
- [ ] Install `@types/chrome` for Chrome API TypeScript definitions
- [ ] Install Tailwind CSS: `tailwindcss`, `autoprefixer`, `postcss`
- [ ] Install state management: `zustand`
- [ ] Install data fetching: `@tanstack/react-query`
- [ ] Install Supabase client: `@supabase/supabase-js`

#### Task 1.3: Configure Build System
- [ ] Update `vite.config.ts` with `@crxjs/vite-plugin`
- [ ] Configure build output for Chrome extension structure
- [ ] Set up HMR (Hot Module Replacement) for development
- [ ] Create `postcss.config.js` for Tailwind
- [ ] Create `tailwind.config.js` with extension-specific settings

#### Task 1.4: Set Up Directory Structure
```
extension-v2/
├── src/
│   ├── background/
│   │   └── index.ts          # Service worker
│   ├── content/
│   │   └── index.ts          # Content script
│   ├── popup/
│   │   ├── Popup.tsx         # Main popup component
│   │   ├── index.tsx         # Popup entry point
│   │   └── index.html        # Popup HTML
│   ├── components/
│   │   ├── RecommendationCard.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── LoadingState.tsx
│   │   └── ErrorBoundary.tsx
│   ├── services/
│   │   ├── api.ts            # API client
│   │   └── supabase.ts       # Supabase client
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   ├── utils/
│   │   ├── cartExtraction.ts # Cart extraction logic
│   │   └── storage.ts        # Chrome storage helpers
│   └── styles/
│       └── globals.css       # Tailwind imports
├── public/
│   └── icons/                # Extension icons
├── manifest.json             # Chrome extension manifest
├── .env.example              # Environment variables template
└── package.json
```
- [ ] Create all directories

#### Task 1.5: Create Manifest V3 Configuration
- [ ] Create `manifest.json` in root with Manifest V3 structure
- [ ] Configure permissions: `activeTab`, `storage`, `scripting`
- [ ] Set up `host_permissions` for API calls
- [ ] Configure `background` service worker
- [ ] Configure `action` (popup)
- [ ] Set up `content_scripts` injection rules
- [ ] Configure `web_accessible_resources`

#### Task 1.6: TypeScript Type Definitions
- [ ] Create `src/types/index.ts` with core interfaces:
  - `CreditCard` interface
  - `CartItem` interface
  - `Recommendation` interface
  - `RecommendationRequest` interface
  - `APIResponse` types

---

### **Phase 2: Backend Infrastructure (Days 3-4)**

#### Task 2.1: Supabase Project Setup
- [ ] Create new Supabase project at https://supabase.com
- [ ] Note project URL and anon key
- [ ] Note service role key (for backend API)
- [ ] Create `.env.example` with placeholder keys
- [ ] Create `.env` (gitignored) with actual keys

#### Task 2.2: Database Schema Design
- [ ] Access Supabase SQL Editor
- [ ] Create `credit_cards` table:
  ```sql
  create table credit_cards (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    annual_fee numeric not null default 0,
    rewards jsonb not null,
    description text,
    is_active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  ```
- [ ] Create index on `is_active` for performance
- [ ] Set up RLS (Row Level Security) policies for read access
- [ ] Create updated_at trigger function

#### Task 2.3: Data Migration
- [ ] Read cards from `../extension/cards.json`
- [ ] Write SQL INSERT statements for 3 cards
- [ ] Execute inserts in Supabase SQL Editor
- [ ] Verify data with SELECT query

#### Task 2.4: Node.js API Server Setup (Optional - can use Supabase directly from extension)
- [ ] Create `api/` directory in project root
- [ ] Initialize Node.js project: `npm init -y`
- [ ] Install dependencies: `express`, `cors`, `dotenv`, `@supabase/supabase-js`
- [ ] Create `api/server.js` with Express setup
- [ ] Configure CORS for Chrome extension origin
- [ ] Initialize Supabase client with service role key

#### Task 2.5: API Endpoints Implementation
- [ ] `GET /api/cards` - Fetch all active cards from Supabase
- [ ] `POST /api/recommend` - Accept cart items, call OpenAI, return recommendation
- [ ] Add error handling middleware
- [ ] Add request validation
- [ ] Test endpoints with Postman/curl

---

### **Phase 3: Extension Core (Days 5-6)**

#### Task 3.1: Background Service Worker
- [ ] Create `src/background/index.ts`
- [ ] Add extension lifecycle listeners (install, startup)
- [ ] Set up message passing handlers for content script communication
- [ ] Add chrome.storage initialization logic
- [ ] Type-safe Chrome API usage with @types/chrome

#### Task 3.2: Content Script - Cart Extraction
- [ ] Create `src/content/index.ts`
- [ ] Migrate `extractCartItems()` function from vanilla JS
- [ ] Convert to TypeScript with proper types
- [ ] Improve selector robustness (more e-commerce sites)
- [ ] Add error handling and logging
- [ ] Export as window function for popup to call

#### Task 3.3: Content Script - LLM Integration
- [ ] Migrate `buildLLMPrompt()` function
- [ ] Migrate `callOpenAIChat()` function
- [ ] Update to use TypeScript interfaces
- [ ] Add retry logic for API failures
- [ ] Improve prompt engineering for better results

#### Task 3.4: Content Script - Banner Display
- [ ] Migrate `createOrUpdateBanner()` function
- [ ] Improve styling with Tailwind-like inline styles
- [ ] Add close button to banner
- [ ] Add animation for banner appearance
- [ ] Store recommendation in chrome.storage

#### Task 3.5: Supabase Client Service
- [ ] Create `src/services/supabase.ts`
- [ ] Initialize Supabase client with environment variables
- [ ] Create helper functions:
  - `getActiveCards(): Promise<CreditCard[]>`
  - `getCardById(id: string): Promise<CreditCard | null>`
- [ ] Add error handling and type safety
- [ ] Cache cards in chrome.storage for offline access

#### Task 3.6: API Service Layer
- [ ] Create `src/services/api.ts`
- [ ] Implement `CardAPIClient` class with methods:
  - `getCards()`
  - `getRecommendation(cartItems, site, apiKey)`
- [ ] Add request/response interceptors
- [ ] Implement caching strategy
- [ ] Add timeout and retry logic

#### Task 3.7: Storage Utilities
- [ ] Create `src/utils/storage.ts`
- [ ] Implement Chrome storage helpers:
  - `getOpenAIKey(): Promise<string>`
  - `setOpenAIKey(key: string): Promise<void>`
  - `getCachedCards(): Promise<CreditCard[]>`
  - `setCachedCards(cards: CreditCard[]): Promise<void>`
  - `getLatestRecommendation(): Promise<string>`
- [ ] Add TypeScript generics for type safety

---

### **Phase 4: React UI Components (Days 7-9)**

#### Task 4.1: Global Styles Setup
- [ ] Create `src/styles/globals.css`
- [ ] Add Tailwind directives (@tailwind base, components, utilities)
- [ ] Define custom CSS variables for theme colors
- [ ] Add extension-specific utility classes

#### Task 4.2: Popup Entry Point
- [ ] Create `src/popup/index.html` with root div
- [ ] Create `src/popup/index.tsx` with React root render
- [ ] Import global styles
- [ ] Set up React Query provider
- [ ] Mount `<Popup />` component

#### Task 4.3: Error Boundary Component
- [ ] Create `src/components/ErrorBoundary.tsx`
- [ ] Implement `componentDidCatch` lifecycle
- [ ] Display user-friendly error UI
- [ ] Add retry button
- [ ] Log errors to console for debugging

#### Task 4.4: Loading State Component
- [ ] Create `src/components/LoadingState.tsx`
- [ ] Implement skeleton UI for card recommendation
- [ ] Add spinning animation
- [ ] Make reusable for different loading contexts

#### Task 4.5: Recommendation Card Component
- [ ] Create `src/components/RecommendationCard.tsx`
- [ ] Accept `Recommendation` prop
- [ ] Display card name with styling
- [ ] Show rewards breakdown (category → value)
- [ ] Display merchant and inferred category
- [ ] Add card icon/branding (optional)
- [ ] Style with Tailwind CSS

#### Task 4.6: Settings Modal Component
- [ ] Create `src/components/SettingsModal.tsx`
- [ ] Create modal overlay with backdrop
- [ ] Add API key input field (type="password")
- [ ] Add toggle button to show/hide API key
- [ ] Implement validation (key must start with `sk-`)
- [ ] Save button that stores to chrome.storage
- [ ] Cancel/close button
- [ ] Display save success/error feedback
- [ ] Handle click outside to close

#### Task 4.7: Main Popup Component
- [ ] Create `src/popup/Popup.tsx` as root component
- [ ] Implement component state:
  - `loading: boolean`
  - `recommendation: Recommendation | null`
  - `error: string | null`
  - `showSettings: boolean`
- [ ] Add "Settings" button to open modal
- [ ] Implement recommendation flow on mount:
  1. Check for API key
  2. Inject content script
  3. Extract cart items
  4. Fetch cards from Supabase
  5. Build prompt and call OpenAI
  6. Display recommendation
- [ ] Handle all error states
- [ ] Add retry button for failures

#### Task 4.8: State Management with Zustand
- [ ] Create `src/store/useStore.ts`
- [ ] Define store with:
  - `apiKey: string`
  - `cards: CreditCard[]`
  - `recommendation: Recommendation | null`
  - Actions for updating state
- [ ] Use store in components for global state

---

### **Phase 5: Integration & Styling (Days 10-11)**

#### Task 5.1: Tailwind Theme Configuration
- [ ] Update `tailwind.config.js` with:
  - Custom color palette (blue primary, gray neutrals)
  - Custom spacing scale
  - Typography settings
  - Border radius values
- [ ] Configure dark mode (class-based)
- [ ] Add animation utilities

#### Task 5.2: Component Styling Polish
- [ ] Style RecommendationCard with card-like appearance
- [ ] Style SettingsModal with proper z-index and backdrop
- [ ] Style buttons with hover/active states
- [ ] Add focus states for accessibility
- [ ] Ensure proper spacing and alignment
- [ ] Test responsive behavior (popup sizes)

#### Task 5.3: API Integration Testing
- [ ] Test Supabase connection from extension
- [ ] Test OpenAI API calls from content script
- [ ] Verify cart extraction on real e-commerce sites:
  - Amazon
  - Target
  - Walmart
  - Generic checkout pages
- [ ] Test error handling for network failures
- [ ] Test API key validation

#### Task 5.4: Chrome Storage Integration
- [ ] Verify API key persistence across browser restarts
- [ ] Test card caching and cache invalidation
- [ ] Verify recommendation storage
- [ ] Test storage quota handling

#### Task 5.5: User Feedback & Error Handling
- [ ] Add toast notifications (or use simple alerts)
- [ ] Display specific error messages for:
  - Missing API key
  - Invalid API key
  - Network errors
  - Cart extraction failures
  - LLM parsing errors
- [ ] Add retry logic with exponential backoff
- [ ] Implement graceful degradation (cached cards fallback)

---

### **Phase 6: Build, Test & Deploy (Days 12-13)**

#### Task 6.1: Build Configuration Validation
- [ ] Run `npm run build`
- [ ] Verify `dist/` directory structure
- [ ] Check manifest.json copied correctly
- [ ] Verify all assets bundled (icons, etc.)
- [ ] Check bundle size (should be < 5MB)

#### Task 6.2: Chrome Extension Loading
- [ ] Open Chrome → Extensions → Developer mode
- [ ] Load unpacked extension from `dist/`
- [ ] Verify extension appears in toolbar
- [ ] Click extension to open popup

#### Task 6.3: Functional Testing
- [ ] Test Settings modal:
  - Open settings
  - Save valid API key
  - Verify persistence
  - Test invalid key validation
- [ ] Test recommendation flow:
  - Navigate to e-commerce site
  - Click extension
  - Verify cart extraction
  - Verify recommendation display
- [ ] Test error states:
  - No API key
  - Invalid API key
  - Network failure
  - Empty cart

#### Task 6.4: Cross-Site Testing
- [ ] Test on 5+ e-commerce sites
- [ ] Verify cart extraction accuracy
- [ ] Check recommendation quality
- [ ] Test on non-shopping sites (graceful failure)

#### Task 6.5: Performance Optimization
- [ ] Measure popup load time (should be < 1s)
- [ ] Measure API latency
- [ ] Check for memory leaks
- [ ] Optimize bundle size if needed
- [ ] Add loading states for slow connections

#### Task 6.6: Documentation
- [ ] Create README.md in extension-v2/:
  - Setup instructions
  - Build commands
  - Environment variables
  - Testing guide
- [ ] Document API endpoints (if using Node.js backend)
- [ ] Document Supabase schema
- [ ] Add code comments for complex logic

#### Task 6.7: End-to-End Verification Checklist
- [ ] Cart extraction → API call → Supabase query → LLM → UI display (complete flow)
- [ ] Settings persistence across browser sessions
- [ ] Error handling (network failures, invalid API keys)
- [ ] Performance metrics (load time < 1s, API latency < 3s)
- [ ] Browser compatibility (Chrome, Edge, Brave)
- [ ] Extension size < 5MB
- [ ] No console errors in normal operation

---

### **Task Dependencies & Critical Path**

**Must Complete First:**
- Phase 1 (all tasks) - Foundation required for everything else
- Task 2.1-2.3 - Backend setup required for data access
- Task 3.6 - API service required for components

**Can Work in Parallel:**
- Phase 2 (backend) + Phase 3 (extension core) - independent
- Task 4.3-4.6 (UI components) - can build simultaneously
- Task 5.2 (styling) can happen alongside Task 5.3 (testing)

**Critical Path:**
1. Project setup → 2. Backend → 3. API service → 4. UI components → 5. Integration → 6. Testing

---

## Extension v2 - Implementation Documentation (COMPLETED ✅)

**Status:** Fully functional and tested
**Location:** `/extension-v2/`
**Build Output:** `/extension-v2/dist/`

### Architecture Overview

**Tech Stack:**
- React 19 + TypeScript 5.8
- Vite 7 with @crxjs/vite-plugin
- Tailwind CSS 3.4
- Zustand (state management)
- Supabase (database)
- OpenAI GPT-3.5 Turbo

**Bundle Size:** ~365KB (~108KB gzipped)

### How It Works - Complete Flow

```
1. User clicks extension icon
   ↓
2. Popup.tsx renders (React UI)
   - Checks chrome.storage for API key
   - Shows initial state or cached recommendation
   ↓
3. User clicks "Get Recommendation" button
   ↓
4. handleGetRecommendation() executes:

   a) Check if content script is ready (retry loop):
      - Waits up to 5 retries × 200ms = 1 second
      - Checks for window.__CC_extractCartItems function
      - Throws error if not ready: "Content script not loaded. Try refreshing the page."

   b) Extract cart items:
      - Uses chrome.scripting.executeScript with func parameter
      - Executes: window.__CC_extractCartItems() in page context
      - Returns: CartItem[] with {name, price?, quantity?}
      - Throws error if empty: "No cart items found on this page"

   c) Fetch credit cards:
      - Calls cardAPI.getCards() from services/api.ts
      - → getActiveCards() from services/supabase.ts
      - Checks cache first (1 hour TTL in chrome.storage)
      - Fetches from Supabase if stale/missing
      - Falls back to cached cards on network error

   d) Get recommendation:
      - Calls cardAPI.getRecommendation(cartItems, site, apiKey)
      - Builds LLM prompt with cart + cards + site
      - Calls OpenAI gpt-3.5-turbo (max 120 tokens)
      - Parses JSON response: {card, rewards, merchant, category}

   e) Display results:
      - Updates Zustand store: setRecommendation(rec)
      - RecommendationCard.tsx renders in popup
      - Creates on-page banner via window.__CC_createBanner(html)
```

### Key Files & Functions

#### 1. Popup Component (`src/popup/Popup.tsx`)
**Main orchestrator of recommendation flow**

**Key Function:**
```typescript
handleGetRecommendation() {
  // 1. Get active tab
  chrome.tabs.query({active: true, currentWindow: true})

  // 2. Wait for content script (retry loop)
  while (retries < 5) {
    check window.__CC_extractCartItems exists
    if yes: break
    wait 200ms
  }

  // 3. Extract cart items
  chrome.scripting.executeScript({
    func: () => window.__CC_extractCartItems()
  })

  // 4. Get recommendation
  cardAPI.getRecommendation(cartItems, site, apiKey)

  // 5. Display in popup + create banner
  setRecommendation(rec)
  window.__CC_createBanner(html)
}
```

#### 2. Content Script (`src/content/index.ts`)
**Auto-injected by manifest on all pages**

**Manifest Entry:**
```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["assets/index.ts-BQeXNPZ1.js"]  // Built by @crxjs
}]
```

**Key Functions:**
```typescript
// Extract cart items from page DOM
window.__CC_extractCartItems = () => {
  // Strategy 1: Cart containers
  // Strategy 2: Checkout pages
  // Strategy 3: Product pages
  // Strategy 4: Price pattern fallback
  return CartItem[]
}

// Create on-page banner
window.__CC_createBanner = (html) => {
  // Creates fixed position banner (top-right)
  // Adds close button
  // Stores in chrome.storage
}
```

#### 3. API Service (`src/services/api.ts`)
**Handles all external API calls**

**Class: CardAPIClient**
```typescript
async getCards() {
  if (USE_BACKEND_API) {
    // Call Node.js API server
    fetch('http://localhost:3000/api/cards')
  } else {
    // Direct Supabase call (default)
    getActiveCards() from supabase.ts
  }
}

async getRecommendation(cartItems, site, apiKey) {
  // 1. Get cards
  const cards = await this.getCards()

  // 2. Build prompt
  const prompt = this.buildPrompt(cartItems, site, cards)

  // 3. Call OpenAI
  const llmResponse = await this.callOpenAI(prompt, apiKey)

  // 4. Parse JSON
  return this.parseRecommendation(llmResponse)
}

private buildPrompt(cartItems, site, cards) {
  // Combines cart items + site + card data
  // Returns formatted prompt string
}

private callOpenAI(prompt, apiKey) {
  fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{role: 'user', content: prompt}],
      max_tokens: 120
    })
  })
}

private parseRecommendation(llmResponse) {
  // Strip markdown code blocks if present
  // Parse JSON
  // Return {card, rewards, merchant, category}
}
```

#### 4. Supabase Service (`src/services/supabase.ts`)
**Database operations with caching**

```typescript
async getActiveCards(forceRefresh = false) {
  // 1. Check cache (unless forceRefresh)
  if (!forceRefresh && !await areCachedCardsStale()) {
    return await getCachedCards()
  }

  // 2. Fetch from Supabase
  const { data } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('is_active', true)
    .order('name')

  // 3. Cache results (1 hour TTL)
  await setCachedCards(data)

  return data
}
```

#### 5. Storage Utilities (`src/utils/storage.ts`)
**Chrome storage helpers**

```typescript
// Generic type-safe storage
async getFromStorage<K>(key: K): Promise<StorageData[K]>
async setInStorage<K>(key: K, value: StorageData[K])

// Specific helpers
async getOpenAIKey(): Promise<string>
async setOpenAIKey(key: string)
async getCachedCards(): Promise<CreditCard[]>
async setCachedCards(cards: CreditCard[])
async areCachedCardsStale(): Promise<boolean>  // 1 hour TTL
```

### Critical Implementation Details

#### ⚠️ Content Script Injection
**DO NOT manually inject content script!**
- Content script is auto-injected by manifest
- @crxjs plugin handles bundling to `assets/index.ts-*.js`
- Popup only needs to wait for script to be ready (retry loop)
- Previous error: Tried to inject `.ts` file instead of compiled `.js`

#### Cart Extraction Strategies
```typescript
// 1. Common cart containers
document.querySelectorAll('[id*=cart], [class*=cart]')

// 2. Checkout pages
document.querySelectorAll('[class*=order-summary]')

// 3. Product pages
document.querySelector('h1[class*=product]')

// 4. Fallback: price patterns
elements.textContent.match(/\$\d+(\.\d{2})?/)
```

#### Caching Strategy
```typescript
// Cards cache
{
  cachedCards: CreditCard[],
  lastCardsFetch: timestamp,
  // TTL: 1 hour (3600000ms)
}

// Check staleness
Date.now() - lastCardsFetch > 3600000

// Fallback on network error
if (supabaseError) {
  return await getCachedCards()
}
```

#### Error Handling Layers
1. **ErrorBoundary (React)** - Catches component errors, shows retry UI
2. **Try-catch in Popup** - Network/API errors, displays in popup UI
3. **Validation** - API key format, cart items existence
4. **Fallbacks** - Cached cards, graceful degradation

### Component Hierarchy

```
Popup.tsx (main orchestrator)
├── ErrorBoundary (wraps all)
├── Header (title + settings button)
├── Content (conditional rendering):
│   ├── LoadingState (skeleton/spinner)
│   ├── Error display (red alert)
│   ├── RecommendationCard (success state)
│   └── Initial state (Get Recommendation button)
└── SettingsModal (overlay)
    ├── API key input (password/text toggle)
    ├── Validation (must start with 'sk-')
    ├── Save/Cancel buttons
    └── Success/error feedback
```

### State Management (Zustand)

```typescript
// src/store/useStore.ts
interface AppState {
  // State
  apiKey: string
  cards: CreditCard[]
  recommendation: Recommendation | null
  isLoading: boolean
  error: string | null
  showSettings: boolean

  // Actions
  setApiKey(key: string)
  setCards(cards: CreditCard[])
  setRecommendation(rec: Recommendation | null)
  setLoading(loading: boolean)
  setError(error: string | null)
  setShowSettings(show: boolean)
  reset()
}
```

### Build Configuration

**vite.config.ts:**
```typescript
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })  // Transforms manifest + bundles extension
  ]
})
```

**tsconfig.app.json (critical settings):**
```json
{
  "types": ["vite/client", "chrome"],  // Chrome API types
  "verbatimModuleSyntax": false,        // Allow React imports
  "noUnusedLocals": false,              // Relax for dev
  "noUnusedParameters": false           // Relax for dev
}
```

**Tailwind v3 (not v4):**
- Downgraded due to v4 PostCSS compatibility issues
- v3 works perfectly with @crxjs/vite-plugin

### Database Schema

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

-- Index for performance
CREATE INDEX idx_credit_cards_is_active ON credit_cards(is_active);

-- RLS policy (public read for active cards)
CREATE POLICY "Allow public read access to active cards"
  ON credit_cards FOR SELECT
  USING (is_active = TRUE);
```

**Sample rewards JSONB:**
```json
{
  "groceries": "5% cashback",
  "dining": "4x points",
  "all": "1% cashback"
}
```

### Testing Checklist (Verified ✅)

**Basic Functionality:**
- ✅ Extension loads without errors
- ✅ Settings modal opens/closes smoothly
- ✅ API key saves and persists across sessions
- ✅ Supabase fetches 3 cards from database
- ✅ Cart extraction works (tested on Sephora)
- ✅ Recommendation displays in popup
- ✅ Banner appears on page with close button
- ✅ Content script auto-injection works

**Known Working:**
- Sephora (confirmed working)
- Should work on most e-commerce sites with cart/checkout pages

### Common Issues & Solutions

**1. "Content script not loaded" error**
- **Cause:** Content script not injected or not ready yet
- **Solution:** Refresh the page, wait for script to load
- **Prevention:** Retry loop already implemented (5 × 200ms)

**2. "No cart items found"**
- **Cause:** Wrong page or unsupported DOM structure
- **Solution:** Go to cart/checkout page, try different site
- **Debug:** Open console, run `window.__CC_extractCartItems()`

**3. Build errors**
- **Cause:** TypeScript cache or dependency issues
- **Solution:** `rm -rf node_modules/.tmp && npm run build`

**4. Extension won't load in Chrome**
- **Cause:** Wrong directory or missing manifest
- **Solution:** Load `dist/` directory (not root), check for manifest.json

### Development Workflow

1. **Edit source files** in `src/`
2. **Build:** `npm run build`
3. **Reload extension:** chrome://extensions/ → click ↻
4. **Refresh page:** F5 on test page
5. **Debug:**
   - Popup: Right-click icon → Inspect popup
   - Page: F12 → Console
   - Background: chrome://extensions/ → service worker link

### Environment Setup

**.env (required):**
```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Supabase setup:**
1. Create project at supabase.com
2. Run `supabase/migrations/001_create_credit_cards_table.sql`
3. Run `supabase/seed/001_seed_credit_cards.sql`
4. Copy URL and anon key to `.env`
5. Test: `node test-supabase.js`

### Future Enhancements

- Add more cards to database (admin UI)
- User preferences for favorite cards
- Historical recommendations tracking
- Card comparison view
- Performance analytics dashboard
- Dark mode support
- Multi-language support
