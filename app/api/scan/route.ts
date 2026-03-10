import { NextRequest, NextResponse } from 'next/server';
import { fetchNews, analyzeWithClaude } from '@/lib/macro';
import { fetchPrices, getCurrentPrice } from '@/lib/prices';
import { detect } from '@/lib/detection';
import { score } from '@/lib/scoring';
import { ScanResponse, Instrument } from '@/lib/types';

export const maxDuration = 60;

// Core universe always scanned regardless of news — ensures the screener
// always has baseline coverage even when Claude returns few dynamic tickers.
const CORE_SYMBOLS = new Set([
  // Broad market
  'SPY', 'QQQ', 'IWM', 'DIA',
  // Sectors
  'XLK', 'XLE', 'XLF', 'XLI', 'XLV', 'XLC', 'XLY', 'XLP', 'XLB', 'XLRE', 'XLU',
  // Volatility / hedges
  'VXX', 'UVXY', 'TLT', 'HYG', 'LQD',
  // Commodities
  'GLD', 'SLV', 'GDX', 'USO', 'UNG',
  // Leveraged long
  'TQQQ', 'UPRO', 'SOXL', 'NUGT', 'FNGU',
  // Leveraged inverse
  'SQQQ', 'SPXS', 'DUST', 'DRIP',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userPrompt: string | undefined = body?.prompt;

    // ── Phase 1+2 & 3-core run in PARALLEL ──────────────────────────────────
    // Pre-fetch core symbols while Claude is processing news — saves ~12s
    const [macro, coreMap] = await Promise.all([
      (async () => {
        const headlines = await fetchNews();
        if (headlines.length === 0) throw new Error('No headlines available');
        return analyzeWithClaude(headlines, userPrompt);
      })(),
      fetchPrices(Array.from(CORE_SYMBOLS)),
    ]);

    if (!macro.allTickers || macro.allTickers.length === 0) {
      return NextResponse.json({ error: 'Claude returned no tickers' }, { status: 500 });
    }

    // ── Phase 3: Fetch only the NEW dynamic tickers Claude suggested ─────────
    const dynamicSymbols = macro.allTickers.map(t => t.symbol);
    const newSymbols = dynamicSymbols.filter(s => !CORE_SYMBOLS.has(s));

    console.log(`[scan] ${dynamicSymbols.length} Claude tickers, ${newSymbols.length} new (not in core)`);

    const dynamicMap = await fetchPrices(newSymbols);

    // Merge core + dynamic maps
    const priceMap = new Map([...coreMap, ...dynamicMap]);

    // ── Phase 4: Score each instrument ──────────────────────────────────────
    const instruments: Instrument[] = [];

    // Build lookup from Claude's tickers
    const claudeTickerMap = new Map(macro.allTickers.map(t => [t.symbol, t]));

    // Score every symbol we have price data for (dynamic + core)
    for (const [symbol, candles] of Array.from(priceMap.entries())) {
      if (!candles || candles.length < 20) continue;

      // Use Claude's recommendation if available, otherwise create a neutral core entry
      const rec = claudeTickerMap.get(symbol) ?? {
        symbol,
        name: symbol,
        type: 'etf' as const,
        bias: 'neutral' as const,
        rationale: 'Core market instrument included for baseline coverage.',
        theme: 'Core Universe',
      };

      const detection = detect(candles);
      const { price, change, changePct } = getCurrentPrice(candles);
      const { scoreBreakdown, overallBias, signals } = score(candles, detection, rec);
      const openFVGs = detection.fvgs.filter(f => !f.filled);

      instruments.push({
        symbol: rec.symbol,
        name: rec.name,
        type: rec.type,
        leverage: rec.leverage,
        macroBias: rec.bias,
        macroRationale: rec.rationale,
        theme: rec.theme,
        currentPrice: price,
        priceChange: change,
        priceChangePct: changePct,
        candles,
        detection,
        score: scoreBreakdown,
        overallBias,
        signals,
        openFVGs,
      });
    }

    // Sort by total score descending
    instruments.sort((a, b) => b.score.total - a.score.total);

    const response: ScanResponse = {
      macro,
      instruments,
      scannedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[scan] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
