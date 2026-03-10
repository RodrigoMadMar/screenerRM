import Anthropic from '@anthropic-ai/sdk';
import Parser from 'rss-parser';
import { MacroAnalysis, TickerRecommendation } from './types';

const client = new Anthropic();

// ─── News Fetching ────────────────────────────────────────────────────────────

interface NewsItem {
  title: string;
  description?: string;
  pubDate?: string;
}

async function fetchMarketaux(): Promise<NewsItem[]> {
  const apiKey = process.env.MARKETAUX_API_KEY;
  if (!apiKey) throw new Error('No MARKETAUX_API_KEY');

  const url = `https://api.marketaux.com/v1/news/all?symbols=&filter_entities=true&language=en&published_after=${getYesterdayISO()}&limit=50&api_token=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Marketaux ${res.status}`);

  const json = await res.json();
  return (json.data ?? []).map((item: { title: string; description?: string; published_at?: string }) => ({
    title: item.title,
    description: item.description,
    pubDate: item.published_at,
  }));
}

async function fetchRSS(): Promise<NewsItem[]> {
  const parser = new Parser();
  const feeds = [
    'https://feeds.reuters.com/reuters/businessNews',
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  ];

  const results: NewsItem[] = [];
  for (const feed of feeds) {
    try {
      const parsed = await Promise.race([
        parser.parseURL(feed),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RSS timeout')), 5000)),
      ]);
      results.push(...(parsed.items ?? []).slice(0, 25).map(item => ({
        title: item.title ?? '',
        description: item.contentSnippet,
        pubDate: item.pubDate,
      })));
    } catch {
      // skip failed feed
    }
  }

  return results;
}

export async function fetchNews(): Promise<NewsItem[]> {
  try {
    const items = await fetchMarketaux();
    if (items.length > 0) return items;
  } catch {
    // fall through to RSS
  }

  return fetchRSS();
}

function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ─── Claude Analysis ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert macro trader and market analyst. You will be given recent financial news headlines and you must:

1. Classify the overall macro regime: RISK-ON, RISK-OFF, NEUTRAL, or ROTATION
2. Provide a confidence score (0-100) for your regime classification
3. Write a 2-3 sentence macro summary
4. Identify 4-8 distinct thematic clusters/narratives from the news
5. For each theme, recommend specific tickers that are relevant to trade RIGHT NOW

For each ticker recommendation provide:
- symbol: The exact ticker symbol traded on NYSE/NASDAQ (e.g. NVDA, GDX, SOXL, SQQQ). NEVER use theme names or descriptive words as symbols.
- name: Full company/fund name
- type: "stock", "etf", or "leveraged_etf"
- leverage: multiplier if leveraged_etf (e.g. 3 for 3x)
- bias: "bullish" or "bearish"
- rationale: 1-2 sentence explanation of why this ticker is relevant NOW
- theme: The theme name this ticker belongs to

Include a MIX across ALL themes:
- Individual stocks (NVDA, XOM, JPM, AAPL, TSM, META, AMZN, MSFT, etc.)
- Sector ETFs (XLK, XLE, XLF, XLI, XLV, XLC, XLY, XLP, XLB, XLRE, XLU)
- Broad market ETFs (SPY, QQQ, IWM, DIA, EEM, EFA, etc.)
- Commodity/thematic ETFs (GDX, GLD, SLV, USO, UNG, ARKK, etc.)
- Bond/rate ETFs (TLT, HYG, LQD, SHY, IEF, etc.)
- Leveraged ETFs (TQQQ, SOXL, NUGT, UPRO, FNGU, etc.)
- Inverse ETFs when appropriate (SQQQ, SPXS, DUST, DRIP, UVXY, etc.)

Target 25-35 total unique tickers across all themes. Aim for 4-6 tickers per theme.
Cover BOTH bullish AND bearish setups within the same theme when relevant.
Prioritize liquid instruments with >$10M average daily volume that definitely trade on NYSE/NASDAQ.

IMPORTANT: Output ONLY valid JSON, no markdown fences, no explanation outside JSON.

Output format:
{
  "regime": "RISK-ON",
  "confidence": 75,
  "summary": "...",
  "themes": [
    {
      "name": "Theme Name",
      "description": "Brief description",
      "tickers": [
        {
          "symbol": "NVDA",
          "name": "NVIDIA Corporation",
          "type": "stock",
          "bias": "bullish",
          "rationale": "...",
          "theme": "Theme Name"
        }
      ]
    }
  ]
}`;

function parseClaudeJSON(raw: string): MacroAnalysis {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleaned);

  // Flatten all tickers
  const allTickers: TickerRecommendation[] = [];
  for (const theme of parsed.themes ?? []) {
    for (const ticker of theme.tickers ?? []) {
      if (!allTickers.find(t => t.symbol === ticker.symbol)) {
        allTickers.push({
          symbol: ticker.symbol,
          name: ticker.name,
          type: ticker.type ?? 'stock',
          leverage: ticker.leverage,
          bias: ticker.bias,
          rationale: ticker.rationale,
          theme: ticker.theme ?? theme.name,
        });
      }
    }
  }

  return {
    regime: parsed.regime,
    confidence: parsed.confidence,
    summary: parsed.summary,
    themes: parsed.themes,
    allTickers,
  };
}

export async function analyzeWithClaude(headlines: NewsItem[], userPrompt?: string): Promise<MacroAnalysis> {
  const headlinesText = headlines
    .slice(0, 50)
    .map((h, i) => `${i + 1}. ${h.title}${h.description ? ` — ${h.description.slice(0, 100)}` : ''}`)
    .join('\n');

  const userContent = `Here are today's financial headlines:\n\n${headlinesText}${
    userPrompt ? `\n\nUser focus: ${userPrompt}` : ''
  }\n\nAnalyze these headlines and return your JSON response.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    return parseClaudeJSON(raw);
  } catch {
    // Retry with explicit JSON instruction
    const retry = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: raw },
        { role: 'user', content: 'Please return ONLY the JSON object, nothing else.' },
      ],
    });
    const retryRaw = retry.content[0].type === 'text' ? retry.content[0].text : '{}';
    return parseClaudeJSON(retryRaw);
  }
}
