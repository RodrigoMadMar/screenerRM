# FVG Macro Screener

AI-powered confluence scanner that combines price action analysis (FVG, Liquidity Sweeps, Break of Structure) with macro/geopolitical context to discover actionable trading opportunities across stocks, ETFs, and leveraged ETFs.

## How It Works

1. **News Ingestion** — Fetches latest financial headlines from Marketaux (with RSS fallback)
2. **Claude Macro Analysis** — Claude analyzes headlines, identifies macro themes, and recommends specific tickers (stocks, ETFs, leveraged ETFs)
3. **Price Data** — Fetches 120 days of OHLCV data from Yahoo Finance for all recommended tickers
4. **Confluence Scoring** — Runs FVG, Liquidity Sweep, and BOS detection on each ticker, then scores based on:
   - Fair Value Gaps (unfilled): up to 30 pts
   - Liquidity Sweeps: up to 25 pts
   - Break of Structure: up to 25 pts
   - Macro Alignment: up to 15 pts
   - Volume Confirmation: up to 5 pts

## Setup

### 1. Clone & Deploy

Import this repo in [Vercel](https://vercel.com/new) → it will auto-detect Next.js and deploy.

### 2. Environment Variables

In Vercel → Settings → Environment Variables, add:

| Variable | Required | Source |
|----------|----------|--------|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com) |
| `MARKETAUX_API_KEY` | Yes | [marketaux.com](https://www.marketaux.com) |

### 3. Vercel Plan

The scan API route needs up to 60s to complete (news fetch + Claude analysis + price fetch + scoring). **Vercel Pro** supports 60s function timeout. On the Hobby plan (10s limit), the scan will likely timeout — you may need to split the pipeline into multiple API calls.

## Architecture

```
app/
├── page.tsx              ← Dashboard UI (client component)
├── layout.tsx            ← Root layout
├── globals.css           ← Tailwind + custom styles
└── api/
    └── scan/
        └── route.ts      ← Full scan pipeline (POST)

lib/
├── types.ts              ← TypeScript interfaces
├── detection.ts          ← FVG, swing points, liquidity sweeps, BOS algorithms
├── scoring.ts            ← Confluence scoring engine
├── macro.ts              ← Marketaux + RSS + Claude macro analysis
└── prices.ts             ← Yahoo Finance price fetcher
```

## Usage

1. Open the dashboard
2. (Optional) Type a focus prompt: "energy sector", "ignore tech", "what about Brazil"
3. Click **Scan Market**
4. Wait 15-40s for the full pipeline
5. Browse results sorted by confluence score
6. Click any ticker for detailed signal breakdown

## Customization

- **Scoring weights**: Edit `lib/scoring.ts` → `WEIGHTS` object
- **FVG sensitivity**: Edit `lib/detection.ts` → `minATRRatio` parameter
- **Swing lookback**: Edit `lib/detection.ts` → `lookback` parameter in `detectSwingPoints`
- **Claude prompt**: Edit `lib/macro.ts` → `MACRO_ANALYSIS_PROMPT`
- **Ticker universe**: Fully dynamic — Claude decides based on news context

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Hosting**: Vercel
- **AI**: Claude Sonnet (Anthropic API)
- **News**: Marketaux API + RSS feeds (fallback)
- **Prices**: yahoo-finance2 (npm)
- **Styling**: Tailwind CSS
