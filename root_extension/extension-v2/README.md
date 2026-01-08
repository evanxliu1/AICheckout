# AI Checkout Extension v2

Modern Chrome extension built with React + TypeScript + Vite that provides AI-powered credit card recommendations for online shopping.

## Features

- 🤖 **AI-Powered Recommendations** - Uses OpenAI GPT to analyze cart items and recommend optimal cards
- 💳 **Multi-Card Database** - Powered by Supabase with dynamic card management
- 🎨 **Modern UI** - Built with React, TypeScript, and Tailwind CSS
- 🔄 **Real-time Cart Detection** - Automatically extracts cart items from e-commerce sites
- 💾 **Smart Caching** - Caches card data and recommendations for better performance
- 🔒 **Secure** - API keys stored locally in Chrome storage

## Tech Stack

- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite 7 with @crxjs/vite-plugin
- **Styling:** Tailwind CSS 3
- **State Management:** Zustand
- **Data Fetching:** TanStack React Query
- **Database:** Supabase
- **AI:** OpenAI GPT-3.5 Turbo

## Prerequisites

- Node.js 18+ and npm
- Chrome browser
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))
- Supabase account ([Sign up here](https://supabase.com))

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

Follow `supabase/SETUP.md` to:
1. Create a Supabase project
2. Run database migrations
3. Seed initial credit card data

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Test Connection

```bash
node test-supabase.js
```

Should display 3 credit cards.

### 5. Build

```bash
npm run build
```

### 6. Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` directory

### 7. Configure API Key

1. Click extension icon
2. Click **Settings** (gear icon)
3. Enter OpenAI API key
4. Click **Save**

## Development

### Dev Mode (Hot Reload)

```bash
npm run dev
```

After changes:
1. Refresh extension in `chrome://extensions/`
2. Reload test page

### Build for Production

```bash
npm run build
```

## Using the Extension

1. Visit e-commerce site (Amazon, Target, etc.)
2. Add items to cart
3. Click extension icon
4. Click **Get Recommendation**
5. View recommended card!

## Project Structure

```
src/
├── background/       # Service worker
├── content/          # Content scripts
├── popup/            # React popup UI
├── components/       # React components
├── services/         # API clients
├── store/            # State management
├── types/            # TypeScript types
├── utils/            # Helpers
└── styles/           # Global styles
```

## Troubleshooting

**No recommendations:**
- Check API key is set
- Verify Supabase connection
- Ensure cart items exist

**Build errors:**
```bash
rm -rf node_modules/.tmp
npm run build
```

**Extension won't load:**
- Load `dist/` directory (not root)
- Check `chrome://extensions/` for errors

## Documentation

- `supabase/SETUP.md` - Database setup guide
- `api/README.md` - Optional backend API
- `/Users/evanliu/Projects/AICheckout/root_extension/CLAUDE.md` - Development plan

## License

MIT
