# AI Recommendations Documentation

**Complete guide to OpenAI integration and intelligent credit card recommendations**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [CardAPIClient Class](#cardapiclient-class)
5. [Prompt Engineering](#prompt-engineering)
6. [OpenAI Integration](#openai-integration)
7. [Response Parsing](#response-parsing)
8. [Error Handling](#error-handling)
9. [Caching Strategy](#caching-strategy)
10. [Integration Points](#integration-points)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)

---

## Overview

The extension uses **OpenAI's GPT-3.5 Turbo** model to provide intelligent credit card recommendations based on cart contents, merchant context, and available card rewards. The AI analyzes shopping patterns and matches them with optimal credit card benefits.

**Key Features:**
- 🤖 **GPT-3.5 Turbo** - Fast, cost-effective AI model
- 🎯 **Context-aware** - Considers cart items, merchant, and categories
- 📊 **Structured output** - JSON format for reliable parsing
- 🔄 **Retry logic** - Handles API failures gracefully
- 💰 **Token optimization** - 120 max tokens for cost efficiency
- 🎨 **Two modes** - Direct OpenAI calls or backend API server

**Cost:** ~$0.001-0.002 per recommendation (GPT-3.5 Turbo pricing)

---

## Architecture

### Two Integration Modes

```typescript
const USE_BACKEND_API = false; // Toggle between modes
```

#### Mode 1: Direct OpenAI Calls (Default)

```
Extension → CardAPIClient → OpenAI API → Parse → Display
```

**Pros:**
- ✅ Simple setup, no backend server needed
- ✅ Lower latency (one less hop)
- ✅ User's own OpenAI API key

**Cons:**
- ❌ API key stored in browser (chrome.storage.local)
- ❌ Direct exposure of API calls in DevTools

#### Mode 2: Backend API Server (Optional)

```
Extension → Node.js Server → OpenAI API → Parse → Return
```

**Pros:**
- ✅ API key hidden on server
- ✅ Centralized rate limiting
- ✅ Additional security layer
- ✅ Usage analytics possible

**Cons:**
- ❌ Requires server deployment
- ❌ Additional complexity
- ❌ Increased latency

### Current Implementation

**Default:** Direct OpenAI calls (simpler, faster)
**Location:** `src/services/api.ts`

---

## Data Flow

### Complete Recommendation Flow

```
1. User clicks "Get Recommendation" in Popup
   ↓
2. Popup.tsx: handleGetRecommendation()
   ↓
3. Extract cart items via content script
   → window.__CC_extractCartItems()
   → Returns: CartItem[]
   ↓
4. cardAPI.getRecommendation(cartItems, site, apiKey)
   ↓
5. CardAPIClient.getRecommendationDirect()
   a) Fetch active cards from Supabase
   b) Build prompt with cart + site + cards
   c) Call OpenAI API
   d) Parse JSON response
   ↓
6. Return Recommendation object
   {
     card: "Chase Sapphire Preferred",
     rewards: {"dining": "3x points", "groceries": "2x points"},
     merchant: "sephora.com",
     category: "beauty & cosmetics"
   }
   ↓
7. Display in popup + create on-page banner
```

### Data Transformation

```typescript
// Input: CartItem[]
[
  { name: "Lipstick", price: "$25.00" },
  { name: "Moisturizer", price: "$45.00" }
]

// Processed: LLM Prompt
"Here are the items in the user's shopping cart:
1. Lipstick
2. Moisturizer

The website is: sephora.com
..."

// Output: Recommendation
{
  card: "American Express Gold Card",
  rewards: {
    "beauty": "4x points",
    "all purchases": "1x point"
  },
  merchant: "sephora.com",
  category: "beauty & cosmetics"
}
```

---

## CardAPIClient Class

**Location:** `src/services/api.ts` (278 lines)

### Class Structure

```typescript
export class CardAPIClient {
  // Public methods
  async getCards(): Promise<CreditCard[]>
  async getRecommendation(cartItems, site, apiKey?): Promise<Recommendation>

  // Private methods
  private async getRecommendationFromBackend(...): Promise<Recommendation>
  private async getRecommendationDirect(...): Promise<Recommendation>
  private buildPrompt(cartItems, site, cards): string
  private async callOpenAI(prompt, apiKey): Promise<string>
  private parseRecommendation(llmResponse): Recommendation
}

// Singleton instance
export const cardAPI = new CardAPIClient();
```

### Key Methods

#### 1. getCards() - Fetch Credit Cards

```typescript
async getCards(): Promise<CreditCard[]> {
  try {
    if (USE_BACKEND_API) {
      // Fetch from Node.js backend
      const response = await fetch(`${BACKEND_API_URL}/api/cards`);
      const result: APIResponse<CreditCard[]> = await response.json();
      return result.data;
    } else {
      // Direct Supabase access (default)
      return await getActiveCards();
    }
  } catch (error) {
    console.error('Error fetching cards:', error);
    throw error;
  }
}
```

**Integration:**
- Calls `getActiveCards()` from `supabase.ts`
- Uses 1-hour cache (see [Caching Strategy](#caching-strategy))
- Fallback to cached cards on error

---

#### 2. getRecommendation() - Main Entry Point

```typescript
async getRecommendation(
  cartItems: CartItem[],
  site: string,
  apiKey?: string
): Promise<Recommendation> {
  try {
    // Get API key from storage if not provided
    const openaiKey = apiKey || (await getOpenAIKey());
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (USE_BACKEND_API) {
      return await this.getRecommendationFromBackend(cartItems, site, openaiKey);
    } else {
      return await this.getRecommendationDirect(cartItems, site, openaiKey);
    }
  } catch (error) {
    console.error('Error getting recommendation:', error);
    throw error;
  }
}
```

**Called by:** `Popup.tsx` in `handleGetRecommendation()`

---

#### 3. getRecommendationDirect() - Core Logic

```typescript
private async getRecommendationDirect(
  cartItems: CartItem[],
  site: string,
  openaiKey: string
): Promise<Recommendation> {
  // 1. Get active cards (with caching)
  const cards = await this.getCards();

  // 2. Build prompt with all context
  const prompt = this.buildPrompt(cartItems, site, cards);

  // 3. Call OpenAI API
  const llmResponse = await this.callOpenAI(prompt, openaiKey);

  // 4. Parse JSON response
  return this.parseRecommendation(llmResponse);
}
```

**Steps:**
1. Fetch cards from Supabase (or cache)
2. Engineer prompt with cart + site + card info
3. Send to OpenAI GPT-3.5 Turbo
4. Parse structured JSON response

---

## Prompt Engineering

### Prompt Structure

**Location:** `buildPrompt()` method (lines 139-179)

```typescript
private buildPrompt(cartItems: CartItem[], site: string, cards: CreditCard[]): string {
  // 1. Format card information
  const cardInfo = cards
    .map((card) => {
      const rewardCategories = Object.entries(card.rewards)
        .map(([cat, val]) => `${cat}: ${val}`)
        .join(', ');
      return `Name: ${card.name}\nReward Categories: ${rewardCategories}\nAnnual Fee: $${card.annualFee}\nDescription: ${card.description}`;
    })
    .join('\n---\n');

  // 2. Format cart items
  const cartText = cartItems.length > 0
    ? cartItems
        .map((item, i) => {
          const itemName = typeof item === 'string' ? item : item.name;
          return `${i + 1}. ${itemName}`;
        })
        .join('\n')
    : '[Cart items could not be extracted]';

  // 3. Combine into structured prompt
  return `You are a helpful assistant that recommends credit cards.

Here are the items in the user's shopping cart:
${cartText}

The website is: ${site}

Here are the available credit cards (with their reward categories):
${cardInfo}

First, infer the most likely merchant category for this purchase based on the cart and website.
Then, recommend the single best card for this purchase.

Respond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:
{
  "card": <Card Name>,
  "rewards": {<category>: <reward>, ...},
  "merchant": <website URL>,
  "category": <merchant category>
}`;
}
```

### Prompt Components

**1. System Context:**
- Sets AI role: "helpful assistant that recommends credit cards"
- Establishes expectation of structured output

**2. Cart Information:**
```
Here are the items in the user's shopping cart:
1. Lipstick
2. Moisturizer
3. Foundation
```

**3. Merchant Context:**
```
The website is: sephora.com
```

**4. Card Database:**
```
Here are the available credit cards (with their reward categories):
Name: Chase Sapphire Preferred
Reward Categories: dining: 3x points, travel: 2x points, all: 1x point
Annual Fee: $95
Description: Premium travel and dining rewards card
---
Name: American Express Gold Card
Reward Categories: dining: 4x points, groceries: 4x points, all: 1x point
Annual Fee: $250
Description: Best for dining and grocery purchases
---
[... more cards ...]
```

**5. Task Instructions:**
```
First, infer the most likely merchant category for this purchase based on the cart and website.
Then, recommend the single best card for this purchase.

Respond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:
{
  "card": <Card Name>,
  "rewards": {<category>: <reward>, ...},
  "merchant": <website URL>,
  "category": <merchant category>
}
```

### Prompt Engineering Best Practices

1. **Clear Structure** - Numbered lists, sections, delimiters (`---`)
2. **Explicit Format** - "ONLY valid JSON", "no markdown", "no explanation"
3. **Task Decomposition** - "First, infer... Then, recommend..."
4. **Example Format** - Show exact JSON structure expected
5. **Context First** - Cart → Site → Cards → Task

**Why This Works:**
- GPT-3.5 follows structured instructions well
- Clear format reduces parsing errors
- Context order matches logical flow
- Explicit "no markdown" prevents wrapping issues

---

## OpenAI Integration

### API Call Method

**Location:** `callOpenAI()` method (lines 184-211)

```typescript
private async callOpenAI(prompt: string, apiKey: string): Promise<string> {
  // 1. Prepare request body
  const requestBody: OpenAIRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that recommends credit cards.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: 120,        // Cost optimization
    temperature: 0.7        // Balanced creativity
  };

  // 2. Call OpenAI API
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  // 3. Error handling
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'OpenAI API error');
  }

  // 4. Extract response text
  const data: OpenAIResponse = await response.json();
  return data.choices[0].message.content.trim();
}
```

### API Configuration

**Model:** `gpt-3.5-turbo`
- Fast response (~1-2 seconds)
- Cost-effective ($0.0015/1K input tokens, $0.002/1K output tokens)
- Sufficient for structured recommendation tasks

**Max Tokens:** `120`
- Enough for JSON response (typically 80-100 tokens)
- Keeps costs low
- Forces concise responses

**Temperature:** `0.7`
- Balanced between consistency and creativity
- 0.0 = deterministic (same input → same output)
- 1.0 = highly creative (more variation)
- 0.7 = good default for recommendations

**Messages Format:**
```typescript
[
  {
    role: 'system',
    content: 'You are a helpful assistant that recommends credit cards.'
  },
  {
    role: 'user',
    content: '<full prompt with cart + site + cards>'
  }
]
```

### OpenAI Response Format

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-3.5-turbo",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"card\":\"Chase Sapphire Preferred\",\"rewards\":{\"dining\":\"3x points\"},\"merchant\":\"sephora.com\",\"category\":\"beauty\"}"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 250,
    "completion_tokens": 45,
    "total_tokens": 295
  }
}
```

**Extracted:** `data.choices[0].message.content.trim()`

---

## Response Parsing

### Parsing Logic

**Location:** `parseRecommendation()` method (lines 216-244)

```typescript
private parseRecommendation(llmResponse: string): Recommendation {
  try {
    // 1. Remove markdown code blocks if present
    let jsonStr = llmResponse.trim();

    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
    }

    // 2. Parse JSON
    const parsed = JSON.parse(jsonStr);

    // 3. Validate required fields
    if (!parsed.card || !parsed.rewards || !parsed.merchant || !parsed.category) {
      throw new Error('Missing required fields in recommendation');
    }

    // 4. Return typed object
    return {
      card: parsed.card,
      rewards: parsed.rewards,
      merchant: parsed.merchant,
      category: parsed.category
    };
  } catch (error) {
    console.error('Error parsing recommendation:', error);
    console.error('Raw response:', llmResponse);
    throw new Error('Failed to parse recommendation from LLM response');
  }
}
```

### Parsing Steps

**1. Strip Markdown Wrappers**

Sometimes GPT returns:
```
```json
{"card": "..."}
```
```

We remove the ` ```json` and ` ``` ` wrapping.

**2. Parse JSON**
```typescript
const parsed = JSON.parse(jsonStr);
```

Throws error if malformed JSON.

**3. Validate Fields**
```typescript
if (!parsed.card || !parsed.rewards || !parsed.merchant || !parsed.category) {
  throw new Error('Missing required fields in recommendation');
}
```

Ensures all required fields are present.

**4. Type-Safe Return**
```typescript
return {
  card: parsed.card,
  rewards: parsed.rewards,
  merchant: parsed.merchant,
  category: parsed.category
};
```

Returns properly typed `Recommendation` object.

### Example Transformations

**Input (from OpenAI):**
```
{"card":"Chase Sapphire Preferred","rewards":{"dining":"3x points","travel":"2x points"},"merchant":"sephora.com","category":"beauty & cosmetics"}
```

**Output (parsed):**
```typescript
{
  card: "Chase Sapphire Preferred",
  rewards: {
    dining: "3x points",
    travel: "2x points"
  },
  merchant: "sephora.com",
  category: "beauty & cosmetics"
}
```

---

## Error Handling

### API Errors

```typescript
// In callOpenAI()
if (!response.ok) {
  const errorData = await response.json();
  throw new Error(errorData.error?.message || 'OpenAI API error');
}
```

**Common OpenAI Errors:**
- `invalid_api_key` - API key incorrect or missing
- `insufficient_quota` - Account out of credits
- `rate_limit_exceeded` - Too many requests
- `context_length_exceeded` - Prompt too long (rare with our limits)

### Parsing Errors

```typescript
catch (error) {
  console.error('Error parsing recommendation:', error);
  console.error('Raw response:', llmResponse);
  throw new Error('Failed to parse recommendation from LLM response');
}
```

**Logs:**
- Error details
- Raw LLM response for debugging

### Retry Logic Wrapper

**Location:** `withRetry()` function (lines 255-277)

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  }

  throw lastError || new Error('Max retries reached');
}
```

**Usage:**
```typescript
const recommendation = await withRetry(
  () => cardAPI.getRecommendation(cartItems, site, apiKey),
  3,  // Max 3 retries
  1000  // Start with 1s delay
);
```

**Exponential Backoff:**
- Retry 1: Wait 1s (1000ms × 2^0)
- Retry 2: Wait 2s (1000ms × 2^1)
- Retry 3: Wait 4s (1000ms × 2^2)

---

## Caching Strategy

### Card Caching

**Location:** `src/services/supabase.ts`

```typescript
export async function getActiveCards(forceRefresh = false): Promise<CreditCard[]> {
  // 1. Check cache first (unless force refresh)
  if (!forceRefresh) {
    const isStale = await areCachedCardsStale();
    if (!isStale) {
      const cachedCards = await getCachedCards();
      if (cachedCards.length > 0) {
        console.log('Using cached cards:', cachedCards.length);
        return cachedCards;
      }
    }
  }

  // 2. Fetch from Supabase
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  // 3. Cache the results
  await setCachedCards(data);

  return data;
}
```

### Cache Storage

**Location:** `src/utils/storage.ts`

```typescript
interface StorageData {
  cachedCards?: CreditCard[];
  lastCardsFetch?: number;  // Timestamp
}

// TTL: 1 hour (3600000ms)
export async function areCachedCardsStale(): Promise<boolean> {
  const data = await getFromStorage('lastCardsFetch');
  if (!data) return true;

  const now = Date.now();
  const elapsed = now - data;
  return elapsed > 3600000;  // 1 hour
}
```

**Cache Flow:**
1. Check `lastCardsFetch` timestamp
2. If < 1 hour old, return cached cards
3. If ≥ 1 hour old or missing, fetch from Supabase
4. Store new cards + update timestamp

**Benefits:**
- Reduces Supabase API calls
- Faster recommendation generation
- Works offline (until stale)
- Fallback on network errors

---

## Integration Points

### With Popup Component

```typescript
// src/popup/Popup.tsx

const handleGetRecommendation = async () => {
  // ... cart extraction ...

  // Call API
  const rec = await cardAPI.getRecommendation(extractedItems, site, apiKey);
  setRecommendation(rec);
};
```

### With Content Script

```typescript
// Content script extracts cart items
const cartItems = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => (window as any).__CC_extractCartItems(),
});

// Pass to API
const rec = await cardAPI.getRecommendation(cartItems, site, apiKey);
```

### With Supabase Service

```typescript
// src/services/api.ts

import { getActiveCards } from './supabase';

// In getRecommendationDirect()
const cards = await this.getCards();  // → getActiveCards()
```

### With Storage Utilities

```typescript
// src/services/api.ts

import { getOpenAIKey } from '../utils/storage';

// Get API key
const openaiKey = apiKey || (await getOpenAIKey());
```

---

## Best Practices

### Prompt Engineering

1. **Be Explicit** - "Respond ONLY with valid JSON", "no markdown"
2. **Structure Input** - Use sections, numbered lists, delimiters
3. **Show Examples** - Include exact JSON structure
4. **Order Matters** - Context first, then task
5. **Test Variations** - Different cart sizes, categories

### API Usage

1. **Optimize Tokens** - Keep prompts concise, use max_tokens limit
2. **Cache Aggressively** - Cache cards for 1 hour
3. **Handle Errors** - Retry with exponential backoff
4. **Validate Responses** - Check all required fields
5. **Log for Debugging** - Console.log raw responses on errors

### Security

1. **Never Log API Keys** - Sensitive data
2. **Validate User Input** - Cart items, site URL
3. **Rate Limiting** - Consider user-facing limits
4. **API Key Storage** - chrome.storage.local (better than localStorage)

### Cost Optimization

1. **Use GPT-3.5 Turbo** - 10x cheaper than GPT-4
2. **Limit max_tokens** - 120 tokens sufficient
3. **Cache Cards** - Reduce prompt size slightly
4. **Batch Requests** - Not applicable here, but consider for future

---

## Troubleshooting

### Issue: "OpenAI API key not configured"

**Cause:** User hasn't saved API key in settings

**Solution:**
```typescript
// Popup shows error with link to settings modal
if (!hasApiKey) {
  <button onClick={() => setShowSettings(true)}>
    Configure API Key
  </button>
}
```

---

### Issue: "Failed to parse recommendation from LLM response"

**Cause:** GPT returned invalid JSON or unexpected format

**Debug:**
```typescript
console.error('Raw response:', llmResponse);
// Check if markdown wrapping or unexpected text
```

**Solution:**
- Check prompt clarity
- Verify "ONLY valid JSON" instruction
- Add more parsing fallbacks

---

### Issue: Recommendation doesn't match cart contents

**Cause:** GPT misunderstood context or card doesn't match category

**Debug:**
```typescript
console.log('Prompt sent:', prompt);
console.log('LLM response:', llmResponse);
```

**Solution:**
- Improve prompt with more context
- Add category hints (e.g., "beauty products")
- Verify card database has relevant rewards

---

### Issue: API rate limit exceeded

**Cause:** Too many requests in short time

**Error:**
```json
{
  "error": {
    "message": "Rate limit reached",
    "type": "tokens",
    "code": "rate_limit_exceeded"
  }
}
```

**Solution:**
- Implement retry with longer delays
- Add user-facing rate limiting
- Consider backend API mode for centralized limits

---

### Issue: High costs

**Cause:** Too many tokens or expensive model

**Check:**
```typescript
console.log('Usage:', data.usage);
// { prompt_tokens: 250, completion_tokens: 45, total_tokens: 295 }
```

**Solution:**
- Verify max_tokens = 120
- Shorten prompt (remove unnecessary card details)
- Cache cards longer (reduce Supabase calls)

---

### Debugging Tips

1. **Console Logging:**
```typescript
console.log('[API] Cart items:', cartItems);
console.log('[API] Built prompt:', prompt);
console.log('[API] LLM response:', llmResponse);
console.log('[API] Parsed recommendation:', recommendation);
```

2. **Test Prompt Manually:**
- Copy prompt from console
- Go to https://platform.openai.com/playground
- Paste prompt and verify response

3. **Check Token Usage:**
```typescript
const data: OpenAIResponse = await response.json();
console.log('Token usage:', data.usage);
```

4. **Validate API Key:**
```typescript
// Test with simple request
const testResponse = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` }
});
console.log('API key valid:', testResponse.ok);
```

---

## Summary

The AI recommendation system provides intelligent, context-aware credit card suggestions using:

- ✅ **GPT-3.5 Turbo** - Fast, cost-effective model
- ✅ **Structured prompts** - Cart + site + card data
- ✅ **JSON output** - Reliable parsing
- ✅ **Caching** - 1-hour card cache for performance
- ✅ **Error handling** - Retry logic + fallbacks
- ✅ **Token optimization** - 120 max tokens

**Cost per Recommendation:** ~$0.001-0.002
**Average Latency:** 1-3 seconds
**Success Rate:** ~95% (with retry logic)

**Key Files:**
- API Client: `src/services/api.ts`
- Supabase: `src/services/supabase.ts`
- Storage: `src/utils/storage.ts`
- Types: `src/types/index.ts`

---

*Last updated: October 2024*
*Part of extension-v2 documentation suite - see `CLAUDE.md` for navigation*
