import { Candle } from './types';

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 0;
const MAX_TICKERS = 55;

// Browser-like headers to avoid bot detection
const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSingleTicker(symbol: string, days = 120): Promise<Candle[] | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  // Try query1 first, fall back to query2
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

  for (const host of hosts) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${start}&period2=${end}&interval=1d&events=history&includeAdjustedClose=true`;

      const res = await fetch(url, {
        headers: YF_HEADERS,
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        console.error(`[prices] ${symbol} (${host}): HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const result = json?.chart?.result?.[0];

      if (!result) {
        const errMsg = json?.chart?.error?.description ?? 'no chart result';
        console.warn(`[prices] ${symbol}: ${errMsg}`);
        continue;
      }

      const timestamps: number[] = result.timestamp ?? [];
      const quote = result.indicators?.quote?.[0];

      if (!quote || timestamps.length < 20) {
        console.warn(`[prices] ${symbol}: only ${timestamps.length} bars`);
        continue;
      }

      const candles: Candle[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({
          date: new Date(timestamps[i] * 1000),
          open: o,
          high: h,
          low: l,
          close: c,
          volume: quote.volume?.[i] ?? 0,
        });
      }

      if (candles.length < 20) return null;
      return candles;
    } catch (err) {
      console.error(`[prices] ${symbol} (${host}):`, err instanceof Error ? err.message : err);
    }
  }

  return null;
}

export async function fetchPrices(symbols: string[]): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();
  const unique = Array.from(new Set(symbols)).slice(0, MAX_TICKERS);

  console.log(`[prices] Fetching ${unique.length} tickers (capped at ${MAX_TICKERS})`);

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(sym => fetchSingleTicker(sym)));

    for (let j = 0; j < batch.length; j++) {
      const res = settled[j];
      if (res.status === 'fulfilled' && res.value) {
        results.set(batch[j], res.value);
      }
    }

    if (BATCH_DELAY_MS > 0 && i + BATCH_SIZE < unique.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`[prices] ${results.size}/${unique.length} succeeded`);
  return results;
}

export function getCurrentPrice(candles: Candle[]): { price: number; change: number; changePct: number } {
  if (candles.length < 2) {
    return { price: candles[0]?.close ?? 0, change: 0, changePct: 0 };
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last.close - prev.close;
  const changePct = prev.close !== 0 ? (change / prev.close) * 100 : 0;
  return { price: last.close, change, changePct };
}
