# AI Checkout - Credit Card Recommender

A Chrome extension that recommends optimal credit cards for online purchases based on shopping cart analysis. Uses OpenAI GPT-3.5 Turbo to match purchases with credit card reward categories.

## Problem & Solution

Many credit cards offer category-specific rewards (e.g., 5% on groceries, 3% on dining), but manually selecting the right card for each purchase is inconvenient. This extension automatically analyzes shopping carts and recommends the best card to maximize rewards.

The extension extracts items from e-commerce sites, sends them to an AI model for category analysis, and suggests the optimal credit card from a database of available cards with their reward structures.

---

## Repository Structure

```
AICheckout/
├── root_extension/
│   ├── extension/              # ⚠️ Legacy v1 (archived, vanilla JS proof-of-concept)
│   └── extension-v2/           # ✅ Current - Modern React/TypeScript implementation
│       ├── src/
│       │   ├── content/        # Cart extraction system
│       │   │   └── extractors/ # Site-specific cart extractors
│       │   ├── popup/          # React popup UI
│       │   ├── components/     # Reusable UI components
│       │   ├── services/       # API clients (Supabase, OpenAI)
│       │   ├── store/          # Zustand state management
│       │   └── utils/          # Helper functions
│       ├── supabase/           # Database schema & seed data
│       ├── docs/               # Detailed documentation
│       ├── manifest.json       # Chrome extension config
│       └── package.json
├── simulation/                 # Interactive simulation app (Node.js/Express)
└── README.md                   # This file
```

---

## Features

### Chrome Extension
- **Cart Extraction** - Automatically extracts shopping cart items from e-commerce websites
  - Site-specific extractors for Sephora, Safeway, Best Buy
  - Config-driven system for adding new sites
  - Generic fallback extractor for unsupported sites
- **AI Recommendations** - Uses OpenAI GPT-3.5 Turbo to analyze purchases and recommend cards
- **Dynamic Database** - Credit card data stored in Supabase with local caching
- **User Interface** - React-based popup showing cart items, recommendations, and AI reasoning
- **Settings Management** - Secure API key storage in Chrome local storage

## Installation

### Chrome Extension Setup

1. Clone this repository and navigate to the extension directory:
   ```bash
   cd root_extension/extension-v2
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

4. Build the extension:
   ```bash
   npm run build
   ```

5. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `root_extension/extension-v2/dist/` directory

6. Configure your OpenAI API key:
   - Click the extension icon
   - Open settings
   - Enter your OpenAI API key

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. User Shopping                                                    │
│    User adds items to cart on e-commerce site (Sephora, Safeway...) │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Click Extension Icon                                             │
│    User clicks Chrome extension icon in browser toolbar             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Cart Extraction                                                  │
│    Content script extracts cart items from page DOM                 │
│    - Matches site to registered extractor (O(1) lookup)             │
│    - Extracts product names, prices, quantities                     │
│    Returns: [{ name, price, quantity }, ...]                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Fetch Credit Cards                                               │
│    Extension fetches available cards from Supabase                  │
│    - Checks 1-hour cache first                                      │
│    - Falls back to database if cache expired                        │
│    Returns: [{ name, rewards, annualFee, ... }, ...]                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. AI Analysis                                                      │
│    Send cart items + cards to OpenAI GPT-3.5 Turbo                  │
│    - Builds prompt with cart context and card details               │
│    - AI determines merchant category (groceries, dining, etc.)      │
│    - AI matches categories to card reward structures                │
│    - AI selects optimal card and provides reasoning                 │
│    Returns: { card, rewards, category, reasoning }                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Display Recommendation                                           │
│    Shows results in extension popup + on-page banner:               │
│    - Extracted cart items                                           │
│    - Recommended credit card                                        │
│    - Reward categories and percentages                              │
│    - AI reasoning for recommendation                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Simulation App

A Node.js web application that simulates shopping transactions to compare AI-powered card selection against a baseline 1% cashback card.

### Setup

1. Navigate to the simulation directory:
   ```bash
   cd simulation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `credentials.json` with your OpenAI API key:
   ```json
   {
     "OPENAI_API_KEY": "sk-..."
   }
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000)

### How It Works

The simulation generates random shopping carts, uses the OpenAI API to recommend the optimal card for each purchase, and calculates rewards. It compares these results against a flat 1% cashback card to show the potential benefit of AI-optimized card selection.

### Demo

![AI Checkout Reward Simulation Demo](images/demo.jpeg)

_Example simulation showing cumulative rewards over 100 orders comparing AI-selected cards vs. 1% flat cashback._

---

## Technical Details

### Architecture

**Cart Extraction System**
- Uses a registry pattern with O(1) site lookup via Map data structure
- `ExtractorRegistry` - Singleton managing all site extractors
- `BaseExtractor` - Abstract base class with common extraction methods
- Site-specific extractors for Sephora, Safeway, and Best Buy
- Config-driven extractors for simple sites
- Generic fallback extractor for unknown sites

**Caching & Performance**
- 1-hour TTL cache in Chrome local storage
- Offline support with automatic fallback to cached data
- Bundle size: 365KB (108KB gzipped)

**AI Integration**
- Direct OpenAI API calls with GPT-3.5 Turbo
- Structured JSON output with reasoning field
- 300 token limit (~$0.001-0.002 per recommendation)
- Error handling with fallback JSON parsing

**Database**
- Supabase (PostgreSQL) for credit card data
- JSONB column for flexible reward categories
- Row Level Security (RLS) policies

---

## Tech Stack

**Frontend**
- React 19
- TypeScript 5.8
- Tailwind CSS 3.4
- Zustand 5 (state management)

**Build Tools**
- Vite 7
- @crxjs/vite-plugin (Chrome Extension bundling)
- ESLint + TypeScript ESLint

**Backend**
- Supabase (PostgreSQL)
- OpenAI GPT-3.5 Turbo API

**Platform**
- Chrome Extensions (Manifest V3)
- Node.js + Express (simulation app)

---

## Security

- API keys and credentials are gitignored (`credentials.json`, `.env`)
- OpenAI API key stored in Chrome local storage (user-provided)
- Supabase uses Row Level Security (RLS) policies
- Dependencies managed via `package.json`

---

## Future Roadmap

- Chrome Web Store publication
- Additional site extractors (Amazon, Target, Walmart, Ulta, eBay, Etsy)
- Recommendation history tracking
- User preferences (cashback vs points, max annual fee)
- Multi-card comparison view
- Firefox extension port

## License

MIT
