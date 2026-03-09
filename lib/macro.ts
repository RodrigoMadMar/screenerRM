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

const MARKET_KEYWORDS = [
  'fed', 'fomc', 'inflation', 'cpi', 'ppi', 'jobs', 'payroll', 'yield', 'treasury',
  'oil', 'gas', 'gold', 'silver', 'copper', 'usd', 'dollar', 'rates', 'tariff',
  'earnings', 'guidance', 'downgrade', 'upgrade', 'merger', 'acquisition', 'buyback',
  'ai', 'semiconductor', 'chip', 'bank', 'credit', 'default', 'geopolitical',
  'opec', 'sanction', 'war', 'china', 'europe', 'japan', 'russia', 'volatility',
  'etf', 'stocks', 'equities', 'futures', 'commodities', 'crypto', 'bitcoin',
];

const GENERIC_PENALTIES = [
  'series a', 'series b', 'seed round', 'venture capital', 'startup',
  'private market', 'funding round', 'product launch',
];

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
      const parsed = await parser.parseURL(feed);
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

function scoreHeadline(item: NewsItem): number {
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
  const keywordHits = MARKET_KEYWORDS.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
  const penaltyHits = GENERIC_PENALTIES.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
  const tickerLike = (item.title.match(/\b[A-Z]{2,5}\b/g) ?? []).length;
  return keywordHits * 2 + tickerLike - penaltyHits * 3;
}

function normalizeNews(items: NewsItem[]): NewsItem[] {
  const deduped = new Map<string, NewsItem>();

  for (const item of items) {
    const title = item.title?.trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, { ...item, title });
  }

  const ranked = Array.from(deduped.values())
    .map(item => ({ item, score: scoreHeadline(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  const strict = ranked.filter(entry => entry.score >= 1).slice(0, 50).map(entry => entry.item);
  if (strict.length >= 12) return strict;

  // Day is quiet: fallback to ranked context instead of starving Claude.
  return ranked.slice(0, 35).map(entry => entry.item);
}

export async function fetchNews(): Promise<NewsItem[]> {

  try {
    const items = await fetchMarketaux();
    const relevant = normalizeNews(items);
    if (relevant.length > 0) return relevant;
  } catch {
    // fall through to RSS
  }

  return normalizeNews(await fetchRSS());
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
4. Identify 3-7 distinct thematic clusters/narratives from the news
5. For each theme, recommend specific tickers that are relevant to trade RIGHT NOW

For each ticker recommendation provide:
- symbol: The exact ticker symbol (e.g. NVDA, GDX, SOXL, SQQQ)
- name: Full company/fund name
- type: "stock", "etf", or "leveraged_etf"
- leverage: multiplier if leveraged_etf (e.g. 3 for 3x)
- bias: "bullish" or "bearish"
- rationale: 1-2 sentence explanation of why this ticker is relevant NOW
- theme: The theme name this ticker belongs to

Include a MIX of:
- Individual stocks (NVDA, XOM, JPM, etc.)
- Regular ETFs (GDX, XLE, TLT, QQQ, etc.)
- Leveraged ETFs (NUGT, SOXL, TQQQ, etc.)
- Inverse ETFs when appropriate (SQQQ, DRIP, DUST, etc.)

Target 15-40 total unique tickers across all themes.

IMPORTANT: Output ONLY valid JSON, no markdown fences, no explanation outside JSON.

STRICT TICKER RULES:
- Recommend ONLY US-listed stocks or ETFs that are tradable in Yahoo Finance with the exact symbol.
- Do NOT include stablecoins, token symbols, crypto pairs, private companies, or CUSIPs.
- Prioritize liquid instruments with clear directional reaction to current macro/news catalysts.

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
