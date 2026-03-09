# CLAUDE.md — FVG Macro Screener

## Descripción del Proyecto

Este es un screener de confluencia potenciado por IA que combina análisis de price action basado en Smart Money Concepts (SMC) con contexto macro/geopolítico en tiempo real para descubrir oportunidades de trading accionables en acciones, ETFs y ETFs apalancados.

La app corre sobre **Next.js 14 (App Router)** desplegada en **Vercel**. NO hay desarrollo local — todo el código se pushea a GitHub y se deploya automáticamente vía Vercel.

---

## Arquitectura y Stack Técnico

- **Framework**: Next.js 14 con App Router y TypeScript
- **Hosting**: Vercel (se requiere plan Pro para timeout de 60s en funciones)
- **IA**: Claude Sonnet vía API de Anthropic (análisis macro + descubrimiento de tickers)
- **Datos de Noticias**: Marketaux API (primario) + feeds RSS de Reuters/CNBC (fallback)
- **Datos de Precios**: paquete npm `yahoo-finance2` (OHLCV de Yahoo Finance — equivalente al yfinance de Python, corre nativamente en funciones serverless de Node.js)
- **Estilos**: Tailwind CSS
- **Sin base de datos** — todo se computa on-demand por cada scan

---

## Restricciones Críticas de Deploy (Vercel)

1. **Timeout de funciones**: Vercel Pro permite máximo 60s para funciones serverless. El pipeline completo de scan (fetch de noticias + análisis de Claude + fetch de precios para 20-30 tickers + scoring) toma entre 15-40s. Siempre poner `export const maxDuration = 60` en las API routes.
2. **Sin filesystem persistente**: Las funciones serverless de Vercel son stateless. No se puede escribir a disco. Todo el estado vive en el cliente (React state) o pasa a través de request/response del API.
3. **No se necesita cron**: El scan se dispara manualmente cuando el usuario hace click en "Scan Market" en el dashboard. No hay jobs en background.
4. **Variables de entorno**: `ANTHROPIC_API_KEY` y `MARKETAUX_API_KEY` se configuran en el dashboard de Vercel (Settings → Environment Variables), nunca se commitean al código.
5. **Compatibilidad con Edge**: `yahoo-finance2` y `rss-parser` requieren runtime de Node.js, NO Edge. Las API routes deben usar el runtime default de Node.js (NO agregar `export const runtime = 'edge'`).
6. **Tamaño del bundle**: Mantener `yahoo-finance2` en `serverComponentsExternalPackages` en `next.config.js` para evitar problemas de bundling.

---

## Flujo Completo del Usuario

### Paso 1: El usuario abre el dashboard
- Muestra estado vacío con botón "Scan Market"
- Input de texto opcional para prompt de foco (ej: "enfócate en energía", "qué pasa con Brasil", "ignora tech")

### Paso 2: El usuario hace click en "Scan Market"
- El frontend envía POST a `/api/scan` con opcional `{ prompt: "foco del usuario" }`
- La UI muestra overlay de escaneo con progresión de fases:
  - Fase 1: "Obteniendo noticias del mercado..."
  - Fase 2: "Claude analizando contexto macro..."
  - Fase 3: "Obteniendo datos de precios..."
  - Fase 4: "Ejecutando scoring de confluencia..."

### Paso 3: La API Route `/api/scan` orquesta el pipeline completo

**Fase 1 — Ingesta de Noticias:**
- Fetch de los últimos 50 titulares financieros de Marketaux API
- Si Marketaux falla, fallback a feeds RSS (Reuters, CNBC)
- No se necesita API key para RSS — son feeds XML públicos

**Fase 2 — Análisis Macro con Claude:**
- Se envían los titulares a Claude Sonnet vía API de Anthropic
- Claude recibe un system prompt que le instruye a:
  - Clasificar el régimen macro: RISK-ON, RISK-OFF, NEUTRAL o ROTATION
  - Identificar 3-7 clusters temáticos (cada uno una narrativa macro/geopolítica distinta)
  - Para cada tema, recomendar tickers específicos con: símbolo, nombre, tipo (stock/etf/leveraged_etf), apalancamiento si aplica, sesgo direccional (bullish/bearish) y justificación
  - Output total: 15-40 tickers únicos de TODOS los tipos (acciones individuales como NVDA/XOM, ETFs regulares como GDX/XLE, ETFs apalancados como NUGT/SOXL, y ETFs inversos como SQQQ/DRIP)
