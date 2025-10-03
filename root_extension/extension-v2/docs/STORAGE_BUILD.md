# Storage & Build System Documentation

**Complete guide to Chrome storage, Vite build configuration, and development workflow**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Chrome Storage](#chrome-storage)
3. [Build System (Vite)](#build-system-vite)
4. [Manifest V3](#manifest-v3)
5. [TypeScript Configuration](#typescript-configuration)
6. [Dependencies](#dependencies)
7. [Development Workflow](#development-workflow)
8. [Build Process](#build-process)
9. [Environment Variables](#environment-variables)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The extension uses a modern build stack:

**Storage Layer:**
- 🗄️ **chrome.storage.local** - Persistent local storage (10MB limit)
- 📦 **Type-safe helpers** - TypeScript wrappers for storage API
- 💾 **Caching** - 1-hour TTL for database queries

**Build System:**
- ⚡ **Vite 7** - Lightning-fast build tool
- 🔌 **@crxjs/vite-plugin** - Chrome Extension bundler
- ⚛️ **React 19** - UI framework
- 📘 **TypeScript 5.8** - Type safety
- 🎨 **Tailwind CSS 3.4** - Styling

**Output:**
- `dist/` directory ready to load in Chrome
- Automatic manifest processing
- Hot Module Replacement (HMR) in dev mode

---

## Chrome Storage

### Storage API Wrapper

**Location:** `src/utils/storage.ts` (168 lines)

### Architecture

```typescript
// Low-level generic helpers
getFromStorage<K>(key: K): Promise<StorageData[K] | null>
setInStorage<K>(key: K, value: StorageData[K]): Promise<void>

// High-level specific helpers
getOpenAIKey(): Promise<string>
setOpenAIKey(key: string): Promise<void>
getCachedCards(): Promise<CreditCard[]>
setCachedCards(cards: CreditCard[]): Promise<void>
areCachedCardsStale(): Promise<boolean>
```

### Type Definitions

```typescript
// src/types/index.ts
export interface StorageData {
  openaiKey?: string;
  cachedCards?: CreditCard[];
  latestRecommendation?: string;
  lastCardsFetch?: number;  // Timestamp
}
```

### Generic Storage Helpers

**Get from Storage:**
```typescript
async function getFromStorage<K extends keyof StorageData>(
  key: K
): Promise<StorageData[K] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] ?? null);
    });
  });
}
```

**Benefits:**
- ✅ Type-safe keys (only `StorageData` keys allowed)
- ✅ Type-safe values (return type inferred from key)
- ✅ Promise-based (async/await support)
- ✅ Null handling (returns `null` if missing)

**Example:**
```typescript
// ✅ Type-safe
const apiKey = await getFromStorage('openaiKey');  // string | null
const cards = await getFromStorage('cachedCards');  // CreditCard[] | null

// ❌ TypeScript error
const invalid = await getFromStorage('nonExistentKey');  // Error!
```

---

**Set in Storage:**
```typescript
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

**Example:**
```typescript
// ✅ Type-safe
await setInStorage('openaiKey', 'sk-abc123');
await setInStorage('cachedCards', [{ id: '1', name: 'Chase' }]);

// ❌ TypeScript error
await setInStorage('openaiKey', 123);  // Error: not a string!
```

### OpenAI API Key Storage

```typescript
export async function getOpenAIKey(): Promise<string> {
  const key = await getFromStorage('openaiKey');
  return key || '';
}

export async function setOpenAIKey(key: string): Promise<void> {
  await setInStorage('openaiKey', key);
}

export function validateOpenAIKey(key: string): boolean {
  return key.startsWith('sk-') && key.length > 20;
}
```

**Usage:**
```typescript
// In SettingsModal.tsx
const handleSave = async () => {
  if (!validateOpenAIKey(apiKey)) {
    setError('Invalid API key format. Key must start with "sk-"');
    return;
  }

  await setOpenAIKey(apiKey);
};
```

### Card Caching Functions

```typescript
export async function getCachedCards(): Promise<CreditCard[]> {
  const cards = await getFromStorage('cachedCards');
  return cards || [];
}

export async function setCachedCards(cards: CreditCard[]): Promise<void> {
  await setInStorage('cachedCards', cards);
  await setInStorage('lastCardsFetch', Date.now());  // Update timestamp
}

export async function areCachedCardsStale(): Promise<boolean> {
  const lastFetch = await getFromStorage('lastCardsFetch');
  if (!lastFetch) return true;

  const ONE_HOUR = 60 * 60 * 1000;
  return Date.now() - lastFetch > ONE_HOUR;
}
```

**Cache Flow:**
```
Request cards
   ↓
Check lastCardsFetch
   ↓
< 1 hour old? → Return cached
≥ 1 hour old? → Fetch from Supabase → Cache → Return
```

### Utility Functions

**Clear All Storage:**
```typescript
export async function clearAllStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      resolve();
    });
  });
}
```

**Get All Data (Debugging):**
```typescript
export async function getAllStorageData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result) => {
      resolve(result as StorageData);
    });
  });
}
```

**Storage Quota Info:**
```typescript
export async function getStorageInfo(): Promise<{
  bytesInUse: number;
  quotaBytes: number;
  percentUsed: number;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      const quotaBytes = chrome.storage.local.QUOTA_BYTES;
      const percentUsed = (bytesInUse / quotaBytes) * 100;

      resolve({ bytesInUse, quotaBytes, percentUsed });
    });
  });
}
```

**Export/Import Settings:**
```typescript
export async function exportSettings(): Promise<string> {
  const data = await getAllStorageData();
  return JSON.stringify(data, null, 2);
}

