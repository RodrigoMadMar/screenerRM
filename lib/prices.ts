// eslint-disable-next-line @typescript-eslint/no-explicit-any
import yahooFinanceModule from 'yahoo-finance2';
const yahooFinance = yahooFinanceModule as any;

// Suppress Yahoo Finance survey notices that can interfere with requests
try { yahooFinance.suppressNotices(['yahooSurvey']); } catch { /* ignore */ }

import { Candle } from './types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSingleTicker(symbol: string, days = 120): Promise<Candle[] | null> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await yahooFinance.historical(
      symbol,
      {
        period1: startDate,
        period2: endDate,
        interval: '1d',
      },
      {
        validateResult: false,
        fetchOptions: {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        },
      },
    );

    if (!result || result.length < 20) {
      console.warn(`[prices] ${symbol}: only ${result?.length ?? 0} bars returned`);
      return null;
    }

    return result
      .filter((bar: any) => bar.open != null && bar.high != null && bar.low != null && bar.close != null)
      .map((bar: any) => ({
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      }));
  } catch (err) {
    console.error(`[prices] Failed to fetch ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function fetchPrices(symbols: string[]): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();
  const unique = Array.from(new Set(symbols));

  console.log(`[prices] Fetching ${unique.length} tickers in batches of ${BATCH_SIZE}`);

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(sym => fetchSingleTicker(sym)));

    for (let j = 0; j < batch.length; j++) {
      const res = settled[j];
      if (res.status === 'fulfilled' && res.value) {
        results.set(batch[j], res.value);
      }
    }

    if (i + BATCH_SIZE < unique.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[prices] Success: ${results.size}/${unique.length} tickers`);
  return results;
}

export function getCurrentPrice(candles: Candle[]): { price: number; change: number; changePct: number } {
  if (candles.length < 2) {
    const price = candles[0]?.close ?? 0;
    return { price, change: 0, changePct: 0 };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last.close - prev.close;
  const changePct = prev.close !== 0 ? (change / prev.close) * 100 : 0;

  return { price: last.close, change, changePct };
}
