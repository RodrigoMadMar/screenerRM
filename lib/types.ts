// ─── Candle / OHLCV ──────────────────────────────────────────────────────────

export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Detection results ────────────────────────────────────────────────────────

export interface FVG {
  index: number;          // index of the middle candle
  top: number;
  bottom: number;
  direction: 'bullish' | 'bearish';
  filled: boolean;
  atrRatio: number;       // size / ATR
}

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

export interface LiquiditySweep {
  index: number;
  type: 'high' | 'low';
  sweptPrice: number;
  reversalStrength: number; // 0-1
  isEqualLevel: boolean;
}

export interface BreakOfStructure {
  index: number;
  type: 'bullish' | 'bearish';
  breakLevel: number;
  breakStrength: number; // 0-1
}

export interface DetectionResult {
  fvgs: FVG[];
  swingPoints: SwingPoint[];
  liquiditySweeps: LiquiditySweep[];
  breakOfStructures: BreakOfStructure[];
  atr: number;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  fvg: number;
  sweeps: number;
  bos: number;
  macro: number;
  volume: number;
  total: number;
}

export interface SignalBadge {
  label: string;
  type: 'fvg' | 'sweep' | 'bos' | 'macro' | 'volume';
  detail: string;
}

// ─── Macro / Claude ───────────────────────────────────────────────────────────

export type MacroRegime = 'RISK-ON' | 'RISK-OFF' | 'NEUTRAL' | 'ROTATION';
export type TickerType = 'stock' | 'etf' | 'leveraged_etf';
export type Bias = 'bullish' | 'bearish' | 'neutral';

export interface TickerRecommendation {
  symbol: string;
  name: string;
  type: TickerType;
  leverage?: number;
  bias: Bias;
  rationale: string;
  theme: string;
}

export interface ThemeCluster {
  name: string;
  description: string;
  tickers: TickerRecommendation[];
}

export interface MacroAnalysis {
  regime: MacroRegime;
  confidence: number;  // 0-100
  summary: string;
  themes: ThemeCluster[];
  allTickers: TickerRecommendation[];
}

// ─── Instrument (final scored row) ───────────────────────────────────────────

export interface Instrument {
  symbol: string;
  name: string;
  type: TickerType;
  leverage?: number;
  macroBias: Bias;
  macroRationale: string;
  theme: string;

  // Price data
  currentPrice: number;
  priceChange: number;   // absolute change today
  priceChangePct: number;
  candles: Candle[];     // last 120 days

  // Detection
  detection: DetectionResult;

  // Scoring
  score: ScoreBreakdown;
  overallBias: Bias;
  signals: SignalBadge[];

  // Open FVGs summary
  openFVGs: FVG[];
}

// ─── Scan response ────────────────────────────────────────────────────────────

export interface ScanResponse {
  macro: MacroAnalysis;
  instruments: Instrument[];
  scannedAt: string;
}
