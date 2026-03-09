import { Candle, DetectionResult, ScoreBreakdown, SignalBadge, Bias, TickerRecommendation } from './types';

const RECENT_BARS = 5;

// ─── FVG Score (max 30) ───────────────────────────────────────────────────────

function scoreFVG(detection: DetectionResult, totalCandles: number): { score: number; signals: SignalBadge[] } {
  const openFVGs = detection.fvgs.filter(f => !f.filled);
  if (openFVGs.length === 0) return { score: 0, signals: [] };

  let raw = 0;
  const signals: SignalBadge[] = [];
  const recentCutoff = totalCandles - RECENT_BARS;

  for (const fvg of openFVGs) {
    let pts = 8 + fvg.atrRatio * 4;
    if (fvg.index >= recentCutoff) pts += 5;
    raw += pts;
  }

  const score = Math.min(30, raw);
  signals.push({
    label: `${openFVGs.length} Open FVG${openFVGs.length > 1 ? 's' : ''}`,
    type: 'fvg',
    detail: `${openFVGs.filter(f => f.index >= recentCutoff).length} recent, avg ${(openFVGs.reduce((s, f) => s + f.atrRatio, 0) / openFVGs.length).toFixed(2)}x ATR`,
  });

  return { score, signals };
}

// ─── Liquidity Sweep Score (max 25) ───────────────────────────────────────────

function scoreSweeps(detection: DetectionResult, totalCandles: number): { score: number; signals: SignalBadge[] } {
  if (detection.liquiditySweeps.length === 0) return { score: 0, signals: [] };

  let raw = 0;
  const signals: SignalBadge[] = [];
  const recentSweeps = detection.liquiditySweeps.filter(s => s.index >= totalCandles - RECENT_BARS * 4);

  for (const sweep of recentSweeps) {
    const pts = 12 + sweep.reversalStrength * 8;
    raw += pts;
  }

  const score = Math.min(25, raw);
  const equalCount = recentSweeps.filter(s => s.isEqualLevel).length;

  signals.push({
    label: `${recentSweeps.length} Liquidity Sweep${recentSweeps.length !== 1 ? 's' : ''}`,
    type: 'sweep',
    detail: equalCount > 0 ? `${equalCount} equal-level sweep${equalCount > 1 ? 's' : ''}` : `avg reversal ${(recentSweeps.reduce((s, sw) => s + sw.reversalStrength, 0) / recentSweeps.length).toFixed(2)}`,
  });

  return { score, signals };
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
  bosScore: number,
  bosBias: 'bullish' | 'bearish' | null,
  sweepScore: number,
  detection: DetectionResult,
  macroBias: Bias,
): Bias {
  const bullishFVGs = detection.fvgs.filter(f => !f.filled && f.direction === 'bullish').length;
  const bearishFVGs = detection.fvgs.filter(f => !f.filled && f.direction === 'bearish').length;
  const bullishSweeps = detection.liquiditySweeps.filter(s => s.type === 'low').length; // sweep of lows = bullish intent
  const bearishSweeps = detection.liquiditySweeps.filter(s => s.type === 'high').length;

  let bullScore = (bosBias === 'bullish' ? bosScore : 0) + bullishFVGs * 5 + bullishSweeps * 4;
  let bearScore = (bosBias === 'bearish' ? bosScore : 0) + bearishFVGs * 5 + bearishSweeps * 4;

  // Macro tiebreak
  if (macroBias === 'bullish') bullScore += 3;
  if (macroBias === 'bearish') bearScore += 3;

  void sweepScore;

  if (bullScore > bearScore + 5) return 'bullish';
  if (bearScore > bullScore + 5) return 'bearish';
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
  const macroResult = scoreMacro(recommendation.bias, bosResult.bias);
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
    bosResult.score,
    bosResult.bias,
    sweepResult.score,
    detection,
    recommendation.bias,
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
