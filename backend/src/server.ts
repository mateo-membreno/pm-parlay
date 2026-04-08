import express from "express";
import cors from "cors";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

import { PriceFeedWatchdog } from "./watchdog";
import { warmAssetCache } from "./assetCache";
import { buildAuthHeaders } from "./hmac";
import { createMarketsRouter } from "./routes/markets";
import { createPriceRouter } from "./routes/price";
import { createParlayRouter } from "./routes/parlay";
import { createWalletRouter } from "./routes/wallet";

dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const CLOB_WS_URL =
  process.env.CLOB_WS_URL ?? "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const STALE_THRESHOLD = parseInt(process.env.STALE_PRICE_THRESHOLD_MS ?? "30000", 10);
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "10000", 10);
const CLOB_API_URL = process.env.CLOB_API_URL ?? "https://clob-api.polymarket.com";

// ─── Price Feed Watchdog ───────────────────────────────────────────────────

const watchdog = new PriceFeedWatchdog({
  url: CLOB_WS_URL,
  pingIntervalMs: HEARTBEAT_INTERVAL,
  stalenessLimitMs: STALE_THRESHOLD,
  maxReconnectDelay: 30_000,
  onStale: (assetId, ageMs) => {
    console.warn(`[server] Stale price: ${assetId} is ${ageMs}ms old`);
  },
  onReconnect: (attempt) => {
    console.log(`[server] Watchdog reconnected (attempt ${attempt})`);
  },
});

// ─── Express App ───────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    subscribedAssets: watchdog.getSubscribedAssets().length,
    uptime: process.uptime(),
  });
});

// Mount routes
app.use("/api/markets", createMarketsRouter(watchdog));
app.use("/api/price", createPriceRouter(watchdog));
app.use("/api/parlay", createParlayRouter(watchdog));
app.use("/api/proxy-wallet", createWalletRouter());

// ─── HTTP + WS Server ──────────────────────────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });

// Track per-client subscriptions
const clientSubscriptions = new Map<WebSocket, Set<string>>();

wss.on("connection", (ws: WebSocket) => {
  console.log("[wss] Client connected");
  clientSubscriptions.set(ws, new Set());

  ws.on("message", (rawData: Buffer) => {
    try {
      const msg = JSON.parse(rawData.toString()) as { type: string; assetIds?: string[] };

      if (msg.type === "subscribe" && Array.isArray(msg.assetIds)) {
        const clientSubs = clientSubscriptions.get(ws)!;
        msg.assetIds.forEach((id) => clientSubs.add(id));

        // Subscribe to watchdog as well
        watchdog.subscribe(msg.assetIds);

        // Send current prices immediately if available
        for (const id of msg.assetIds) {
          const price = watchdog.getPrice(id);
          if (price && !watchdog.isStale(id)) {
            const payload = JSON.stringify({
              type: "price",
              assetId: id,
              bestAsk: price.bestAsk,
              bestBid: price.bestBid,
              updatedAt: price.updatedAt,
            });
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(payload);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[wss] Failed to parse client message:", err);
    }
  });

  ws.on("close", () => {
    clientSubscriptions.delete(ws);
    console.log("[wss] Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("[wss] Client error:", err.message);
    clientSubscriptions.delete(ws);
  });
});

// Fan out price events to subscribed clients
watchdog.on("price", (data: { assetId: string; bestAsk: number; bestBid: number }) => {
  const payload = JSON.stringify({
    type: "price",
    assetId: data.assetId,
    bestAsk: data.bestAsk,
    bestBid: data.bestBid,
    updatedAt: Date.now(),
  });

  for (const [client, subs] of clientSubscriptions) {
    if (subs.has(data.assetId) && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

// Fan out stale events
watchdog.on("stale", (data: { assetId: string; ageMs: number }) => {
  const payload = JSON.stringify({
    type: "stale",
    assetId: data.assetId,
    ageMs: data.ageMs,
  });

  for (const [client, subs] of clientSubscriptions) {
    if (subs.has(data.assetId) && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

// ─── Polymarket Heartbeat ──────────────────────────────────────────────────

async function sendHeartbeat(): Promise<void> {
  if (!process.env.POLY_API_KEY) return; // Skip if no credentials

  try {
    const headers = buildAuthHeaders("POST", "/heartbeat", "");
    const response = await fetch(`${CLOB_API_URL}/heartbeat`, {
      method: "POST",
      headers,
    });
    if (!response.ok) {
      console.warn(`[heartbeat] Failed: ${response.status}`);
    }
  } catch (err) {
    console.warn("[heartbeat] Network error:", err instanceof Error ? err.message : err);
  }
}

setInterval(sendHeartbeat, 15_000);

// ─── Startup ───────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  console.log("[server] Initializing asset cache...");
  await warmAssetCache();

  // Start listening
  server.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket available at ws://localhost:${PORT}/ws`);
  });
}

start().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
