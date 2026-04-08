import WebSocket from "ws";
import { EventEmitter } from "events";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PriceData {
  bestAsk: number;
  bestBid: number;
  updatedAt: number; // Date.now()
}

interface WatchdogConfig {
  url: string;
  pingIntervalMs: number;   // Default: 10_000
  stalenessLimitMs: number; // Default: 30_000
  maxReconnectDelay: number; // Default: 30_000
  onStale?: (assetId: string, ageMs: number) => void;
  onReconnect?: (attempt: number) => void;
}

// ─── WebSocket Watchdog ────────────────────────────────────────────────────

export class PriceFeedWatchdog extends EventEmitter {
  private ws: WebSocket | null = null;
  private priceCache: Map<string, PriceData> = new Map();
  private subscribedAssets: Set<string> = new Set();
  private pingTimer: NodeJS.Timeout | null = null;
  private stalenessTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isDestroyed = false;

  constructor(private readonly config: WatchdogConfig) {
    super();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  subscribe(assetIds: string[]): void {
    assetIds.forEach((id) => this.subscribedAssets.add(id));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(assetIds);
    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }
  }

  unsubscribe(assetIds: string[]): void {
    assetIds.forEach((id) => this.subscribedAssets.delete(id));
  }

  getPrice(assetId: string): PriceData | undefined {
    return this.priceCache.get(assetId);
  }

  getAllPrices(): Map<string, PriceData> {
    return this.priceCache;
  }

  isStale(assetId: string): boolean {
    const entry = this.priceCache.get(assetId);
    if (!entry) return true;
    return Date.now() - entry.updatedAt > this.config.stalenessLimitMs;
  }

  getSubscribedAssets(): string[] {
    return [...this.subscribedAssets];
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearTimers();
    this.ws?.close();
  }

  // ── Connection Lifecycle ──────────────────────────────────────────────────

  connect(): void {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.config.url);
    } catch (err) {
      console.warn("[Watchdog] Failed to create WebSocket connection:", err);
      this.scheduleReconnect();
      return;
    }

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
    console.log(
      `[Watchdog] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`
    );
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
      const assetId = event["asset_id"] as string;
      const bestAsk = Number(event["best_ask"]);
      const bestBid = Number(event["best_bid"]);

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
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.stalenessTimer) clearInterval(this.stalenessTimer);
    this.pingTimer = null;
    this.stalenessTimer = null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private sendSubscription(assetIds: string[]): void {
    if (!assetIds.length || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws!.send(
      JSON.stringify({
        type: "subscribe",
        channel: "market",
        markets: assetIds,
        custom_feature_enabled: true,
      })
    );
  }
}
