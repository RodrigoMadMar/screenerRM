import { Candle, FVG, SwingPoint, LiquiditySweep, BreakOfStructure, DetectionResult } from './types';

// ─── ATR ─────────────────────────────────────────────────────────────────────

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 1;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ─── FVG Detection ────────────────────────────────────────────────────────────

export function detectFVGs(candles: Candle[], atr: number): FVG[] {
  const fvgs: FVG[] = [];
  const minSize = atr * 0.25;

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish FVG: gap between prev.high and next.low (next candle doesn't overlap prev)
    if (next.low > prev.high) {
      const size = next.low - prev.high;
      if (size >= minSize) {
        fvgs.push({
          index: i,
          top: next.low,
          bottom: prev.high,
          direction: 'bullish',
          filled: false,
          atrRatio: size / atr,
        });
      }
    }

    // Bearish FVG: gap between next.high and prev.low
    if (next.high < prev.low) {
      const size = prev.low - next.high;
      if (size >= minSize) {
        fvgs.push({
          index: i,
          top: prev.low,
          bottom: next.high,
          direction: 'bearish',
          filled: false,
          atrRatio: size / atr,
        });
      }
    }

    void curr; // suppress unused warning
  }

  // Mark filled FVGs: a bullish FVG is filled when price trades below its bottom;
  // a bearish FVG is filled when price trades above its top.
  for (const fvg of fvgs) {
    for (let j = fvg.index + 2; j < candles.length; j++) {
      if (fvg.direction === 'bullish' && candles[j].low <= fvg.bottom) {
        fvg.filled = true;
        break;
      }
      if (fvg.direction === 'bearish' && candles[j].high >= fvg.top) {
        fvg.filled = true;
        break;
      }
    }
  }

  return fvgs;
}

// ─── Swing Points ─────────────────────────────────────────────────────────────

export function detectSwingPoints(candles: Candle[], lookback = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const curr = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= curr.high) isSwingHigh = false;
      if (candles[j].low <= curr.low) isSwingLow = false;
    }

    if (isSwingHigh) swings.push({ index: i, price: curr.high, type: 'high' });
    if (isSwingLow) swings.push({ index: i, price: curr.low, type: 'low' });
  }

  return swings;
}

// ─── Equal High/Low Detection ─────────────────────────────────────────────────

function isEqualLevel(a: number, b: number, atr: number): boolean {
  return Math.abs(a - b) < atr * 0.1;
}

// ─── Liquidity Sweeps ─────────────────────────────────────────────────────────

export function detectLiquiditySweeps(
  candles: Candle[],
  swings: SwingPoint[],
  atr: number,
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];

  for (const swing of swings) {
    // Look for candles after the swing that breach the level then reverse
    for (let i = swing.index + 1; i < candles.length; i++) {
      const c = candles[i];

      if (swing.type === 'high') {
        // Price wicks above the swing high but closes below it → sweep
        if (c.high > swing.price && c.close < swing.price) {
          const reversalStrength = Math.min(1, (swing.price - c.close) / atr);
          // Check for equal highs (cluster)
          const equalCount = swings.filter(
            s => s.type === 'high' && s.index < i && isEqualLevel(s.price, swing.price, atr),
          ).length;

          sweeps.push({
            index: i,
            type: 'high',
            sweptPrice: swing.price,
            reversalStrength: equalCount > 1 ? Math.min(1, reversalStrength * 1.5) : reversalStrength,
            isEqualLevel: equalCount > 1,
          });
          break; // one sweep per swing
        }
      } else {
        // Price wicks below swing low but closes above it → sweep
        if (c.low < swing.price && c.close > swing.price) {
          const reversalStrength = Math.min(1, (c.close - swing.price) / atr);
          const equalCount = swings.filter(
            s => s.type === 'low' && s.index < i && isEqualLevel(s.price, swing.price, atr),
          ).length;

          sweeps.push({
            index: i,
            type: 'low',
            sweptPrice: swing.price,
            reversalStrength: equalCount > 1 ? Math.min(1, reversalStrength * 1.5) : reversalStrength,
            isEqualLevel: equalCount > 1,
          });
          break;
        }
      }
    }
  }

  return sweeps;
}

// ─── Break of Structure ───────────────────────────────────────────────────────

export function detectBOS(candles: Candle[], swings: SwingPoint[], atr: number): BreakOfStructure[] {
  const bosEvents: BreakOfStructure[] = [];
  const highs = swings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
  const lows = swings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

  // Track last relevant swing levels
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    // Update swing references up to this candle
    const latestHigh = highs.filter(s => s.index < i).slice(-1)[0];
    const latestLow = lows.filter(s => s.index < i).slice(-1)[0];

    if (latestHigh && latestHigh !== lastSwingHigh) {
      // Check bullish BOS: close above last swing high
      if (c.close > latestHigh.price) {
        const breakStrength = Math.min(1, (c.close - latestHigh.price) / atr);
        bosEvents.push({
          index: i,
          type: 'bullish',
          breakLevel: latestHigh.price,
          breakStrength,
        });
        lastSwingHigh = latestHigh;
      }
    }

    if (latestLow && latestLow !== lastSwingLow) {
      // Check bearish BOS: close below last swing low
      if (c.close < latestLow.price) {
        const breakStrength = Math.min(1, (latestLow.price - c.close) / atr);
        bosEvents.push({
          index: i,
          type: 'bearish',
          breakLevel: latestLow.price,
          breakStrength,
        });
        lastSwingLow = latestLow;
      }
    }
  }

  return bosEvents;
}

// ─── Main detect function ────────────────────────────────────────────────────

export function detect(candles: Candle[]): DetectionResult {
  if (candles.length < 20) {
    return { fvgs: [], swingPoints: [], liquiditySweeps: [], breakOfStructures: [], atr: 1 };
  }

  const atr = calcATR(candles);
  const swingPoints = detectSwingPoints(candles);
  const fvgs = detectFVGs(candles, atr);
  const liquiditySweeps = detectLiquiditySweeps(candles, swingPoints, atr);
  const breakOfStructures = detectBOS(candles, swingPoints, atr);

  return { fvgs, swingPoints, liquiditySweeps, breakOfStructures, atr };
}
