'use client';

import { useState, useCallback } from 'react';
import { ScanResponse, Instrument, MacroRegime, Bias, TickerType, ThemeCluster } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function regimeColor(regime: MacroRegime) {
  switch (regime) {
    case 'RISK-ON':   return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
    case 'RISK-OFF':  return 'text-red-400 bg-red-400/10 border-red-400/30';
    case 'ROTATION':  return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
    default:          return 'text-slate-400 bg-slate-400/10 border-slate-400/30';
  }
}

function biasColor(bias: Bias) {
  if (bias === 'bullish') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  if (bias === 'bearish') return 'text-red-400 bg-red-400/10 border-red-400/20';
  return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
}

function biasLabel(bias: Bias) {
  if (bias === 'bullish') return '▲ Bullish';
  if (bias === 'bearish') return '▼ Bearish';
  return '◆ Neutral';
}

function typeLabel(type: TickerType, leverage?: number) {
  if (type === 'leveraged_etf') return leverage ? `${leverage}x ETF` : 'Lev ETF';
  if (type === 'etf') return 'ETF';
  return 'Stock';
}

function typeColor(type: TickerType) {
  if (type === 'leveraged_etf') return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
  if (type === 'etf') return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
  return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20';
}

function signalTypeColor(type: string) {
  switch (type) {
    case 'fvg':    return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
    case 'sweep':  return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'bos':    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'macro':  return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'volume': return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
    default:       return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

function fmtPrice(price: number) {
  if (price < 1) return price.toFixed(4);
  if (price < 10) return price.toFixed(3);
  return price.toFixed(2);
}

function fmtChange(val: number, pct: number) {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${fmtPrice(val)} (${sign}${pct.toFixed(2)}%)`;
}

// ─── Mini SVG Candle Chart ────────────────────────────────────────────────────

function MiniChart({ instrument }: { instrument: Instrument }) {
  const candles = instrument.candles.slice(-30);
  const W = 120, H = 40;
  if (candles.length < 2) return <div className="w-[120px] h-[40px] bg-surface-2 rounded" />;

  const allHighs = candles.map(c => c.high);
  const allLows  = candles.map(c => c.low);
  const maxP = Math.max(...allHighs);
  const minP = Math.min(...allLows);
  const range = maxP - minP || 1;

  const toX = (i: number) => (i / (candles.length - 1)) * W;
  const toY = (p: number) => H - ((p - minP) / range) * H;

  const barW = Math.max(1, W / candles.length - 1);

  return (
    <svg width={W} height={H} className="rounded overflow-hidden">
      {/* FVG zones */}
      {instrument.openFVGs.slice(-5).map((fvg, i) => {
        const top = toY(fvg.top);
        const bot = toY(fvg.bottom);
        return (
          <rect
            key={i}
            x={0} y={Math.min(top, bot)}
            width={W} height={Math.abs(top - bot)}
            fill={fvg.direction === 'bullish' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}
          />
        );
      })}
      {/* Candles */}
      {candles.map((c, i) => {
        const x = toX(i);
        const openY = toY(c.open);
        const closeY = toY(c.close);
        const highY = toY(c.high);
        const lowY = toY(c.low);
        const bull = c.close >= c.open;
        const color = bull ? '#10b981' : '#ef4444';
        const bodyTop = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(openY - closeY));

        return (
          <g key={i}>
            <line x1={x + barW / 2} y1={highY} x2={x + barW / 2} y2={lowY} stroke={color} strokeWidth={0.5} />
            <rect x={x} y={bodyTop} width={barW} height={bodyH} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const R = 18;
  const circ = 2 * Math.PI * R;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center w-12 h-12">
      <svg width={48} height={48} className="-rotate-90">
        <circle cx={24} cy={24} r={R} fill="none" stroke="#1a1a2a" strokeWidth={4} />
        <circle
          cx={24} cy={24} r={R}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="score-ring"
        />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

// ─── Instrument Row ───────────────────────────────────────────────────────────

function InstrumentRow({
  instrument,
  onClick,
}: {
  instrument: Instrument;
  onClick: () => void;
}) {
  const chgColor = instrument.priceChangePct >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-xl bg-[#0c0c14] hover:bg-[#12121e] border border-[#1a1a2a] hover:border-[#2d2d45] cursor-pointer transition-all group animate-fade-up"
    >
      {/* Symbol + badges */}
      <div className="w-28 flex-shrink-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-mono font-bold text-sm text-white">{instrument.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeColor(instrument.type)}`}>
            {typeLabel(instrument.type, instrument.leverage)}
          </span>
        </div>
        <span className="text-[11px] text-slate-500 truncate block max-w-[110px]">{instrument.name}</span>
      </div>

      {/* Price */}
      <div className="w-24 flex-shrink-0">
        <div className="font-mono text-sm font-medium text-white">${fmtPrice(instrument.currentPrice)}</div>
        <div className={`font-mono text-[11px] ${chgColor}`}>{fmtChange(instrument.priceChange, instrument.priceChangePct)}</div>
      </div>

      {/* Mini chart */}
      <div className="flex-shrink-0 hidden sm:block">
        <MiniChart instrument={instrument} />
      </div>

      {/* Signals */}
      <div className="flex-1 flex flex-wrap gap-1 min-w-0">
        {instrument.signals.slice(0, 3).map((sig, i) => (
          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${signalTypeColor(sig.type)}`}>
            {sig.label}
          </span>
        ))}
      </div>

      {/* Bias */}
      <div className="w-20 flex-shrink-0 text-right hidden md:block">
        <span className={`text-[11px] px-2 py-1 rounded border font-medium ${biasColor(instrument.overallBias)}`}>
          {biasLabel(instrument.overallBias)}
        </span>
      </div>

      {/* Score */}
      <div className="flex-shrink-0">
        <ScoreRing score={instrument.score.total} />
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ instrument, onClose }: { instrument: Instrument; onClose: () => void }) {
  const candles = instrument.candles.slice(-60);
  const W = 480, H = 180;
  const allHighs = candles.map(c => c.high);
  const allLows  = candles.map(c => c.low);
  const maxP = Math.max(...allHighs);
  const minP = Math.min(...allLows);
  const range = maxP - minP || 1;

  const toX = (i: number) => (i / (candles.length - 1)) * W;
  const toY = (p: number) => H - ((p - minP) / range) * H;
  const barW = Math.max(2, W / candles.length - 1);

  const maxVol = Math.max(...candles.map(c => c.volume));

  const sb = instrument.score;
  const scoreItems = [
    { label: 'FVG', value: sb.fvg, max: 30 },
    { label: 'Sweeps', value: sb.sweeps, max: 25 },
    { label: 'BOS', value: sb.bos, max: 25 },
    { label: 'Macro', value: sb.macro, max: 15 },
    { label: 'Volume', value: sb.volume, max: 5 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-[#0c0c14] border border-[#2d2d45] rounded-2xl overflow-auto max-h-[calc(100vh-2rem)] animate-slide-in shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#1a1a2a]">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-lg text-white">{instrument.symbol}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${typeColor(instrument.type)}`}>
                  {typeLabel(instrument.type, instrument.leverage)}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${biasColor(instrument.overallBias)}`}>
                  {biasLabel(instrument.overallBias)}
                </span>
              </div>
              <span className="text-sm text-slate-400">{instrument.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ScoreRing score={instrument.score.total} />
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-xl leading-none">×</button>
          </div>
        </div>

        {/* Price */}
        <div className="px-4 py-3 flex items-center gap-4">
          <span className="font-mono text-2xl font-bold text-white">${fmtPrice(instrument.currentPrice)}</span>
          <span className={`font-mono text-sm ${instrument.priceChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtChange(instrument.priceChange, instrument.priceChangePct)} today
          </span>
        </div>

        {/* Chart with volume */}
        <div className="px-4 pb-2">
          <svg width={W} height={H + 30} className="rounded overflow-hidden w-full" viewBox={`0 0 ${W} ${H + 30}`}>
            {/* FVG zones */}
            {instrument.openFVGs.slice(-8).map((fvg, i) => {
              const top = toY(fvg.top);
              const bot = toY(fvg.bottom);
              return (
                <rect
                  key={i}
                  x={0} y={Math.min(top, bot)}
                  width={W} height={Math.abs(top - bot)}
                  fill={fvg.direction === 'bullish' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}
                />
              );
            })}
            {/* Candles */}
            {candles.map((c, i) => {
              const x = toX(i);
              const openY = toY(c.open);
              const closeY = toY(c.close);
              const highY = toY(c.high);
              const lowY = toY(c.low);
              const bull = c.close >= c.open;
              const color = bull ? '#10b981' : '#ef4444';
              const bodyTop = Math.min(openY, closeY);
              const bodyH = Math.max(1, Math.abs(openY - closeY));
              const volH = maxVol > 0 ? (c.volume / maxVol) * 28 : 0;

              return (
                <g key={i}>
                  <line x1={x + barW / 2} y1={highY} x2={x + barW / 2} y2={lowY} stroke={color} strokeWidth={0.7} />
                  <rect x={x} y={bodyTop} width={barW} height={bodyH} fill={color} />
                  {/* Volume bar */}
                  <rect x={x} y={H + 30 - volH} width={barW} height={volH} fill={color} opacity={0.4} />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Score breakdown */}
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Score Breakdown</h3>
          <div className="space-y-2">
            {scoreItems.map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-14">{item.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[#1a1a2a] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
                    style={{ width: `${(item.value / item.max) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-white w-12 text-right">{item.value}/{item.max}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signals */}
        {instrument.signals.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Signals</h3>
            <div className="space-y-2">
              {instrument.signals.map((sig, i) => (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border ${signalTypeColor(sig.type)}`}>
                  <span className="text-xs font-medium">{sig.label}</span>
                  <span className="text-xs opacity-70 ml-auto">{sig.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open FVGs */}
        {instrument.openFVGs.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Open FVGs</h3>
            <div className="space-y-1.5">
              {instrument.openFVGs.slice(-5).map((fvg, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-[#12121e] border border-[#1a1a2a]">
                  <span className={fvg.direction === 'bullish' ? 'text-emerald-400' : 'text-red-400'}>
                    {fvg.direction === 'bullish' ? '▲' : '▼'} {fvg.direction}
                  </span>
                  <span className="font-mono text-slate-300">
                    ${fmtPrice(fvg.bottom)} – ${fmtPrice(fvg.top)}
                  </span>
                  <span className="text-slate-500">{fvg.atrRatio.toFixed(2)}x ATR</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Macro rationale */}
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Macro Rationale</h3>
          <div className="text-sm text-slate-300 leading-relaxed p-3 rounded-lg bg-[#12121e] border border-[#1a1a2a]">
            <span className="text-xs text-violet-400 font-medium block mb-1">{instrument.theme}</span>
            {instrument.macroRationale}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Scan Overlay ─────────────────────────────────────────────────────────────

const PHASES = [
  'Obteniendo noticias del mercado...',
  'Claude analizando contexto macro...',
  'Obteniendo datos de precios...',
  'Ejecutando scoring de confluencia...',
];

function ScanOverlay({ phase }: { phase: number }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="text-center max-w-xs w-full px-6">
        <div className="mb-6">
          <div className="w-12 h-12 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin mx-auto" />
        </div>
        <div className="space-y-2 mb-6">
          {PHASES.map((p, i) => (
            <div
              key={i}
              className={`text-sm transition-all duration-500 ${
                i < phase ? 'text-emerald-400 line-through opacity-50'
                : i === phase ? 'text-white animate-scan-pulse'
                : 'text-slate-600'
              }`}
            >
              {i < phase ? '✓ ' : i === phase ? '◈ ' : '○ '}
              {p}
            </div>
          ))}
        </div>
        <div className="h-0.5 bg-[#1a1a2a] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-700"
            style={{ width: `${((phase + 1) / PHASES.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Macro Banner ─────────────────────────────────────────────────────────────

function MacroBanner({ macro }: { macro: ScanResponse['macro'] }) {
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);

  return (
    <div className="mb-6 rounded-2xl border border-[#1a1a2a] bg-[#0c0c14] overflow-hidden">
      <div className="p-4 flex items-start gap-4">
        <div className="flex-shrink-0">
          <span className={`text-sm font-bold px-3 py-1.5 rounded-lg border ${regimeColor(macro.regime)}`}>
            {macro.regime}
          </span>
          <div className="text-center mt-1">
            <span className="text-[11px] text-slate-500">{macro.confidence}% conf.</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-300 leading-relaxed">{macro.summary}</p>
        </div>
      </div>

      {/* Theme clusters */}
      <div className="border-t border-[#1a1a2a] px-4 pb-4 pt-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Temas Identificados</h3>
        <div className="flex flex-wrap gap-2">
          {(macro.themes as ThemeCluster[]).map(theme => (
            <button
              key={theme.name}
              onClick={() => setExpandedTheme(expandedTheme === theme.name ? null : theme.name)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#2d2d45] bg-[#12121e] text-slate-300 hover:border-violet-500/50 hover:text-white transition-all"
            >
              {theme.name} ({theme.tickers.length})
            </button>
          ))}
        </div>

        {expandedTheme && (() => {
          const theme = (macro.themes as ThemeCluster[]).find(t => t.name === expandedTheme);
          if (!theme) return null;
          return (
            <div className="mt-3 p-3 rounded-xl bg-[#12121e] border border-[#2d2d45] animate-fade-up">
              <p className="text-xs text-slate-400 mb-2">{theme.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {theme.tickers.map(t => (
                  <span key={t.symbol} className={`text-xs px-2 py-1 rounded border font-mono ${biasColor(t.bias)}`}>
                    {t.symbol}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

type FilterType = 'all' | TickerType;
type FilterBias = 'all' | Bias;
type SortKey = 'score' | 'name' | 'change' | 'theme';

interface Filters {
  type: FilterType;
  bias: FilterBias;
  sort: SortKey;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const typeOpts: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'stock', label: 'Stocks' },
    { value: 'etf', label: 'ETFs' },
    { value: 'leveraged_etf', label: 'Apalancados' },
  ];
  const biasOpts: { value: FilterBias; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'bullish', label: '▲ Bullish' },
    { value: 'bearish', label: '▼ Bearish' },
    { value: 'neutral', label: '◆ Neutral' },
  ];
  const sortOpts: { value: SortKey; label: string }[] = [
    { value: 'score', label: 'Score' },
    { value: 'name', label: 'Nombre' },
    { value: 'change', label: 'Cambio%' },
    { value: 'theme', label: 'Tema' },
  ];

  const btnClass = (active: boolean) =>
    `text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
      active
        ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
        : 'bg-[#12121e] border-[#1a1a2a] text-slate-400 hover:border-[#2d2d45] hover:text-slate-300'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex gap-1">
        {typeOpts.map(o => (
          <button key={o.value} className={btnClass(filters.type === o.value)} onClick={() => onChange({ ...filters, type: o.value })}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="w-px h-5 bg-[#1a1a2a]" />
      <div className="flex gap-1">
        {biasOpts.map(o => (
          <button key={o.value} className={btnClass(filters.bias === o.value)} onClick={() => onChange({ ...filters, bias: o.value })}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <span className="text-xs text-slate-500 mr-1">Orden:</span>
        {sortOpts.map(o => (
          <button key={o.value} className={btnClass(filters.sort === o.value)} onClick={() => onChange({ ...filters, sort: o.value })}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focusPrompt, setFocusPrompt] = useState('');
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [filters, setFilters] = useState<Filters>({ type: 'all', bias: 'all', sort: 'score' });

  const startScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setScanPhase(0);

    // Simulate phase progression for UX
    const phaseInterval = setInterval(() => {
      setScanPhase(p => Math.min(p + 1, 3));
    }, 5000);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: focusPrompt || undefined }),
      });

      clearInterval(phaseInterval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data: ScanResponse = await res.json();
      setScanData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      clearInterval(phaseInterval);
      setScanning(false);
    }
  }, [focusPrompt]);

  // Apply filters + sort
  const instruments = (() => {
    if (!scanData) return [];
    let list = [...scanData.instruments];

    if (filters.type !== 'all') list = list.filter(i => i.type === filters.type);
    if (filters.bias !== 'all') list = list.filter(i => i.overallBias === filters.bias);

    list.sort((a, b) => {
      if (filters.sort === 'score') return b.score.total - a.score.total;
      if (filters.sort === 'name') return a.symbol.localeCompare(b.symbol);
      if (filters.sort === 'change') return b.priceChangePct - a.priceChangePct;
      if (filters.sort === 'theme') return a.theme.localeCompare(b.theme);
      return 0;
    });

    return list;
  })();

  return (
    <main className="min-h-screen bg-[#06060a] text-slate-200">
      {scanning && <ScanOverlay phase={scanPhase} />}
      {selected && <DetailPanel instrument={selected} onClose={() => setSelected(null)} />}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
              F
            </div>
            <h1 className="text-2xl font-bold text-white">FVG Macro Screener</h1>
          </div>
          <p className="text-sm text-slate-500">
            SMC confluencia + contexto macro en tiempo real. Powered by Claude + Yahoo Finance.
          </p>
        </div>

        {/* Scan control */}
        <div className="flex gap-3 mb-8">
          <input
            type="text"
            value={focusPrompt}
            onChange={e => setFocusPrompt(e.target.value)}
            placeholder='Foco opcional (ej: "energía", "mercados emergentes", "ignora tech")'
            className="flex-1 bg-[#0c0c14] border border-[#1a1a2a] rounded-xl px-4 py-3 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
            onKeyDown={e => e.key === 'Enter' && !scanning && startScan()}
          />
          <button
            onClick={startScan}
            disabled={scanning}
            className="px-6 py-3 bg-gradient-to-r from-violet-500 to-blue-600 hover:from-violet-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-violet-500/20 whitespace-nowrap"
          >
            {scanning ? 'Escaneando...' : 'Scan Market'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            ⚠ {error}
          </div>
        )}

        {/* Results */}
        {scanData && (
          <>
            {/* Macro banner */}
            <MacroBanner macro={scanData.macro} />

            {/* Stats row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{scanData.instruments.length} instrumentos escaneados</span>
                <span>•</span>
                <span>{instruments.length} mostrados</span>
                <span>•</span>
                <span>Actualizado {new Date(scanData.scannedAt).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* Filters */}
            <FilterBar filters={filters} onChange={setFilters} />

            {/* Instrument list */}
            <div className="space-y-2">
              {instruments.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">
                  No hay instrumentos con los filtros seleccionados.
                </div>
              ) : (
                instruments.map(inst => (
                  <InstrumentRow
                    key={inst.symbol}
                    instrument={inst}
                    onClick={() => setSelected(inst)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!scanData && !scanning && (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-600/20 border border-violet-500/20 flex items-center justify-center mx-auto mb-4 text-2xl">
              📊
            </div>
            <h2 className="text-lg font-semibold text-slate-300 mb-2">Listo para escanear</h2>
            <p className="text-sm text-slate-500 max-w-xs mx-auto">
              Haz click en "Scan Market" para analizar el contexto macro actual y descubrir oportunidades de trading con confluencia SMC.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