- El universo de tickers es COMPLETAMENTE DINÁMICO — Claude decide qué escanear basándose en las noticias actuales, no es un watchlist hardcodeado
- Si el usuario proporcionó un prompt de foco, se agrega al input de Claude para sesgar el análisis

**Fase 3 — Fetch de Datos de Precios:**
- Extraer todos los símbolos de tickers únicos de la respuesta de Claude
- Fetch de 120 días de OHLCV diario para cada ticker usando `yahoo-finance2`
- Requests en batches de 5 con 500ms de delay entre batches para respetar rate limits
- Saltear tickers que retornen errores (deslistados, símbolo inválido, etc.)

**Fase 4 — Scoring de Confluencia:**
- Para cada ticker con datos de precio válidos, correr el motor de detección:
  - **Detección de FVG**: Gaps de valor justo de 3 velas filtrados por ratio ATR (≥0.25x ATR). Trackear estado de llenado.
  - **Detección de Swing Points**: Identificar swing highs/lows con lookback configurable (default: 5 barras)
  - **Detección de Liquidity Sweeps**: El precio toma un swing high/low y revierte (cierre de vuelta adentro). También detecta clusters de equal highs/lows.
  - **Break of Structure (BOS)**: Cierre por encima del último swing high (bullish) o por debajo del último swing low (bearish). Mide la decisión del quiebre.
- Puntuar cada instrumento en escala 0-100:
  - FVG (sin llenar, recientes): hasta 30 pts — ponderados por cantidad, tamaño relativo al ATR y recencia
  - Liquidity Sweeps: hasta 25 pts — ponderados por cantidad y fuerza de reversión
  - BOS: hasta 25 pts — ponderados por cantidad, fuerza de quiebre y recencia
  - Alineación Macro: hasta 15 pts — puntos completos cuando el sesgo de price action coincide con el sesgo macro de Claude para ese ticker
  - Confirmación de Volumen: hasta 5 pts — bonus cuando el volumen reciente es >1.5x el promedio de 30 días
- Determinar sesgo general por instrumento: bullish, bearish o neutral (basado en qué lado tiene más puntos)
- Ordenar todos los instrumentos por score descendente

### Paso 4: Resultados mostrados en el dashboard
- **Banner de Régimen Macro**: Muestra régimen (RISK-ON/OFF/NEUTRAL/ROTATION), % de confianza, resumen, y clusters temáticos expandibles con sus tickers
- **Barra de filtros**: Filtrar por tipo (Stock/ETF/Apalancado) y sesgo (Bullish/Bearish/Neutral). Ordenar por score, volatilidad, tema o nombre.
- **Lista de instrumentos**: Cada fila muestra ticker, badge de tipo, precio + cambio, mini chart SVG de velas con zonas FVG resaltadas, top 3 señales como badges, badge de sesgo e indicador circular de score
- **Panel de detalle** (click en cualquier ticker): Chart más grande con barras de volumen, breakdown completo de señales con puntos por señal y texto de detalle, lista de FVGs abiertos con rangos de precio y tamaño relativo al ATR, y justificación de Claude de por qué este ticker es relevante para el contexto macro actual

### Paso 5: El usuario puede re-escanear
- Modificar el prompt de foco y hacer click en "Scan Market" de nuevo
- Cada scan es independiente — no se guarda estado entre scans

---

## Estructura del Proyecto

```
fvg-screener/
├── app/
│   ├── page.tsx              ← Dashboard principal (componente cliente, toda la UI)
│   ├── layout.tsx            ← Layout raíz con metadata
│   ├── globals.css           ← Directivas Tailwind + animaciones custom
│   └── api/
│       └── scan/
│           └── route.ts      ← Pipeline completo de scan (endpoint POST)
├── lib/
│   ├── types.ts              ← Todas las interfaces TypeScript
│   ├── detection.ts          ← Algoritmos de FVG, swing points, liquidity sweeps, BOS
│   ├── scoring.ts            ← Motor de scoring de confluencia con pesos configurables
│   ├── macro.ts              ← Fetch de Marketaux + fallback RSS + prompt de análisis de Claude
│   └── prices.ts             ← Wrapper de yahoo-finance2 con batching
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── .env.local.example
├── .gitignore
└── README.md
```

