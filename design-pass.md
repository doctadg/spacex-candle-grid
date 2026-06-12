# SPCX Launch Grid — Premium Design Pass

## Diagnosis

The first prototype proved the mechanic, but the visual language was too decorative: too many glows, gradients, stars, rounded panels, fake sci-fi effects, and marketing copy competing with the core game. The product needs to feel like a premium trading app with a game layer, not a generated cyber poster.

## Direction

Use a dark-native fintech/product UI vocabulary:

- Linear discipline: near-black canvas, luminance-based surfaces, thin borders, restrained accent use.
- Revolut confidence: large clear numbers, low-friction touch targets, direct language.
- Kraken/trading density: clear price rails, status chips, readable data, no decorative dashboards.
- SpaceX restraint: aerospace-adjacent uppercase labels, mostly black/white, spectacle through composition rather than neon.

## UX model

The player should understand the loop in under 5 seconds:

1. Watch the next-candle arena.
2. Pick a row/price band and lane/multiplier.
3. Lock before cutoff.
4. Settlement line lands in a band.
5. Score/streak/leaderboard update immediately.

Primary hierarchy:

1. Countdown and lock state.
2. The chart + prediction grid.
3. Selected ticket and payout.
4. Leaderboard/feed/history.

## Visual rules

- One primary accent: `#7c5cff` violet/cobalt.
- Positive/negative remain green/red, but only for market state.
- No rainbow gradients, no star fields, no glassmorphism sludge.
- Surfaces use black plus subtle white opacity: `#07080a`, `#0d0f13`, `rgba(255,255,255,.04)`.
- Border radius restrained: 10–18px, not bubble UI.
- Typography: Inter for product UI, JetBrains Mono for market labels.
- Motion should clarify state changes: lock, settle, next round. No decorative looping theater.

## Production shell

Desktop app shell:

- Thin top command bar.
- Left rail with rooms/rounds.
- Central chart module as the hero.
- Right ticket with selected cell, probability, multiplier, stake, lock button.
- Bottom strip for round tape + leaderboard.

Mobile:

- Collapse side rails.
- Chart first.
- Ticket becomes sticky/bottom-oriented block.
- Big touch cells and full-width lock button.

## Live market feed

The product now uses Hyperliquid's HIP-3 SPCX market as the live source of truth:

- Contract: `xyz:SPCX`
- REST initial load: `https://api.hyperliquid.xyz/info`
  - `candleSnapshot` for 1m OHLC candles
  - `metaAndAssetCtxs` with `dex: "xyz"` for mark/oracle/OI/24h volume
  - `allMids` with `dex: "xyz"` for current mid
- WebSocket: `wss://api.hyperliquid.xyz/ws`
  - `trades` for live tape/last price
  - `l2Book` for best bid/ask/spread
  - `candle` for 1m candle boundaries
  - `activeAssetCtx` for mark/oracle/OI/volume

Important implementation detail: base Hyperliquid `meta` only shows native perps and `SPX`; HIP-3 markets require passing `dex: "xyz"` or using fully-qualified coin `xyz:SPCX`. The app must not query plain `SPCX`.