export async function importSettings(jsonString: string): Promise<void> {
  try {
    const data = JSON.parse(jsonString);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}
```

### Storage Limits

**Chrome Extension Limits:**
- `chrome.storage.local`: **10 MB** (10,485,760 bytes)
- `chrome.storage.sync`: 100 KB (not used)
- `chrome.storage.session`: In-memory only

**Current Usage:**
- OpenAI key: ~100 bytes
- Cached cards (3 cards): ~3-5 KB
- Total: < 10 KB (0.1% of quota)

---

## Build System (Vite)

### Configuration File

**Location:** `vite.config.ts` (20 lines)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  build: {
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html'
      }
    }
  }
})
```

### Key Components

**1. React Plugin**
```typescript
react()
```
- Transforms JSX → JavaScript
- Fast Refresh (HMR) in dev mode
- Optimized production builds

**2. CRX Plugin**
```typescript
crx({ manifest })
```
- **What it does:**
  - Reads `manifest.json`
  - Bundles all extension files
  - Processes TypeScript → JavaScript
  - Handles content scripts, background workers, popup
  - Copies assets to `dist/`

- **Key Features:**
  - ✅ Auto-reload extension on changes (dev mode)
  - ✅ Manifest V3 support
  - ✅ Code splitting
  - ✅ Tree shaking
  - ✅ Source maps

**3. Build Options**
```typescript
build: {
  rollupOptions: {
    input: {
      popup: 'src/popup/index.html'
    }
  }
}
```
- Specifies entry points
- Popup HTML is the main entry

### Build Output Structure

```
dist/
├── manifest.json                    # Processed manifest
├── assets/
│   ├── index.ts-BQeXNPZ1.js        # Content script (bundled)
│   ├── index.ts-D8RjQgkH.js        # Background script (bundled)
│   ├── index-CjwUQsxv.js           # Popup JS (bundled)
│   └── index-BXyZ8vGj.css          # Popup CSS (bundled)
├── index.html                       # Popup HTML
└── public/
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

**File Name Hashing:**
- `index-BQeXNPZ1.js` - Hash changes when content changes
- Prevents browser caching old versions

### Vite Features

**Development:**
- **HMR (Hot Module Replacement)** - Instant updates without refresh
- **Fast startup** - ESBuild-powered
- **Source maps** - Debug original TypeScript

**Production:**
- **Tree shaking** - Remove unused code
- **Minification** - Smaller bundle size
- **Code splitting** - Separate chunks for efficiency
- **Asset optimization** - Compress images, CSS

---

## Manifest V3

### Manifest File

**Location:** `manifest.json` (38 lines)

```json
{
  "manifest_version": 3,
  "name": "Credit Card Recommender",
  "version": "2.0.0",
  "description": "AI-powered credit card recommendations for online shopping",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_icon": {
      "16": "public/icons/icon16.png",
      "48": "public/icons/icon48.png",
      "128": "public/icons/icon128.png"
    }
  },
  "icons": {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"]
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["assets/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### Key Sections

**1. Permissions**
```json
"permissions": ["activeTab", "storage", "scripting"]
```

- `activeTab` - Access current tab URL, inject scripts
- `storage` - Use chrome.storage.local
- `scripting` - Execute scripts with chrome.scripting API

**2. Host Permissions**
```json
"host_permissions": ["<all_urls>"]
```

- Access all websites for cart extraction
- Required for content script injection

**3. Background Service Worker**
```json
"background": {
  "service_worker": "src/background/index.ts",
  "type": "module"
}
```

- Runs in background (event-driven)
- `type: "module"` enables ES modules
- Currently minimal (placeholder)

**4. Action (Popup)**
```json
"action": {
  "default_popup": "src/popup/index.html",
  "default_icon": {...}
}
```

- Popup shown when clicking extension icon
- Icons for different sizes (16px, 48px, 128px)

**5. Content Scripts**
```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["src/content/index.ts"]
  }
]
```

- **Auto-injected** into all pages matching `<all_urls>`
- Runs in page context (can access DOM)
- Bundled by @crxjs to `assets/index.ts-*.js`

**6. Web Accessible Resources**
```json
"web_accessible_resources": [
  {
    "resources": ["assets/*"],
    "matches": ["<all_urls>"]
  }
]
```

- Allows pages to load bundled assets
- Required for content script bundles

---

## TypeScript Configuration

### tsconfig.app.json

**Location:** `tsconfig.app.json` (27 lines)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client", "chrome"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": false,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### Key Options

**1. Target & Module**
```json
"target": "ES2022",
"module": "ESNext"
```
- Modern JavaScript features
- Native async/await, optional chaining, etc.

**2. Types**
```json
"types": ["vite/client", "chrome"]
```
- `vite/client` - Vite-specific types (import.meta.env)
- `chrome` - Chrome extension APIs (@types/chrome)

**3. JSX**
```json
"jsx": "react-jsx"
```
- Modern React transform (no `import React` needed)

**4. Strict Mode**
```json
"strict": true
```
- All strict type-checking enabled
- Catches more errors at compile time

**5. Relaxed Linting**
```json
"noUnusedLocals": false,
"noUnusedParameters": false
```
- Disabled for development convenience
- Re-enable for production builds

**6. Bundler Mode**
```json
"moduleResolution": "bundler",
"allowImportingTsExtensions": true
```
- Allows importing `.ts` files directly
- Vite handles transformation

---

## Dependencies

### package.json

**Location:** `package.json` (39 lines)

### Production Dependencies

```json
{
  "@crxjs/vite-plugin": "^2.2.0",      // Chrome extension bundler
  "@supabase/supabase-js": "^2.58.0",  // Database client
  "@tanstack/react-query": "^5.90.2",  // Data fetching (future)
  "@types/chrome": "^0.1.16",          // Chrome API types
  "react": "^19.1.1",                  // UI framework
  "react-dom": "^19.1.1",              // React DOM renderer
  "zustand": "^5.0.8"                  // State management
}
```

### Development Dependencies

```json
{
  "@vitejs/plugin-react": "^5.0.3",   // React support for Vite
  "autoprefixer": "^10.4.21",         // CSS vendor prefixes
  "postcss": "^8.5.6",                // CSS processing
  "tailwindcss": "^3.4.18",           // Utility-first CSS
  "typescript": "~5.8.3",             // TypeScript compiler
  "vite": "^7.1.7"                    // Build tool
}
```

### Scripts

```json
{
  "dev": "vite",                      // Development server
  "build": "tsc -b && vite build",    // Production build
  "lint": "eslint .",                 // Code linting
  "preview": "vite preview"           // Preview production build
}
```

### Version Constraints

- `^2.2.0` - Compatible with 2.x (up to 3.0.0)
- `~5.8.3` - Compatible with 5.8.x only

---

## Development Workflow

### Setup

```bash
cd extension-v2/

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Add Supabase credentials

# Start development
npm run dev
```

### Development Mode

```bash
npm run dev
```

**What happens:**
1. Vite starts dev server
2. Builds extension to `dist/`
3. Watches for file changes
4. Hot reloads on save

**Load in Chrome:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension-v2/dist/` directory

### Making Changes

**1. Edit Source Files:**
```bash
src/
├── components/MyComponent.tsx  # Edit component
├── services/api.ts             # Edit API logic
└── styles/globals.css          # Edit styles
```

**2. Automatic Rebuild:**
- Vite detects changes
- Rebuilds affected files
- Extension reloads automatically (dev mode)

**3. Manual Reload (if needed):**
- Go to `chrome://extensions/`
- Click reload button (↻) on extension card

**4. Refresh Test Page:**
- F5 on website you're testing
- Content script gets re-injected

### Debugging

**Popup:**
1. Click extension icon
2. Right-click popup → "Inspect"
3. Opens DevTools for popup

**Content Script:**
1. Open DevTools on test page (F12)
2. Go to Console tab
3. View logs from content script

**Background Script:**
1. Go to `chrome://extensions/`
2. Click "service worker" link
3. Opens DevTools for background

---

## Build Process

### Production Build

```bash
npm run build
```

**Steps:**
1. `tsc -b` - TypeScript compilation (type-checking)
2. `vite build` - Bundle and optimize
3. Output to `dist/`

**Output:**
```
dist/
├── manifest.json
├── assets/
│   ├── index.ts-[hash].js  (content script)
│   ├── index.ts-[hash].js  (background)
│   ├── index-[hash].js     (popup JS)
│   └── index-[hash].css    (popup CSS)
├── index.html
└── public/
```

**Bundle Sizes:**
- Content script: ~150KB (~45KB gzipped)
- Background script: ~10KB (~3KB gzipped)
- Popup JS: ~180KB (~55KB gzipped)
- Popup CSS: ~25KB (~5KB gzipped)
- **Total: ~365KB (~108KB gzipped)**

### Loading Production Build

```bash
# Build
npm run build

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Load unpacked → select dist/
```

### Build Optimizations

**Vite automatically:**
- ✅ Minifies JavaScript (Terser)
- ✅ Minifies CSS
- ✅ Tree-shakes unused code
- ✅ Compresses with gzip
- ✅ Generates source maps (for debugging)
- ✅ Optimizes images

**Manual optimizations:**
- Use dynamic imports for code splitting
- Lazy load components: `React.lazy(() => import('./MyComponent'))`
- Remove unused dependencies

---

## Environment Variables

### .env File

**Location:** `extension-v2/.env`

```env
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Backend API (optional)
VITE_BACKEND_API_URL=http://localhost:3000
```

### Accessing in Code

```typescript
// Vite automatically exposes VITE_* variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

### Important Notes

1. **Prefix with `VITE_`** - Required for Vite to expose
2. **Never commit `.env`** - Add to `.gitignore`
3. **Provide `.env.example`** - Template for others
4. **Rebuild after changes** - Environment vars baked into bundle

### .env.example

```env
# Supabase credentials (get from https://app.supabase.com)
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Optional: Backend API URL
VITE_BACKEND_API_URL=http://localhost:3000
```

---

## Best Practices

### Chrome Storage

1. **Always use type-safe helpers** - Avoid direct `chrome.storage` calls
2. **Handle null/undefined** - Storage may be empty
3. **Cache aggressively** - Reduce API calls
4. **Monitor quota** - Alert users when approaching 10MB limit
5. **Clear on logout** - Don't persist sensitive data

### Build System

1. **Use environment variables** - Don't hardcode credentials
2. **Test production builds** - `npm run build` before deploying
3. **Keep dependencies updated** - `npm outdated` to check
4. **Minimize bundle size** - Remove unused dependencies
5. **Use code splitting** - Dynamic imports for large components

### TypeScript

1. **Enable strict mode** - Catch more errors
2. **Define all types** - Avoid `any`
3. **Use interface for props** - Better documentation
4. **Type storage data** - Use `StorageData` interface
5. **Check chrome.runtime.lastError** - Handle storage errors

### Manifest

1. **Minimal permissions** - Only request what's needed
2. **Specific host permissions** - Avoid `<all_urls>` if possible (we need it)
3. **Version consistently** - Follow semantic versioning
4. **Test all entry points** - Popup, content, background

---

## Troubleshooting

### Issue: "chrome is not defined"

**Cause:** Missing `@types/chrome` or not included in tsconfig

**Solution:**
```bash
npm install @types/chrome
```

```json
// tsconfig.app.json
"types": ["vite/client", "chrome"]
```

---

### Issue: "import.meta.env is undefined"

**Cause:** Environment variable not prefixed with `VITE_`

**Solution:**
```env
# ❌ Wrong
SUPABASE_URL=...

# ✅ Correct
VITE_SUPABASE_URL=...
```

Rebuild: `npm run build`

---

### Issue: Content script not injected

**Cause:** Manifest paths incorrect or not rebuilt

**Solution:**
1. Check `manifest.json`:
   ```json
   "content_scripts": [
     { "js": ["src/content/index.ts"] }
   ]
   ```

2. Rebuild: `npm run build`
3. Reload extension in Chrome
4. Refresh test page (F5)

---

### Issue: Build fails with TypeScript errors

**Cause:** Type errors in code

**Solution:**
```bash
# Check errors
npm run build

# Fix errors or temporarily relax
# tsconfig.app.json
"strict": false,
"noUnusedLocals": false
```

---

### Issue: Storage quota exceeded

**Cause:** Too much data in chrome.storage.local (>10MB)

**Check:**
```typescript
const info = await getStorageInfo();
console.log(`${info.percentUsed.toFixed(2)}% used`);
```

**Solution:**
```typescript
// Clear all storage
await clearAllStorage();

// Or clear specific keys
await setInStorage('cachedCards', []);
```

---

### Issue: HMR not working in dev mode

**Cause:** Extension doesn't support HMR like web apps

**Workaround:**
- Manually reload extension (chrome://extensions/)
- Refresh test page (F5)
- Use `npm run build` + reload for major changes

---

### Debugging Tips

**1. Check Build Output:**
```bash
npm run build
ls -lah dist/
```

**2. Inspect Manifest:**
```bash
cat dist/manifest.json
```

**3. Check Storage:**
```typescript
const data = await getAllStorageData();
console.log('Storage:', data);
```

**4. Monitor Bundle Size:**
```bash
npm run build
du -sh dist/
```

**5. Test Production Build:**
```bash
npm run build
# Load dist/ in Chrome
```

---

## Summary

The storage and build system provides:

- ✅ **Type-safe Chrome storage** - TypeScript wrappers
- ✅ **Modern build system** - Vite 7 with HMR
- ✅ **Chrome Extension bundling** - @crxjs/vite-plugin
- ✅ **Manifest V3** - Latest Chrome extension format
- ✅ **Caching** - 1-hour TTL for performance
- ✅ **Environment variables** - Secure credential management
- ✅ **Production-ready** - Optimized bundles

**Key Files:**
- Storage: `src/utils/storage.ts`
- Build config: `vite.config.ts`
- Manifest: `manifest.json`
- TypeScript: `tsconfig.app.json`
- Dependencies: `package.json`

**Commands:**
```bash
npm install          # Install dependencies
npm run dev          # Development mode
npm run build        # Production build
npm run lint         # Check code quality
```

**Bundle Size:** ~365KB (~108KB gzipped)

---

*Last updated: October 2024*
*Part of extension-v2 documentation suite - see `CLAUDE.md` for navigation*
