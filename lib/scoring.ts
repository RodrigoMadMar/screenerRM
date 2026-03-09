import { Candle, DetectionResult, ScoreBreakdown, SignalBadge, Bias, TickerRecommendation } from './types';

const RECENT_BARS = 5;

// ─── FVG Score (max 30) ───────────────────────────────────────────────────────

function scoreFVG(
  detection: DetectionResult,
  totalCandles: number,
): { score: number; signals: SignalBadge[]; bias: 'bullish' | 'bearish' | null } {
  const openFVGs = detection.fvgs.filter(f => !f.filled);
  if (openFVGs.length === 0) return { score: 0, signals: [], bias: null };

  let raw = 0;
  const signals: SignalBadge[] = [];
  const recentCutoff = totalCandles - RECENT_BARS * 3;

  for (const fvg of openFVGs) {
    let pts = 6 + fvg.atrRatio * 4;
    if (fvg.index >= recentCutoff) pts += 4;
    raw += pts;
  }

  const score = Math.min(30, raw);
  const bullishCount = openFVGs.filter(f => f.direction === 'bullish').length;
  const bearishCount = openFVGs.length - bullishCount;
  const directionalBias = bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : null;

  signals.push({
    label: `${openFVGs.length} Open FVG${openFVGs.length > 1 ? 's' : ''}`,
    type: 'fvg',
    detail: `${bullishCount} bull / ${bearishCount} bear, avg ${(openFVGs.reduce((sum, f) => sum + f.atrRatio, 0) / openFVGs.length).toFixed(2)}x ATR`,
  });

  return { score, signals, bias: directionalBias };
}

// ─── Liquidity Sweep Score (max 25) ───────────────────────────────────────────

function scoreSweeps(
  detection: DetectionResult,
  totalCandles: number,
): { score: number; signals: SignalBadge[]; bias: 'bullish' | 'bearish' | null } {
  if (detection.liquiditySweeps.length === 0) return { score: 0, signals: [], bias: null };

  let raw = 0;
  const signals: SignalBadge[] = [];
  const recentSweeps = detection.liquiditySweeps.filter(s => s.index >= totalCandles - RECENT_BARS * 4);
  if (recentSweeps.length === 0) return { score: 0, signals: [], bias: null };

  for (const sweep of recentSweeps) {
    const pts = 10 + sweep.reversalStrength * 8;
    raw += pts;
  }

  const score = Math.min(25, raw);
  const equalCount = recentSweeps.filter(s => s.isEqualLevel).length;
  const bullishCount = recentSweeps.filter(s => s.type === 'low').length;
  const bearishCount = recentSweeps.filter(s => s.type === 'high').length;
  const directionalBias = bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : null;

  signals.push({
    label: `${recentSweeps.length} Liquidity Sweep${recentSweeps.length !== 1 ? 's' : ''}`,
    type: 'sweep',
    detail: `${bullishCount} bull / ${bearishCount} bear${equalCount > 0 ? `, ${equalCount} EQH/EQL` : ''}`,
  });

  return { score, signals, bias: directionalBias };
}

// ─── BOS Score (max 25) ───────────────────────────────────────────────────────

function scoreBOS(detection: DetectionResult, totalCandles: number): { score: number; signals: SignalBadge[]; bias: 'bullish' | 'bearish' | null } {
  if (detection.breakOfStructures.length === 0) return { score: 0, signals: [], bias: null };

  const recentBOS = detection.breakOfStructures.filter(b => b.index >= totalCandles - RECENT_BARS * 6);
  if (recentBOS.length === 0) return { score: 0, signals: [], bias: null };

  let raw = 0;
  const recentCutoff = totalCandles - RECENT_BARS;
  const signals: SignalBadge[] = [];

  for (const bos of recentBOS) {
    let pts = 10 + bos.breakStrength * 10;
    if (bos.index >= recentCutoff) pts += 5;
    raw += pts;
  }

  const score = Math.min(25, raw);

  const bullishBOS = recentBOS.filter(b => b.type === 'bullish').length;
  const bearishBOS = recentBOS.filter(b => b.type === 'bearish').length;
  const dominantBias = bullishBOS >= bearishBOS ? 'bullish' : 'bearish';

  signals.push({
    label: `BOS ${dominantBias === 'bullish' ? '↑' : '↓'}`,
    type: 'bos',
    detail: `${bullishBOS} bullish / ${bearishBOS} bearish breaks`,
  });

  return { score, signals, bias: dominantBias };
}

// ─── Macro Alignment Score (max 15) ──────────────────────────────────────────