---

## Decisiones de Diseño Clave

1. **Una sola API route**: Todo el pipeline corre en un solo POST a `/api/scan`. Esto mantiene el frontend simple (un solo fetch) pero requiere Vercel Pro por el timeout de 60s. Si necesitamos soportar plan Hobby (10s), dividir en 3 llamadas secuenciales: `/api/scan/news` → `/api/scan/analyze` → `/api/scan/score`.

2. **Sin base de datos**: Los scans son efímeros. No hay persistencia entre sesiones. Esto mantiene la arquitectura simple y sin costo. Si agregamos historial de scans después, usar Vercel KV o Upstash Redis.

3. **Charts en SVG**: Los mini charts de velas se renderizan como SVGs inline, sin usar librería de charting. Esto evita dependencias pesadas y da control total sobre el renderizado de zonas FVG. Para un upgrade futuro, `lightweight-charts` (la librería open-source de TradingView) ya está en package.json.

4. **Claude como motor de descubrimiento de tickers**: La innovación crítica es que Claude no solo clasifica lo macro — DESCUBRE qué escanear. El usuario nunca necesita mantener un watchlist. Claude lee las noticias de hoy y determina qué acciones, ETFs y ETFs apalancados son relevantes ahora mismo.

5. **yahoo-finance2 sobre Twelve Data**: No requiere API key, cubre todos los tickers listados en USA, y corre en funciones serverless de Node.js. Desventaja: a veces inestable, sin websockets. Suficientemente bueno para timeframe diario con scans on-demand.

---

## Detalle del Sistema de Scoring

```
SCORE TOTAL = FVG (máx 30) + SWEEPS (máx 25) + BOS (máx 25) + MACRO (máx 15) + VOLUMEN (máx 5)

Scoring de FVG:
  - Por FVG sin llenar: 8 pts base + (tamaño relativo al ATR × 4)
  - Bonus recencia: +5 si el FVG se formó en las últimas 5 velas
  - Tope: 30 pts

Scoring de Liquidity Sweeps:
  - Por sweep: 12 pts base + (fuerza de reversión × 8)
  - Sweeps de equal highs/lows reciben multiplicador 1.5x en fuerza de reversión
  - Tope: 25 pts

Scoring de BOS:
  - Por BOS: 10 pts base + (fuerza de quiebre × 10)
  - Bonus recencia: +5 si el BOS fue en las últimas 5 velas
  - Tope: 25 pts

Alineación Macro:
  - Alineación completa (sesgo PA = sesgo macro): 12 pts
  - Parcial (macro favorable, PA neutral): 5 pts
  - Tope: 15 pts

Volumen:
  - Volumen reciente > 1.5x promedio 30 días: 5 pts
```

---

## Variables de Entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `ANTHROPIC_API_KEY` | Sí | De console.anthropic.com — usada para análisis macro con Claude |
| `MARKETAUX_API_KEY` | Sí | De marketaux.com — usada para titulares de noticias financieras |

Configurar SOLO en el dashboard de Vercel (Settings → Environment Variables). Nunca commitear al código.

---

## Problemas Comunes y Soluciones

- **Timeout del scan en Vercel Hobby**: Upgrade a Pro ($20/mes) o dividir la API en 3 llamadas secuenciales más cortas
- **Errores de yahoo-finance2**: Algunos tickers pueden fallar (deslistados, renombrados). El código los saltea gracefully.
- **Rate limit de Marketaux**: El tier gratuito es 100 req/día. El fallback a RSS se activa automáticamente si Marketaux falla.
- **Claude retorna JSON inválido**: El parser en macro.ts elimina code fences de markdown y reintenta. Si sigue fallando, verificar que el system prompt pida claramente output solo en JSON.
- **Resultados de scan vacíos**: Usualmente significa que todos los tickers que Claude recomendó fallaron en el lookup de yahoo-finance2. Revisar la respuesta de Claude en los logs de funciones de Vercel.
