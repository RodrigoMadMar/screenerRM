import { NextRequest, NextResponse } from 'next/server';
import { fetchNews, analyzeWithClaude } from '@/lib/macro';
import { fetchPrices, getCurrentPrice } from '@/lib/prices';
import { detect } from '@/lib/detection';
import { score } from '@/lib/scoring';
import { ScanResponse, Instrument } from '@/lib/types';

export const maxDuration = 60;

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
    const symbols = macro.allTickers.map(t => t.symbol);
    const priceMap = await fetchPrices(symbols);

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