function scoreMacro(
  macroBias: Bias,
  paBias: 'bullish' | 'bearish' | null,
): { score: number; signals: SignalBadge[] } {
  if (macroBias === 'neutral' || paBias === null) {
    return { score: 5, signals: [] };
  }

  if (macroBias === paBias) {
    return {
      score: 12,
      signals: [{ label: 'Macro Aligned', type: 'macro', detail: `PA ${paBias} matches macro bias` }],
    };
  }

  // Partial: macro has bias, PA neutral or opposite
  return { score: 5, signals: [] };
}

// ─── Volume Score (max 5) ─────────────────────────────────────────────────────

function scoreVolume(candles: Candle[]): { score: number; signals: SignalBadge[] } {
  if (candles.length < 35) return { score: 0, signals: [] };

  const recent = candles.slice(-5);
  const avgVolume30 = candles.slice(-35, -5).reduce((s, c) => s + c.volume, 0) / 30;
  const recentAvgVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;

  if (recentAvgVol > avgVolume30 * 1.5) {
    return {
      score: 5,
      signals: [{ label: 'Vol Surge', type: 'volume', detail: `${(recentAvgVol / avgVolume30).toFixed(1)}x avg volume` }],
    };
  }

  return { score: 0, signals: [] };
}

// ─── Overall Bias ─────────────────────────────────────────────────────────────

function determineOverallBias(
  detection: DetectionResult,
  macroBias: Bias,
  fvgBias: 'bullish' | 'bearish' | null,
  sweepBias: 'bullish' | 'bearish' | null,
  bosBias: 'bullish' | 'bearish' | null,
): Bias {
  const bullishBOS = detection.breakOfStructures.filter(b => b.type === 'bullish').slice(-4).length;
  const bearishBOS = detection.breakOfStructures.filter(b => b.type === 'bearish').slice(-4).length;
  const bullishSweeps = detection.liquiditySweeps.filter(s => s.type === 'low').slice(-4).length;
  const bearishSweeps = detection.liquiditySweeps.filter(s => s.type === 'high').slice(-4).length;

  let bullScore = 0;
  let bearScore = 0;

  bullScore += bullishBOS * 6;
  bearScore += bearishBOS * 6;
  bullScore += bullishSweeps * 4;
  bearScore += bearishSweeps * 4;

  if (fvgBias === 'bullish') bullScore += 6;
  if (fvgBias === 'bearish') bearScore += 6;
  if (sweepBias === 'bullish') bullScore += 5;
  if (sweepBias === 'bearish') bearScore += 5;
  if (bosBias === 'bullish') bullScore += 8;
  if (bosBias === 'bearish') bearScore += 8;

  if (macroBias === 'bullish') bullScore += 2;
  if (macroBias === 'bearish') bearScore += 2;

  if (bullScore >= bearScore + 4) return 'bullish';
  if (bearScore >= bullScore + 4) return 'bearish';
  return 'neutral';
}

// ─── Main score function ──────────────────────────────────────────────────────

export function score(
  candles: Candle[],
  detection: DetectionResult,
  recommendation: TickerRecommendation,
): { scoreBreakdown: ScoreBreakdown; overallBias: Bias; signals: SignalBadge[] } {
  const n = candles.length;

  const fvgResult = scoreFVG(detection, n);
  const sweepResult = scoreSweeps(detection, n);
  const bosResult = scoreBOS(detection, n);
  const paBias = bosResult.bias ?? sweepResult.bias ?? fvgResult.bias;
  const macroResult = scoreMacro(recommendation.bias, paBias);
  const volumeResult = scoreVolume(candles);

  const scoreBreakdown: ScoreBreakdown = {
    fvg: Math.round(fvgResult.score),
    sweeps: Math.round(sweepResult.score),
    bos: Math.round(bosResult.score),
    macro: Math.round(macroResult.score),
    volume: Math.round(volumeResult.score),
    total: 0,
  };
  scoreBreakdown.total = scoreBreakdown.fvg + scoreBreakdown.sweeps + scoreBreakdown.bos + scoreBreakdown.macro + scoreBreakdown.volume;

  const overallBias = determineOverallBias(
    detection,
    recommendation.bias,
    fvgResult.bias,
    sweepResult.bias,
    bosResult.bias,
  );

  const allSignals = [
    ...fvgResult.signals,
    ...sweepResult.signals,
    ...bosResult.signals,
    ...macroResult.signals,
    ...volumeResult.signals,
  ].slice(0, 5);

  return { scoreBreakdown, overallBias, signals: allSignals };
}
