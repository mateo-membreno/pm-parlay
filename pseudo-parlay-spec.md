# Pseudo-Parlay Specification
### A High-Performance, Non-Custodial Parlay Interface on Polymarket's CLOB

> **Target Stack:** Node.js (TypeScript) backend · React frontend · Polymarket CLOB API v2  
> **Author:** Internal Engineering Spec  
> **Status:** Draft v1.2

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Order Execution & Batching](#2-order-execution--batching)
3. [Real-Time Pricing via WebSocket](#3-real-time-pricing-via-websocket)
4. [Authentication Flow (Dual-Key)](#4-authentication-flow-dual-key)
5. [Live Parlay Valuation](#5-live-parlay-valuation)
6. [Latency Optimization](#6-latency-optimization)
7. [Homescreen Design](#7-homescreen-design)
8. [Parlay Construction & Bet Slip](#8-parlay-construction--bet-slip)
9. [UI Specification (Active Parlay)](#9-ui-specification-active-parlay)
10. [WebSocket Watchdog Implementation](#10-websocket-watchdog-implementation)

---

## 1. System Architecture

### The Proxy-Relayer Model

This system is designed around a **non-custodial aggregator pattern**. Your infrastructure never holds user funds or private keys — only the user's signed authorization and your own Builder API credentials touch the order submission pipeline.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                        │
│  - Selects parlay legs                                          │
│  - Signs EIP-712 typed data via MetaMask / Rabby                │
│  - Never sends private keys                                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │  Signed order payloads (HTTPS)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR BACKEND (Builder Relayer)               │
│  - Holds Builder API Keys (Ed25519) for L2 auth                 │
│  - Signs HTTP requests with HMAC-SHA256                         │
│  - Maintains WebSocket price feed                               │
│  - Submits batch orders to CLOB                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │  POST /orders (batch)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              POLYMARKET CLOB  (clob-api.polymarket.com)         │
│              WebSocket Feed  (ws-subscriptions-clob.*)          │
└─────────────────────────────────────────────────────────────────┘
```

### The "Funder" Hierarchy

Polymarket uses a two-layer wallet system. The `funder` field in each order payload **must** be the Proxy Wallet address, not the EOA.

| Layer | Address Type | Role |
|-------|-------------|------|
| **EOA** | MetaMask / Rabby wallet | Signs EIP-712 messages; visible identity |
| **Proxy Wallet** | Gnosis Safe (created by Polymarket) | Actually holds USDC and tokens; used as `funder` |

> ⚠️ **Common Mistake:** Using the EOA as `funder` will cause order rejection. Always resolve the Proxy Wallet address for the connected EOA before constructing orders.

---

## 2. Order Execution & Batching

### The Core Goal: Simulated Atomicity

True atomic cross-market execution doesn't exist on Polymarket's CLOB. The strategy here is to **minimize the time delta between leg submissions** using the batch endpoint, so that all legs either fill near-simultaneously or are rejected before the user takes on unbalanced exposure.

### Batch Endpoint

```
POST https://clob-api.polymarket.com/orders
Content-Type: application/json
```

- Accepts **up to 15 orders** in a single HTTP call
- All legs of the parlay are submitted in one payload
- Polymarket processes them sequentially server-side, but the round-trip latency is reduced to a single network hop

### Order Type: Fill-or-Kill (FOK) vs. Fill-and-Kill (FAK)

| Type | Behavior | Use Case |
|------|----------|----------|
| **FOK** | Must fill 100% immediately or reject entirely | Strict parlays — preferred |
| **FAK** | Fills whatever is available, cancels the rest | Acceptable if partial fills are tolerable |

**Recommendation:** Default to **FOK** for parlay legs. If Leg 2 can't fill at the target price, you don't want the user sitting in Leg 1 with no hedge.

### Pricing Strategy: Best Ask + Slippage Buffer

To maximize fill probability on entry, compute the limit price as:

```
LimitPrice_i = BestAsk_i × (1 + slippage)
```

Where `slippage = 0.01` (1%) by default. Expose this as a user-configurable setting (e.g., 0.5% – 3%).

> On a CLOB priced in the range [0, 1], a 1% buffer on a $0.60 ask → limit of **$0.606**. This keeps the order competitive without massively overpaying.

### Order Payload Shape

```typescript
interface ClobOrder {
  market:      string;   // asset_id (token ID from market data)
  side:        "BUY" | "SELL";
  size:        number;   // number of shares (USDC / price)
  price:       number;   // limit price, 2 decimal precision
  orderType:   "FOK" | "FAK";
  funder:      string;   // Proxy Wallet address (NOT the EOA)
  signature:   string;   // EIP-712 signed by EOA
  nonce:       number;
  expiration:  number;   // Unix timestamp, e.g. now + 60s
}

// POST /orders body
interface BatchOrderPayload {
  orders: ClobOrder[];
}
```

### HMAC Request Signing (Backend)

All requests to the CLOB API must be signed with your Builder API credentials:

```typescript
import crypto from "crypto";

function signRequest(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  apiSecret: string
): string {
  const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
  return crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("base64");
}

// Attach to every outbound request
const headers = {
  "POLY-API-KEY":       process.env.POLY_API_KEY!,
  "POLY-SIGNATURE":     signRequest("POST", "/orders", bodyStr, ts, process.env.POLY_SECRET!),
  "POLY-TIMESTAMP":     String(ts),
  "POLY-PASSPHRASE":    process.env.POLY_PASSPHRASE!,
  "Content-Type":       "application/json",
};
```

---

## 3. Real-Time Pricing via WebSocket

### Connection

```
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

Maintain a **single, persistent, server-side** WebSocket. Do not open per-user connections — fan out price data from one server connection to all connected clients via your own pub-sub layer (e.g., Socket.IO rooms or SSE).

### Subscription Message

Send immediately after `open`:

```typescript
const subscribeMsg = {
  type: "subscribe",
  channel: "market",
  markets: ["<asset_id_1>", "<asset_id_2>", "<asset_id_3>"],
  custom_feature_enabled: true,   // Required to receive best_bid_ask events
};

ws.send(JSON.stringify(subscribeMsg));
```

> `custom_feature_enabled: true` **must** be set or you will not receive `best_bid_ask` events. Without it, you only get trade events.

### Event Handling

```typescript
ws.on("message", (raw: string) => {
  if (raw === "PONG") return; // Heartbeat ack

  const event = JSON.parse(raw);

  if (event.event_type === "best_bid_ask") {
    const { asset_id, best_ask, best_bid } = event;
    priceCache.set(asset_id, { bestAsk: Number(best_ask), bestBid: Number(best_bid), updatedAt: Date.now() });
    broadcastToClients(asset_id);
  }
});
```

| Field | Use |
|-------|-----|
| `best_ask` | Calculates cost to enter (`BestAsk × 1.01`) |
| `best_bid` | Calculates live cash-out value |
| `asset_id` | Key for `priceCache` lookup |

### Heartbeat

Polymarket drops the connection if no `PING` is sent every 10 seconds:

```typescript
const HEARTBEAT_INTERVAL_MS = 10_000;
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send("PING"); // Literal string — NOT JSON
  }
}, HEARTBEAT_INTERVAL_MS);
```

---

## 4. Authentication Flow (Dual-Key)

### Layer Overview

| Layer | Component | Purpose | Where It Lives |
|-------|-----------|---------|----------------|
| **L1 (User)** | EIP-712 Signature | Authorizes USDC transfer for each leg | Browser wallet |
| **L2 (You)** | Builder API Credentials | Authenticates your app to Polymarket's CLOB | Backend env vars |

### End-to-End Workflow

```
1. USER selects 3 parlay legs in the UI
         │
         ▼
2. FRONTEND requests 3 EIP-712 typed signatures from the wallet
   (one per leg — each authorizes a specific market/size/price/expiry)
         │
         ▼
3. FRONTEND sends signed order objects to YOUR backend via HTTPS
         │
         ▼
4. BACKEND constructs the batch payload, signs the HTTP request
   with HMAC-SHA256 using Builder API Keys
         │
         ▼
5. BACKEND submits POST /orders to Polymarket CLOB
         │
         ▼
6. BACKEND streams fill status back to FRONTEND via WebSocket / SSE
```

### EIP-712 Domain (Frontend)

```typescript
const domain = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: 137,             // Polygon mainnet
  verifyingContract: "0x...", // Polymarket exchange contract
};

const orderType = {
  Order: [
    { name: "maker",      type: "address" },
    { name: "taker",      type: "address" },
    { name: "tokenId",    type: "uint256" },
    { name: "makerAmount",type: "uint256" },
    { name: "takerAmount",type: "uint256" },
    { name: "side",       type: "uint8"   },
    { name: "feeRateBps", type: "uint256" },
    { name: "nonce",      type: "uint256" },
    { name: "signer",     type: "address" },
    { name: "expiration", type: "uint256" },
  ],
};

// Sign via wagmi / ethers
const signature = await walletClient.signTypedData({ domain, types: orderType, message: orderValue });
```

---

## 5. Live Parlay Valuation

### Entry Value: Potential Return

The implied payout multiplier of the parlay is the product of each leg's probability (approximated by the current ask price):

```
PotentialReturn = (1 / Price_1) × (1 / Price_2) × ... × (1 / Price_n)
```

Or equivalently, the cost to win $1:

```
ImpliedCost = Price_1 × Price_2 × ... × Price_n
```

Display as: **"$X.XX stake pays $Y.YY"**

### Live Cash-Out Value

While the parlay is active, the real-time exit value (if you sold all legs at best bid) is:

$$\text{Value}_{\text{Parlay}} = \sum_{i=1}^{n} (\text{Shares}_i \times \text{BestBid}_i)$$

```typescript
function calcCashOutValue(legs: ParlayLeg[], priceCache: Map<string, PriceData>): number {
  return legs.reduce((total, leg) => {
    const { bestBid } = priceCache.get(leg.assetId) ?? { bestBid: 0 };
    return total + leg.shares * bestBid;
  }, 0);
}
```

### Spread / Liquidity Warning

```typescript
function calcSpread(bestAsk: number, bestBid: number): number {
  return (bestAsk - bestBid) / bestAsk;
}

const LOW_LIQUIDITY_THRESHOLD = 0.10; // 10%

function hasLowLiquidity(legs: ParlayLeg[], priceCache: Map<string, PriceData>): boolean {
  return legs.some(leg => {
    const { bestAsk, bestBid } = priceCache.get(leg.assetId) ?? {};
    if (!bestAsk || !bestBid) return true;
    return calcSpread(bestAsk, bestBid) > LOW_LIQUIDITY_THRESHOLD;
  });
}
```

---

## 6. Latency Optimization

### Asset ID Caching

The CLOB resolves orders significantly faster via integer `asset_id` than market slugs. Cache this mapping at startup and refresh every 5 minutes.

```typescript
// In-memory cache: slug → asset_id
const assetIdCache = new Map<string, string>();

async function warmAssetCache() {
  const markets = await fetchAllMarkets(); // GET /markets
  for (const m of markets) {
    for (const token of m.tokens) {
      assetIdCache.set(m.market_slug + ":" + token.outcome, token.token_id);
    }
  }
}
```

### Dead-Man Switch / Heartbeat API

If you enable Polymarket's order heartbeat safety feature, you must ping the heartbeat endpoint or all open orders are auto-cancelled:

```typescript
const HEARTBEAT_URL = "https://clob-api.polymarket.com/heartbeat";
const HEARTBEAT_INTERVAL_MS = 15_000; // Stay well under their threshold

async function sendHeartbeat() {
  await fetch(HEARTBEAT_URL, {
    method: "POST",
    headers: buildAuthHeaders("POST", "/heartbeat", ""),
  });
}

setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
```

---

## 7. Homescreen Design

### Philosophy: Discovery-First

The homescreen is not a search interface — it does the work of surfacing what's worth parlaying. Markets are sorted globally by 24-hour volume, with a curated featured strip at the top driven by volume acceleration (markets gaining volume fastest, not just the largest by absolute size). Users land on a page that already has an answer to "what should I bet on today."

All market categories are shown by default — Sports, Politics, Crypto, and Finance — with no tabs or filters on initial load. This maximizes serendipitous cross-category parlay discovery, which is the core value proposition over a single-sport sportsbook.

### Layout Structure

```
┌─────────────────────────────────┐
│  TOPBAR                         │  Logo + connected wallet pill
├─────────────────────────────────┤
│  HERO / FEATURED STRIP          │  Horizontally scrollable cards
│  "What's moving today"          │  Top 5 by volume acceleration
│  [Card] [Card] [Card] [Card]    │  Each card: tap to add leg
├─────────────────────────────────┤
│  ALL MARKETS                    │  "sorted by volume" label
│  [Market row]                   │  Volume bar + category dot
│  [Market row]                   │
│  [Market row]                   │
│  ...                            │
├─────────────────────────────────┤
│  BET SLIP TRAY  (sticky bottom) │  Collapsed / peek / expanded
└─────────────────────────────────┘
```

### Featured Strip

The featured strip is server-driven. The backend selects the top 5 markets by `(volume_24h_change / volume_7d_avg)` — this surfaces accelerating markets rather than simply the largest, which tend to be stale and well-known.

Each featured card shows:
- Category tag (color-coded: Sports = purple, Politics = coral, Crypto = teal, Finance = green)
- Full market question
- Current Yes price in cents (e.g. `44¢`)
- 24h volume
- A `+ Add` button that adds the Yes outcome to the slip directly

### Market List Rows

Each row in the all-markets list shows:
- A 6px colored category dot (left edge)
- Full market question (truncated with ellipsis if overflow)
- Volume and a proportional volume bar (scaled to the highest-volume market = 100%)
- Current Yes price
- Liquidity badge: `liquid` (green) if spread ≤ 10%, `⚠ low liq` (amber) if spread > 10%

The liquidity badge appears on the market row itself — before the user adds the leg — so they can make an informed decision at the point of discovery, not after.

### Category Color System

| Category | Dot color | Tag background | Tag text |
|----------|-----------|---------------|----------|
| Sports | `#7F77DD` (purple) | `#EEEDFE` | `#534AB7` |
| Politics | `#D85A30` (coral) | `#FAECE7` | `#993C1D` |
| Crypto | `#1D9E75` (teal) | `#E1F5EE` | `#0F6E56` |
| Finance | `#639922` (green) | `#EAF3DE` | `#3B6D11` |

### Open Questions (To Resolve Before Build)

- **Search:** Is a search bar needed, or does volume sort make discovery sufficient?
- **Closing-soon indicator:** Markets expiring in <24h could show a countdown badge to create urgency.
- **Active positions banner:** If the user has a live parlay, show a persistent banner at the top or handle on a separate screen?

---

## 8. Parlay Construction & Bet Slip

### Outcome Selection: Binary Yes/No Toggle

Every market row exposes two buttons inline: **Yes** and **No**, each showing its current price in cents. This is the primary entry point for adding a leg — no modal, no navigation.

Interaction rules:
- Tapping **Yes** on an unselected market adds a Yes leg and highlights the button purple
- Tapping **No** on an unselected market adds a No leg and highlights the button coral
- Tapping the already-active button **removes** the leg entirely (toggle off)
- Tapping the opposite button **swaps** the outcome in place — the leg stays, only the outcome and price change
- Maximum 5 legs. If the user attempts to add a 6th, the button does nothing (optionally show a brief toast: "Max 5 legs")

The No price is always derived as `1 - YesPrice`, consistent with Polymarket's binary market structure.

```typescript
function getPrice(market: Market, outcome: "yes" | "no"): number {
  return outcome === "yes" ? market.bestAsk : parseFloat((1 - market.bestAsk).toFixed(2));
}
```

### Bet Slip: Mental Model

The slip uses a **single total stake** model, identical to DraftKings/FanDuel. The user thinks in dollars, not shares. Share math is handled entirely by the system.

```
Stake per leg  =  totalStake / numberOfLegs        (even split)
Shares per leg =  stakePerLeg / limitPrice_i       (sent to CLOB)
LimitPrice_i   =  BestAsk_i × (1 + slippage)
```

This means a $25 stake across 3 legs allocates ~$8.33 per leg. The "per-leg allocation" line in the slip footer makes this transparent so users understand the mechanics without needing to know what shares are.

### Slip Tray: Three States

The tray lives at the bottom of the screen and transitions between three states:

| State | Trigger | Visible height |
|-------|---------|----------------|
| **Collapsed** | No legs selected | Handle bar only (~54px) |
| **Peek** | First leg added; or user dismisses expanded | Handle + count + inline payout (~112px) |
| **Expanded** | User taps handle or tray | Full slip with legs, stake input, payout card |

A semi-transparent backdrop appears behind the expanded slip so the market list recedes but remains visible. Tapping the backdrop collapses the slip back to peek.

The tray auto-advances: it moves from collapsed → peek the moment the first leg is added. It never auto-expands to full — that requires deliberate user action — so the market list stays accessible while building.

### Slip Footer Elements

When 2 or more legs are selected, the slip footer renders:

**Stake input row**
- Label: "Total stake"
- Text input prefixed with `$`, numeric keyboard on mobile
- Quick-stake buttons: `$5` `$10` `$25` `$50` `$100`

**Payout card** (recalculates live on every price tick and every stake change)

```
Implied odds      →  {multiplier}x
Per-leg allocation →  ${stakePerLeg} / leg
────────────────────────────────
Potential payout   →  ${totalPayout}
```

Where:
```
implied     = Price_1 × Price_2 × ... × Price_n
multiplier  = 1 / implied
totalPayout = totalStake / implied
```

**Low liquidity warning banner** (amber, shown if any leg has spread > 10%):
> ⚠ One or more legs has low liquidity (>10% spread). Your cash-out value may be significantly lower than your buy-in.

**Place button**: "Sign & place parlay" — disabled if stake is 0 or no prices are loaded. Triggers the EIP-712 signing flow.

### Inline Payout in Peek State

When the slip is in peek state, the handle row shows the leg count on the left and a live payout preview on the right:

```
Bet slip · 3 legs                    → $47.82
```

This lets users see their current potential return without expanding the slip, which keeps the browsing flow uninterrupted.

### Share Calculation (Sent to CLOB)

```typescript
function buildLegOrders(
  legs: ParlayLeg[],
  totalStake: number,
  slippage: number,
  proxyWallet: string,
  signatures: string[]
): ClobOrder[] {
  const stakePerLeg = totalStake / legs.length;

  return legs.map((leg, i) => {
    const limitPrice = parseFloat((leg.price * (1 + slippage)).toFixed(4));
    const shares     = parseFloat((stakePerLeg / limitPrice).toFixed(2));

    return {
      market:     leg.assetId,
      side:       "BUY",
      size:       shares,
      price:      limitPrice,
      orderType:  "FOK",
      funder:     proxyWallet,
      signature:  signatures[i],
      nonce:      Date.now() + i,         // Unique nonce per leg
      expiration: Math.floor(Date.now() / 1000) + 60,
    };
  });
}
```

### State Machine

```
[IDLE]
  └─(leg added)──────────────────────► [BUILDING]
                                            │
                               (user taps "Sign & place")
                                            │
                                            ▼
                                       [SIGNING]
                                  wallet requests N signatures
                                            │
                              ┌─────────────┴─────────────┐
                         (rejected)                  (all signed)
                              │                           │
                              ▼                           ▼
                          [CANCELLED]               [PENDING]
                                               POST /orders submitted
                                                          │
                                         ┌────────────────┴────────────────┐
                                  (any FOK rejected)              (all legs filled)
                                         │                                  │
                                         ▼                                  ▼
                                      [FAILED]                          [ACTIVE]
                               show error modal                   live cash-out enabled
                               retry / cancel UI                          │
                                                           ┌──────────────┴──────────────┐
                                                    (user cashes out)          (legs resolve naturally)
                                                           │                             │
                                                           ▼                             ▼
                                                    [CASHING_OUT]                  [SETTLED]
                                                  batch SELL at bids
                                                           │
                                                    (sells filled)
                                                           │
                                                           ▼
                                                       [CLOSED]
```

### FOK Failure UX

If one or more legs are rejected by the CLOB (FOK couldn't fill), surface a modal immediately:

```
┌─────────────────────────────────────────┐
│  Parlay could not be placed             │
│                                         │
│  Leg 2 — "Will BTC exceed $120k?"       │
│  could not fill at the target price.    │
│  No funds were moved.                   │
│                                         │
│  [Try again]        [Edit parlay]       │
└─────────────────────────────────────────┘
```

Key principle: because all legs use FOK, a rejection means **no funds moved** for any leg. Make this explicit in the error message to prevent user panic. "Try again" re-submits the same signed orders at a refreshed price (requires new signatures if prices changed enough to invalidate the old limit). "Edit parlay" returns to the building state with legs intact.

---

## 9. UI Specification (Active Parlay)

### Active Parlay Screen

| Element | Logic |
|---------|-------|
| Live value | `Σ(Shares_i × BestBid_i)` updated every WS tick |
| P&L display | `LiveValue - EntryStake` (color-coded green/red) |
| **Cash Out** button | Submits batch `SELL` at current best bids (FOK) |
| Leg status pills | `OPEN` / `FILLED` / `CANCELLED` per leg |
| Liquidity warning | Shown inline if any leg spread deteriorates past 10% |

### Cash Out Mechanics

The cash-out is a batch `SELL` order — one order per leg — submitted to `POST /orders`. The size for each sell is the shares held in that leg. The limit price is `BestBid_i × (1 - slippage)` (selling into bids, so slippage is subtracted).

```typescript
function buildCashOutOrders(
  positions: ActiveLeg[],
  slippage: number,
  proxyWallet: string,
  signatures: string[]
): ClobOrder[] {
  return positions.map((pos, i) => ({
    market:     pos.assetId,
    side:       "SELL",
    size:       pos.sharesHeld,
    price:      parseFloat((pos.bestBid * (1 - slippage)).toFixed(4)),
    orderType:  "FOK",
    funder:     proxyWallet,
    signature:  signatures[i],
    nonce:      Date.now() + i,
    expiration: Math.floor(Date.now() / 1000) + 60,
  }));
}
```

### Staleness Handling on the Frontend

When the backend emits a `stale` event or the `/api/price` endpoint returns 503:

- Disable the **Place Parlay** and **Cash Out** buttons with tooltip: _"Price feed temporarily unavailable — please wait"_
- Show a banner: _"Live prices paused. Reconnecting..."_
- Do not use cached stale prices to construct limit orders — a 30-second-old ask could be significantly off-market

---

## 10. WebSocket Watchdog Implementation

The price feed is the most critical live dependency in the system. A stale feed silently poisons every calculation — limit prices, cash-out values, liquidity warnings. This watchdog ensures the feed is always fresh or loudly fails.

### Design Goals

- Detect stale data (no update > N seconds) independently of connection status
- Reconnect automatically with exponential backoff
- Resubscribe to all active markets after reconnect
- Expose health metrics to your monitoring stack

### Full Implementation (TypeScript)

```typescript
import WebSocket from "ws";
import { EventEmitter } from "events";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PriceData {
  bestAsk:   number;
  bestBid:   number;
  updatedAt: number; // Date.now()
}

interface WatchdogConfig {
  url:               string;
  pingIntervalMs:    number;  // Default: 10_000
  stalenessLimitMs:  number;  // Default: 30_000
  maxReconnectDelay: number;  // Default: 30_000
  onStale?:          (assetId: string, ageMs: number) => void;
  onReconnect?:      (attempt: number) => void;
}

// ─── WebSocket Watchdog ────────────────────────────────────────────────────

export class PriceFeedWatchdog extends EventEmitter {
  private ws:              WebSocket | null = null;
  private priceCache:      Map<string, PriceData> = new Map();
  private subscribedAssets: Set<string> = new Set();
  private pingTimer:       NodeJS.Timeout | null = null;
  private stalenessTimer:  NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isDestroyed = false;

  constructor(private readonly config: WatchdogConfig) {
    super();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  subscribe(assetIds: string[]): void {
    assetIds.forEach(id => this.subscribedAssets.add(id));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(assetIds);
    } else {
      this.connect();
    }
  }

  unsubscribe(assetIds: string[]): void {
    assetIds.forEach(id => this.subscribedAssets.delete(id));
    // Optionally send unsubscribe message to server here
  }

  getPrice(assetId: string): PriceData | undefined {
    return this.priceCache.get(assetId);
  }

  isStale(assetId: string): boolean {
    const entry = this.priceCache.get(assetId);
    if (!entry) return true;
    return (Date.now() - entry.updatedAt) > this.config.stalenessLimitMs;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearTimers();
    this.ws?.close();
  }

  // ── Connection Lifecycle ──────────────────────────────────────────────────

  private connect(): void {
    if (this.isDestroyed) return;

    this.ws = new WebSocket(this.config.url);

    this.ws.on("open", () => {
      console.log(`[Watchdog] Connected (attempt ${this.reconnectAttempt})`);
      this.reconnectAttempt = 0;
      this.sendSubscription([...this.subscribedAssets]);
      this.startPing();
      this.startStalenessCheck();
      this.config.onReconnect?.(this.reconnectAttempt);
      this.emit("connected");
    });

    this.ws.on("message", (raw: Buffer) => this.handleMessage(raw.toString()));

    this.ws.on("close", (code, reason) => {
      console.warn(`[Watchdog] Closed: ${code} ${reason.toString()}`);
      this.clearTimers();
      this.scheduleReconnect();
      this.emit("disconnected", { code });
    });

    this.ws.on("error", (err) => {
      console.error("[Watchdog] WebSocket error:", err.message);
      this.emit("error", err);
      // "close" event will fire after "error", which triggers reconnect
    });
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;

    const baseDelay = 1_000;
    const jitter = Math.random() * 500;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempt) + jitter,
      this.config.maxReconnectDelay
    );

    this.reconnectAttempt++;
    console.log(`[Watchdog] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => this.connect(), delay);
  }

  // ── Message Handling ──────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    if (raw === "PONG") return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      console.warn("[Watchdog] Non-JSON message:", raw);
      return;
    }

    if (event["event_type"] === "best_bid_ask") {
      const assetId  = event["asset_id"] as string;
      const bestAsk  = Number(event["best_ask"]);
      const bestBid  = Number(event["best_bid"]);

      this.priceCache.set(assetId, { bestAsk, bestBid, updatedAt: Date.now() });
      this.emit("price", { assetId, bestAsk, bestBid });
    }
  }

  // ── Timers ────────────────────────────────────────────────────────────────

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, this.config.pingIntervalMs);
  }

  private startStalenessCheck(): void {
    this.stalenessTimer = setInterval(() => {
      const now = Date.now();
      for (const [assetId, data] of this.priceCache) {
        const ageMs = now - data.updatedAt;
        if (ageMs > this.config.stalenessLimitMs) {
          console.warn(`[Watchdog] Stale price for ${assetId}: ${ageMs}ms old`);
          this.config.onStale?.(assetId, ageMs);
          this.emit("stale", { assetId, ageMs });
        }
      }
    }, 5_000); // Check every 5 seconds
  }

  private clearTimers(): void {
    if (this.pingTimer)      clearInterval(this.pingTimer);
    if (this.stalenessTimer) clearInterval(this.stalenessTimer);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private sendSubscription(assetIds: string[]): void {
    if (!assetIds.length || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws!.send(JSON.stringify({
      type: "subscribe",
      channel: "market",
      markets: assetIds,
      custom_feature_enabled: true,
    }));
  }
}
```

### Usage Example (Express Backend)

```typescript
import express from "express";
import { PriceFeedWatchdog } from "./watchdog";

const app = express();

const feed = new PriceFeedWatchdog({
  url:               "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  pingIntervalMs:    10_000,
  stalenessLimitMs:  30_000,
  maxReconnectDelay: 30_000,
  onStale: (assetId, ageMs) => {
    // Alert your monitoring (Datadog, PagerDuty, etc.)
    metrics.gauge("feed.staleness_ms", ageMs, { asset_id: assetId });
  },
  onReconnect: (attempt) => {
    metrics.increment("feed.reconnect", { attempt });
  },
});

// Subscribe when a parlay is built
app.post("/api/parlay/watch", (req, res) => {
  const { assetIds } = req.body as { assetIds: string[] };
  feed.subscribe(assetIds);
  res.json({ ok: true });
});

// Serve current prices
app.get("/api/price/:assetId", (req, res) => {
  const price = feed.getPrice(req.params.assetId);
  if (!price || feed.isStale(req.params.assetId)) {
    return res.status(503).json({ error: "Price unavailable or stale" });
  }
  res.json(price);
});
```

---

## Appendix: Environment Variables

```bash
# Polymarket Builder API
POLY_API_KEY=your_api_key
POLY_SECRET=your_hmac_secret
POLY_PASSPHRASE=your_passphrase

# Network
CLOB_API_URL=https://clob-api.polymarket.com
CLOB_WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/market

# Tuning
SLIPPAGE_DEFAULT=0.01
STALE_PRICE_THRESHOLD_MS=30000
HEARTBEAT_INTERVAL_MS=10000
```

---

## Appendix: Key API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/orders` | `POST` | Submit batch of up to 15 orders |
| `/heartbeat` | `POST` | Reset dead-man switch timer |
| `/markets` | `GET` | Fetch market list for asset ID cache warm-up |
| `/order/:id` | `GET` | Poll individual order fill status |
| `wss://.../ws/market` | WebSocket | Live best bid/ask feed |