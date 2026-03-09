import { NextRequest, NextResponse } from 'next/server';
import { fetchNews, analyzeWithClaude } from '@/lib/macro';
import { fetchPrices, getCurrentPrice } from '@/lib/prices';
import { detect } from '@/lib/detection';
import { score } from '@/lib/scoring';
import { ScanResponse, Instrument } from '@/lib/types';
import type { Bias, TickerRecommendation } from '@/lib/types';

export const maxDuration = 60;

const FALLBACK_UNIVERSE = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLK', 'XLE', 'XLI', 'XLP', 'XLV',
  'TLT', 'GLD', 'SLV', 'USO', 'UNG', 'SMH', 'SOXX', 'NVDA', 'AAPL', 'MSFT',
  'AMZN', 'META', 'TSLA', 'JPM', 'BAC', 'XOM', 'CVX', 'AMD', 'COIN', 'MSTR',
];

function sanitizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map(s => (s ?? '').trim().toUpperCase())
        .filter(s => /^[A-Z]{1,5}$/.test(s)),
    ),
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userPrompt: string | undefined = body?.prompt;

    // ── Phase 1: Fetch news ──────────────────────────────────────────────────
    const headlines = await fetchNews();

    if (headlines.length === 0) {
      return NextResponse.json({ error: 'No headlines available' }, { status: 503 });
    }

    // ── Phase 2: Claude macro analysis ──────────────────────────────────────
    const macro = await analyzeWithClaude(headlines, userPrompt);

    if (!macro.allTickers || macro.allTickers.length === 0) {
      return NextResponse.json({ error: 'Claude returned no tickers' }, { status: 500 });
    }

    // ── Phase 3: Fetch price data ────────────────────────────────────────────
    const recommendedSymbols = sanitizeSymbols(macro.allTickers.map(t => t.symbol));
    let priceMap = await fetchPrices(recommendedSymbols);

    if (priceMap.size < 5) {
      const withFallback = sanitizeSymbols([...recommendedSymbols, ...FALLBACK_UNIVERSE]);
      priceMap = await fetchPrices(withFallback);
    }

    // ── Phase 4: Score each instrument ──────────────────────────────────────
    const instruments: Instrument[] = [];

    for (const rec of macro.allTickers) {
      const candles = priceMap.get(rec.symbol);
      if (!candles || candles.length < 20) continue;

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

    if (instruments.length < 5) {
      const used = new Set(instruments.map(i => i.symbol));
      const fallbackBias: Bias = macro.regime === 'RISK-ON' ? 'bullish' : macro.regime === 'RISK-OFF' ? 'bearish' : 'neutral';

      for (const symbol of FALLBACK_UNIVERSE) {
        if (used.has(symbol)) continue;
        const candles = priceMap.get(symbol);
        if (!candles || candles.length < 20) continue;

        const detection = detect(candles);
        const { price, change, changePct } = getCurrentPrice(candles);
        const rec: TickerRecommendation = {
          symbol,
          name: `${symbol} (Fallback)`,
          type: 'etf' as const,
          bias: fallbackBias,
          rationale: 'Instrumento agregado como fallback líquido para asegurar cruce macro + PA aun con baja cobertura de noticias.',
          theme: 'Fallback Liquidity Universe',
        };
        const { scoreBreakdown, overallBias, signals } = score(candles, detection, rec);
        const openFVGs = detection.fvgs.filter(f => !f.filled);

        instruments.push({
          symbol: rec.symbol,
          name: rec.name,
          type: rec.type,
          leverage: undefined,
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

        if (instruments.length >= 20) break;
      }
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
