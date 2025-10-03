# UI Components Documentation

**Complete guide to React UI architecture, components, and state management**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Component Hierarchy](#component-hierarchy)
4. [State Management (Zustand)](#state-management-zustand)
5. [Core Components](#core-components)
   - [Popup.tsx - Main Orchestrator](#popuptsx---main-orchestrator)
   - [CartItemsList.tsx - Cart Display (NEW)](#cartitemslisttsx---cart-display-new)
   - [RecommendationCard.tsx](#recommendationcardtsx)
   - [SettingsModal.tsx](#settingsmodaltsx)
   - [LoadingState.tsx](#loadingstatetsx)
   - [ErrorBoundary.tsx](#errorboundarytsx)
6. [Type Definitions](#type-definitions)
7. [Styling System](#styling-system)
8. [Data Flow](#data-flow)
9. [Adding New UI Features](#adding-new-ui-features)
10. [Best Practices](#best-practices)
11. [Integration Points](#integration-points)
12. [Troubleshooting](#troubleshooting)

---

## Overview

The extension uses **React 19** with **TypeScript 5.8** for a modern, type-safe UI. State management is handled by **Zustand 5**, providing a lightweight yet powerful global state solution. All components use **Tailwind CSS 3.4** for consistent styling.

**Key Features:**
- 🎨 Modern React functional components with hooks
- 📦 Centralized state management with Zustand
- 🎭 Loading states (spinner/skeleton)
- 🛡️ Error boundaries for graceful failure
- 🎯 Type-safe props and state
- 📱 Responsive design with Tailwind CSS
- ✨ Smooth animations and transitions

**Bundle Size:** ~367KB (~109KB gzipped)

---

## Architecture

### Tech Stack

```
React 19                 → UI framework
TypeScript 5.8           → Type safety
Zustand 5                → State management
Tailwind CSS 3.4         → Styling
Vite 7                   → Build system
@crxjs/vite-plugin       → Chrome extension bundling
```

### Design Principles

1. **Single Responsibility:** Each component has one clear purpose
2. **Composition:** Build complex UIs from simple components
3. **Type Safety:** All props and state are strongly typed
4. **Separation of Concerns:** UI logic separate from business logic
5. **Reusability:** Components designed for multiple contexts

---

## Component Hierarchy

```
Popup.tsx (Root - orchestrates all flow)
├── ErrorBoundary
│   └── Wraps entire app for error catching
├── Header Section
│   ├── Logo + Title
│   └── Settings Button → Opens SettingsModal
├── Content Section (conditional rendering)
│   ├── LoadingState (when isLoading = true)
│   │   ├── variant="spinner" (default)
│   │   └── variant="skeleton" (card-like placeholder)
│   ├── Error Display (when error !== null)
│   │   ├── Error icon + message
│   │   └── Configure API Key button (if !hasApiKey)
│   ├── Success State (when recommendation !== null)
│   │   ├── CartItemsList (NEW - displays extracted items)
│   │   │   ├── Item list (first 5 always visible)
│   │   │   ├── Expand/collapse for 6+ items
│   │   │   └── Total calculation
│   │   ├── RecommendationCard
│   │   │   ├── Best Card title
│   │   │   ├── Rewards breakdown
│   │   │   └── Merchant + Category info
│   │   └── Refresh Recommendation button
│   └── Initial State (default)
│       ├── Shopping cart icon
│       ├── Descriptive text
│       └── "Get Recommendation" button
└── SettingsModal (overlay when showSettings = true)
    ├── Modal backdrop
    ├── API key input (password/text toggle)
    ├── Validation feedback
    └── Save/Cancel actions
```

---

## State Management (Zustand)

### Store Structure

**File:** `src/store/useStore.ts`

```typescript
interface AppState {
  // State
  apiKey: string;                          // OpenAI API key
  cards: CreditCard[];                     // Active credit cards
  recommendation: Recommendation | null;    // Current recommendation
  cartItems: CartItem[] | null;            // Extracted cart items (NEW)
  isLoading: boolean;                      // Loading state
  error: string | null;                    // Error message
  showSettings: boolean;                   // Settings modal visibility

  // Actions
  setApiKey: (key: string) => void;
  setCards: (cards: CreditCard[]) => void;
  setRecommendation: (rec: Recommendation | null) => void;
  setCartItems: (items: CartItem[] | null) => void;  // NEW
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setShowSettings: (show: boolean) => void;
  reset: () => void;                       // Reset to initial state
}
```

### Initial State

```typescript
const initialState = {
  apiKey: '',
  cards: [],
  recommendation: null,
  cartItems: null,        // NEW
  isLoading: false,
  error: null,
  showSettings: false,
};
```

### Usage Pattern

```typescript
// In any component
import { useStore } from '../store/useStore';

const MyComponent = () => {
  const { recommendation, setRecommendation } = useStore();

  const handleClick = () => {
    setRecommendation({ card: 'Chase Sapphire', ... });
  };

  return <div>{recommendation?.card}</div>;
};
```

### Why Zustand?

- ✅ **Minimal boilerplate** - No providers, no reducers
- ✅ **TypeScript-first** - Full type inference
- ✅ **Small bundle size** - ~1KB gzipped
- ✅ **React hooks integration** - Works seamlessly with hooks
- ✅ **Devtools support** - Chrome extension debugging

---

## Core Components

### Popup.tsx - Main Orchestrator

**Location:** `src/popup/Popup.tsx` (310 lines)

**Purpose:** Main component that orchestrates the entire recommendation flow. Manages API key checking, cart extraction, recommendation fetching, and UI state transitions.

#### Key Responsibilities

1. **API Key Management** - Check on mount, validate before actions
2. **Content Script Communication** - Retry loop for script readiness
3. **Cart Extraction** - Execute `window.__CC_extractCartItems()` in page
4. **Recommendation Flow** - Fetch cards → Get recommendation → Display
5. **Banner Creation** - Inject on-page banner with recommendation
6. **UI State Orchestration** - Loading, error, success, initial states

#### State & Hooks

```typescript
const {
  recommendation,
  cartItems,        // NEW
  isLoading,
  error,
  showSettings,
  setRecommendation,
  setCartItems,     // NEW
  setLoading,
  setError,
  setShowSettings,
} = useStore();

const [hasApiKey, setHasApiKey] = useState(false);
```

#### Core Function: handleGetRecommendation

```typescript
const handleGetRecommendation = async () => {
  setLoading(true);
  setError(null);
  setCartItems(null);  // Clear previous cart items

  try {
    // 1. Validate API key
    const apiKey = await getOpenAIKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // 2. Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error('No active tab found');
    }

    const site = new URL(tab.url).hostname;

    // 3. Wait for content script (retry loop: 5 × 200ms)
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => typeof (window as any).__CC_extractCartItems === 'function',
      });

      if (checkResults[0]?.result) {
        break; // Content script ready
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
      retries++;
    }

    if (retries === maxRetries) {
      throw new Error('Content script not loaded. Try refreshing the page.');
    }

    // 4. Extract cart items
    const cartResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window as any).__CC_extractCartItems?.() || [],
    });

    const extractedItems: CartItem[] = cartResults[0]?.result || [];

    if (extractedItems.length === 0) {
      setError('No cart items found on this page. Try visiting a shopping cart or checkout page.');
      setLoading(false);
      return;
    }

    // 5. Store cart items (NEW)
    setCartItems(extractedItems);

    // 6. Get recommendation
    const rec = await cardAPI.getRecommendation(extractedItems, site, apiKey);
    setRecommendation(rec);

    // 7. Create on-page banner
    const bannerHtml = createBannerHtml(rec);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (html: string) => {
        (window as any).__CC_createBanner?.(html);
      },
      args: [bannerHtml],
    });
  } catch (err) {
    console.error('Error getting recommendation:', err);
    setError(err instanceof Error ? err.message : 'Failed to get recommendation');
    setCartItems(null);  // Clear on error
  } finally {
    setLoading(false);
  }
};
```

#### Conditional Rendering Logic

```typescript
<div className="p-4">
  {isLoading ? (
    <LoadingState message="Analyzing your cart..." variant="skeleton" />
  ) : error ? (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      {/* Error display */}
    </div>
  ) : recommendation ? (
    <>
      {/* NEW: Display cart items if available */}
      {cartItems && cartItems.length > 0 && (
        <div className="mb-4">
          <CartItemsList items={cartItems} />
        </div>
      )}
      <RecommendationCard recommendation={recommendation} />
    </>
  ) : (
    <div className="text-center py-8">
      {/* Initial state with "Get Recommendation" button */}
    </div>
  )}
</div>
```

---

### CartItemsList.tsx - Cart Display (NEW)

**Location:** `src/components/CartItemsList.tsx` (140 lines)

**Purpose:** Display extracted cart items with expandable UI, price parsing, and total calculation. Added in October 2024 to provide users visibility into what the AI analyzes.

#### Features

- ✅ **Always shows first 5 items** - Prevents UI overflow
- ✅ **Expandable list** - "Show X more items" button for 6+ items
- ✅ **Price parsing** - Extracts numeric values from various formats
- ✅ **Total calculation** - Automatic sum with partial total support
- ✅ **Responsive design** - Works in small popup window
- ✅ **Consistent styling** - Matches app theme

#### Props

```typescript
interface CartItemsListProps {
  items: CartItem[];  // Array of extracted cart items
}
```

#### Internal State

```typescript
const [expanded, setExpanded] = useState(false);

const visibleItems = expanded ? items : items.slice(0, 5);
const hiddenCount = items.length - 5;
const hasMore = items.length > 5;
```

#### Price Parsing Logic

```typescript
const parsePrice = (price?: string): number => {
  if (!price) return 0;

  // Match numeric patterns: $123.45, 123,45, 123.45
  const match = price.match(/[\d,.]+/);
  if (!match) return 0;

  // Remove commas and parse float
  return parseFloat(match[0].replace(/,/g, ''));
};
```

#### Total Calculation

```typescript
const itemsWithPrices = items.filter((item) => item.price);
const total = items.reduce((sum, item) => sum + parsePrice(item.price), 0);
const hasTotal = total > 0;
const isPartialTotal = hasTotal && itemsWithPrices.length < items.length;
```

#### UI Structure

```typescript
return (
  <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 animate-fade-in">
    {/* Header with cart icon */}
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-primary-500">{/* Shopping cart icon */}</svg>
        <h3 className="text-sm font-medium text-gray-500">
          Cart Items ({items.length})
        </h3>
      </div>
    </div>

    {/* Items List */}
    <div className="space-y-2 mb-3">
      {visibleItems.map((item, index) => (
        <div key={index} className="flex items-start justify-between text-sm">
          <span className="text-gray-700 flex-1 pr-2">{item.name}</span>
          {item.price && (
            <span className="text-gray-900 font-medium whitespace-nowrap">
              {item.price}
            </span>
          )}
        </div>
      ))}
    </div>

    {/* Expand/Collapse Button (only if 6+ items) */}
    {hasMore && (
      <button onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : `Show ${hiddenCount} more item${hiddenCount !== 1 ? 's' : ''}`}
      </button>
    )}

    {/* Total Section */}
    {hasTotal && (
      <div className="border-t border-gray-200 pt-3 mt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">
            Total{isPartialTotal && ' (partial)'}
          </span>
          <span className="text-base font-bold text-primary-700">
            ${total.toFixed(2)}
          </span>
        </div>
        {isPartialTotal && (
          <p className="text-xs text-gray-400 mt-1">Some items missing prices</p>
        )}
      </div>
    )}
  </div>
);
```

#### Integration with Popup

```typescript
// In Popup.tsx:

// 1. Extract and store items
const extractedItems: CartItem[] = cartResults[0]?.result || [];
setCartItems(extractedItems);

// 2. Display alongside recommendation
{cartItems && cartItems.length > 0 && (
  <div className="mb-4">
    <CartItemsList items={cartItems} />
  </div>
)}
<RecommendationCard recommendation={recommendation} />
```

---

### RecommendationCard.tsx

**Location:** `src/components/RecommendationCard.tsx` (109 lines)

**Purpose:** Display AI-powered credit card recommendation with rewards breakdown, merchant, and category information.

#### Props

```typescript
interface RecommendationCardProps {
  recommendation: Recommendation;
}
```

#### Recommendation Type

```typescript
interface Recommendation {
  card: string;                    // "Chase Sapphire Preferred"
  rewards: {
    [category: string]: string;    // {"groceries": "5% cashback"}
  };
  merchant: string;                // "sephora.com"
  category: string;                // "beauty & cosmetics"
}
```

#### UI Structure

```typescript
return (
  <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 animate-fade-in">
    {/* Header: Card Icon + Best Card Title */}
    <div className="flex items-start justify-between mb-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-5 h-5 text-primary-500">{/* Credit card icon */}</svg>
          <h3 className="text-sm font-medium text-gray-500">Best Card</h3>
        </div>
        <h2 className="text-xl font-bold text-gray-900">{recommendation.card}</h2>
      </div>
    </div>

    {/* Rewards Section with gradient background */}
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Rewards
      </h4>
      <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-md p-3 space-y-1.5">
        {Object.entries(recommendation.rewards).map(([category, value]) => (
          <div key={category} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 capitalize">
              {category}
            </span>
            <span className="text-sm font-bold text-primary-700">{value}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Merchant & Category Info */}
    <div className="space-y-2 border-t border-gray-200 pt-3">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-gray-400">{/* Home icon */}</svg>
        <div className="flex-1">
          <p className="text-xs text-gray-500">Merchant</p>
          <p className="text-sm text-gray-900 font-medium">{recommendation.merchant}</p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-gray-400">{/* Tag icon */}</svg>
        <div className="flex-1">
          <p className="text-xs text-gray-500">Category</p>
          <p className="text-sm text-gray-900 font-medium capitalize">
            {recommendation.category}
          </p>
        </div>
      </div>
    </div>

    {/* Footer Note */}
    <div className="mt-4 pt-3 border-t border-gray-100">
      <p className="text-xs text-gray-400 text-center">
        AI-powered recommendation based on your cart
      </p>
    </div>
  </div>
);
```

---

### SettingsModal.tsx

**Location:** `src/components/SettingsModal.tsx` (232 lines)

**Purpose:** Modal overlay for OpenAI API key configuration with validation, persistence, and user feedback.

#### Props

```typescript
interface SettingsModalProps {
  isOpen: boolean;      // Modal visibility
  onClose: () => void;  // Close callback
}
```

#### Internal State

```typescript
const [apiKey, setApiKeyState] = useState('');
const [showKey, setShowKey] = useState(false);  // Password visibility toggle
const [isSaving, setIsSaving] = useState(false);
const [saveStatus, setSaveStatus] = useState<{
  type: 'success' | 'error' | null;
  message: string;
}>({ type: null, message: '' });
```

#### Key Functions

**Load API Key on Open:**
```typescript
useEffect(() => {
  if (isOpen) {
    loadApiKey();
    setSaveStatus({ type: null, message: '' });
  }
}, [isOpen]);

const loadApiKey = async () => {
  try {
    const key = await getOpenAIKey();
    setApiKeyState(key);
  } catch (error) {
    console.error('Error loading API key:', error);
  }
};
```

**Save with Validation:**
```typescript
const handleSave = async () => {
  // 1. Check if empty
  if (!apiKey.trim()) {
    setSaveStatus({
      type: 'error',
      message: 'Please enter an API key',
    });
    return;
  }

  // 2. Validate format (must start with "sk-")
  if (!validateOpenAIKey(apiKey)) {
    setSaveStatus({
      type: 'error',
      message: 'Invalid API key format. Key must start with "sk-"',
    });
    return;
  }

  // 3. Save to chrome.storage.local
  setIsSaving(true);
  try {
    await setOpenAIKey(apiKey);
    setSaveStatus({
      type: 'success',
      message: 'API key saved successfully!',
    });

    // Close after 1 second
    setTimeout(() => {
      onClose();
    }, 1000);
  } catch (error) {
    console.error('Error saving API key:', error);
    setSaveStatus({
      type: 'error',
      message: 'Failed to save API key',
    });
  } finally {
    setIsSaving(false);
  }
};
```

**Close on Backdrop Click:**
```typescript
const handleBackdropClick = (e: React.MouseEvent) => {
  if (e.target === e.currentTarget) {
    handleCancel();
  }
};
```

#### UI Structure

```typescript
return (
  <div className="modal-backdrop animate-fade-in" onClick={handleBackdropClick}>
    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 animate-fade-in">
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Settings</h2>
        <button onClick={handleCancel}>{/* X icon */}</button>
      </div>

      {/* Content: API Key Input */}
      <div className="mb-6">
        <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-2">
          OpenAI API Key
        </label>

        <div className="relative">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKeyState(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {/* Show/hide password toggle button */}
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            {showKey ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Your API key is stored locally and never sent to our servers.{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" className="text-primary-600 hover:text-primary-700 underline">
            Get your key
          </a>
        </p>

        {/* Status Message (success/error) */}
        {saveStatus.message && (
          <div className={`mt-3 p-3 rounded-md text-sm ${
            saveStatus.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {saveStatus.message}
          </div>
        )}
      </div>

      {/* Actions: Cancel + Save */}
      <div className="flex gap-3">
        <button onClick={handleCancel} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  </div>
);
```

---

### LoadingState.tsx

**Location:** `src/components/LoadingState.tsx` (58 lines)

**Purpose:** Reusable loading indicator with two variants: spinner and skeleton.

#### Props

```typescript
interface LoadingStateProps {
  message?: string;               // Loading message (default: "Loading...")
  variant?: 'spinner' | 'skeleton';  // UI variant (default: "spinner")
}
```

#### Variants

**Spinner Variant:**
```typescript
<div className="flex flex-col items-center justify-center p-8 animate-fade-in">
  {/* Animated spinner */}
  <div className="relative">
    <div className="w-12 h-12 rounded-full border-4 border-gray-200"></div>
    <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
  </div>

  {/* Message */}
  <p className="mt-4 text-sm text-gray-600 font-medium">{message}</p>
  <p className="mt-1 text-xs text-gray-400">This may take a few seconds</p>
</div>
```

**Skeleton Variant (Recommendation Card Placeholder):**
```typescript
<div className="animate-fade-in p-4">
  <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
    {/* Title skeleton */}
    <div className="h-6 bg-gray-200 rounded w-3/4 mb-4 animate-pulse"></div>

    {/* Content skeleton */}
    <div className="space-y-3">
      <div className="h-4 bg-gray-200 rounded w-full animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded w-5/6 animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded w-4/6 animate-pulse"></div>
    </div>

    {/* Rewards skeleton */}
    <div className="mt-4 space-y-2">
      <div className="h-3 bg-gray-200 rounded w-2/3 animate-pulse"></div>
      <div className="h-3 bg-gray-200 rounded w-1/2 animate-pulse"></div>
    </div>
  </div>
</div>
```

#### Usage in Popup

```typescript
{isLoading && (
  <LoadingState message="Analyzing your cart..." variant="skeleton" />
)}
```

---

### ErrorBoundary.tsx

**Location:** `src/components/ErrorBoundary.tsx` (114 lines)

**Purpose:** React error boundary to catch component errors and display graceful fallback UI with retry functionality.

#### Props & State

```typescript
interface Props {
  children: ReactNode;  // Wrapped components
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}
```

#### Lifecycle Methods

```typescript
// Catch errors during rendering
static getDerivedStateFromError(error: Error): Partial<State> {
  return { hasError: true, error };
}

// Log error details
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  console.error('Error caught by boundary:', error, errorInfo);
  this.setState({
    error,
    errorInfo,
  });
}
```

#### Retry Handler

```typescript
handleRetry = () => {
  this.setState({
    hasError: false,
    error: null,
    errorInfo: null,
  });
  // Reload the extension popup
  window.location.reload();
};
```

#### Fallback UI

```typescript
if (this.state.hasError) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
        {/* Error icon */}
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
          <svg className="w-6 h-6 text-red-600">{/* Warning icon */}</svg>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Something went wrong
        </h2>

        <p className="text-gray-600 text-center mb-4">
          The extension encountered an unexpected error.
        </p>

        {/* Error details */}
        {this.state.error && (
          <div className="bg-gray-50 rounded-md p-3 mb-4">
            <p className="text-sm font-mono text-red-600 break-words">
              {this.state.error.toString()}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={this.handleRetry} className="flex-1 bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 px-4 rounded transition-colors">
            Retry
          </button>
          <button onClick={/* Log details */} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded transition-colors">
            View Details
          </button>
        </div>
      </div>
    </div>
  );
}

return this.props.children;  // No error, render children
```

#### Usage

```typescript
// In popup/index.tsx
import ErrorBoundary from '../components/ErrorBoundary';
import Popup from './Popup';

<ErrorBoundary>
  <Popup />
</ErrorBoundary>
```

---

## Type Definitions

**Location:** `src/types/index.ts` (92 lines)

### Core Types

```typescript
export interface CreditCard {
  id?: string;
  name: string;
  annualFee: number;
  rewards: {
    [category: string]: string;  // {"groceries": "5% cashback"}
  };
  description: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CartItem {
  name: string;
  price?: string;
  quantity?: number;
  description?: string;
}

export interface Recommendation {
  card: string;
  rewards: {
    [category: string]: string;
  };
  merchant: string;
  category: string;
}
```

### API Types

```typescript
export interface RecommendationRequest {
  cartItems: CartItem[];
  site: string;
  cards: CreditCard[];
}

export interface APIResponse<T = any> {
  data?: T;
  error?: string;
  success: boolean;
}
```

### OpenAI Types

```typescript
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

### Chrome Storage Types

```typescript
export interface StorageData {
  openaiKey?: string;
  cachedCards?: CreditCard[];
  latestRecommendation?: string;
  lastCardsFetch?: number;  // Timestamp for cache invalidation
}
```

---

## Styling System

### Tailwind CSS Configuration

**File:** `tailwind.config.js`

```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          // ... full color scale
          500: '#3b82f6',  // Main brand color
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
```

### Global Styles

**File:** `src/styles/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom Component Classes */
@layer components {
  .btn-primary {
    @apply bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed;
  }

  .modal-backdrop {
    @apply fixed inset-0 bg-black/50 flex items-center justify-center z-50;
  }

  .animate-fade-in {
    animation: fadeIn 0.2s ease-in-out;
  }
}

/* Custom animations */
@keyframes fadeIn {
  0% {
    opacity: 0;
    transform: translateY(-10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

## Data Flow

### Complete User Flow

```
1. User clicks extension icon
   ↓
2. Popup.tsx renders
   ↓
3. useEffect: checkApiKey()
   → getOpenAIKey() from chrome.storage.local
   → setHasApiKey(!!key)
   ↓
4. User clicks "Get Recommendation"
   ↓
5. handleGetRecommendation() executes:
   a) setLoading(true)
   b) Validate API key
   c) Get active tab
   d) Wait for content script (retry loop)
   e) Execute window.__CC_extractCartItems()
   f) setCartItems(extractedItems) → NEW
   g) cardAPI.getRecommendation(items, site, apiKey)
   h) setRecommendation(rec)
   i) Create on-page banner
   ↓
6. Zustand store updates trigger re-renders:
   → CartItemsList displays (NEW)
   → RecommendationCard displays
   ↓
7. User sees results in popup + banner on page
```

### State Update Flow

```
Action Triggered
      ↓
Zustand Action Called (e.g., setCartItems)
      ↓
Store State Updated
      ↓
Components Re-render (via useStore hook)
      ↓
UI Updates
```

---

## Adding New UI Features

### Step-by-Step Guide

#### 1. Define Types (if needed)

```typescript
// src/types/index.ts
export interface MyNewFeature {
  id: string;
  data: string;
}
```

#### 2. Add State to Store

```typescript
// src/store/useStore.ts
interface AppState {
  // Add new state
  myFeature: MyNewFeature | null;

  // Add action
  setMyFeature: (feature: MyNewFeature | null) => void;
}

// Implement action
setMyFeature: (feature) => set({ myFeature: feature }),
```

#### 3. Create Component

```typescript
// src/components/MyFeatureComponent.tsx
import React from 'react';
import type { MyNewFeature } from '../types';

interface MyFeatureComponentProps {
  feature: MyNewFeature;
}

const MyFeatureComponent: React.FC<MyFeatureComponentProps> = ({ feature }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
      <h3 className="text-lg font-bold mb-2">My Feature</h3>
      <p>{feature.data}</p>
    </div>
  );
};

export default MyFeatureComponent;
```

#### 4. Integrate in Popup

```typescript
// src/popup/Popup.tsx
import MyFeatureComponent from '../components/MyFeatureComponent';

const Popup: React.FC = () => {
  const { myFeature } = useStore();

  return (
    <div>
      {/* ... other components */}
      {myFeature && <MyFeatureComponent feature={myFeature} />}
    </div>
  );
};
```

#### 5. Update Logic

```typescript
// In handleGetRecommendation or similar
const featureData = await fetchMyFeature();
setMyFeature(featureData);
```

---

## Best Practices

### Component Design

1. **Keep components small and focused** - Single Responsibility Principle
2. **Use TypeScript strictly** - No `any` types, define all props
3. **Extract reusable logic** - Use custom hooks for complex logic
4. **Handle all states** - Loading, error, empty, success
5. **Add proper keys** - For list items (use stable IDs when possible)

### State Management

1. **Minimal state in components** - Move shared state to Zustand
2. **Immutable updates** - Zustand handles this, but be aware
3. **Reset state appropriately** - Clear on logout, error, etc.
4. **Avoid prop drilling** - Use Zustand for deeply nested components

### Styling

1. **Use Tailwind utilities** - Avoid custom CSS when possible
2. **Follow design system** - Use primary colors, consistent spacing
3. **Responsive by default** - Test in different popup sizes
4. **Animations sparingly** - fade-in for new content, spinner for loading

### Error Handling

1. **Wrap with ErrorBoundary** - Catch rendering errors
2. **Try-catch async operations** - Handle network failures
3. **User-friendly messages** - No technical jargon
4. **Provide recovery options** - Retry buttons, refresh actions

### Performance

1. **Lazy load when needed** - React.lazy for large components
2. **Memoize expensive calculations** - useMemo, React.memo
3. **Debounce user input** - For search/filter functionality
4. **Optimize re-renders** - Check with React DevTools

---

## Integration Points

### With Content Script

```typescript
// Execute function in page context
const results = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => (window as any).__CC_extractCartItems(),
});
```

### With Chrome Storage

```typescript
// Import storage utilities
import { getOpenAIKey, setOpenAIKey } from '../utils/storage';

// Get data
const apiKey = await getOpenAIKey();

// Save data
await setOpenAIKey(apiKey);
```

### With API Service

```typescript
// Import API client
import { cardAPI } from '../services/api';

// Fetch cards
const cards = await cardAPI.getCards();

// Get recommendation
const rec = await cardAPI.getRecommendation(cartItems, site, apiKey);
```

### With Supabase

```typescript
// Import Supabase service
import { getActiveCards } from '../services/supabase';

// Fetch from database
const cards = await getActiveCards(forceRefresh);
```

---

## Troubleshooting

### Issue: Component not re-rendering when state changes

**Cause:** Not using Zustand hook properly

**Solution:**
```typescript
// ❌ Wrong
const store = useStore();
console.log(store.recommendation);

// ✅ Correct
const { recommendation } = useStore();
console.log(recommendation);
```

### Issue: "Cannot read property of undefined"

**Cause:** Component receiving undefined props

**Solution:** Add prop validation and default values
```typescript
interface MyProps {
  data?: MyType;  // Optional prop
}

const MyComponent: React.FC<MyProps> = ({ data }) => {
  if (!data) {
    return <LoadingState />;
  }

  return <div>{data.value}</div>;
};
```

### Issue: Styles not applying

**Cause:** Tailwind not detecting classes

**Solution:** Check `tailwind.config.js` content paths
```javascript
content: [
  "./index.html",
  "./src/**/*.{js,ts,jsx,tsx}",  // Must include all component files
],
```

### Issue: Modal not closing on backdrop click

**Cause:** Event bubbling issue

**Solution:**
```typescript
const handleBackdropClick = (e: React.MouseEvent) => {
  if (e.target === e.currentTarget) {  // Check if clicked on backdrop itself
    onClose();
  }
};
```

### Issue: Loading state stuck

**Cause:** Missing finally block or error not caught

**Solution:**
```typescript
try {
  setLoading(true);
  await someAsyncOperation();
} catch (error) {
  setError(error.message);
} finally {
  setLoading(false);  // Always runs
}
```

### Debugging Tips

1. **React DevTools** - Inspect component hierarchy and props
2. **Zustand DevTools** - Track state changes
3. **Console logging** - Add at key decision points
4. **Chrome Extension DevTools** - Inspect popup, content script, background

```typescript
// Debug state changes
console.log('[Popup] Cart items extracted:', extractedItems);
console.log('[Popup] Recommendation received:', rec);
console.log('[Store] Current state:', useStore.getState());
```

---

## Summary

The UI system is built with modern React patterns, providing a type-safe, maintainable, and user-friendly interface. Key highlights:

- ✅ **Zustand** for minimal-boilerplate state management
- ✅ **TypeScript** for complete type safety
- ✅ **Tailwind CSS** for consistent, responsive styling
- ✅ **Error boundaries** for graceful failure handling
- ✅ **Loading states** for better UX
- ✅ **NEW CartItemsList** for cart visibility (October 2024)

**File Locations:**
- Components: `src/components/*.tsx`
- Main popup: `src/popup/Popup.tsx`
- Store: `src/store/useStore.ts`
- Types: `src/types/index.ts`
- Styles: `src/styles/globals.css`

---

*Last updated: October 2024*
*Part of extension-v2 documentation suite - see `CLAUDE.md` for navigation*
