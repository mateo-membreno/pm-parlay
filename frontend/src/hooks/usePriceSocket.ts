import { useEffect, useRef, useCallback } from "react";
import { create } from "zustand";
import { PriceData } from "../types";

// ─── Global price store (zustand) ─────────────────────────────────────────

interface PriceSocketStore {
  prices: Map<string, PriceData>;
  isConnected: boolean;
  isStale: boolean;
  setPrice: (assetId: string, data: PriceData) => void;
  setStale: (assetId: string) => void;
  setConnected: (v: boolean) => void;
  setGlobalStale: (v: boolean) => void;
}

export const usePriceSocketStore = create<PriceSocketStore>((set) => ({
  prices: new Map(),
  isConnected: false,
  isStale: false,
  setPrice: (assetId, data) =>
    set((state) => {
      const next = new Map(state.prices);
      next.set(assetId, data);
      return { prices: next, isStale: false };
    }),
  setStale: (assetId) =>
    set((state) => {
      const existing = state.prices.get(assetId);
      if (!existing) return state;
      const next = new Map(state.prices);
      // Mark as stale by setting updatedAt far in the past
      next.set(assetId, { ...existing, updatedAt: 0 });
      return { prices: next, isStale: true };
    }),
  setConnected: (v) => set({ isConnected: v }),
  setGlobalStale: (v) => set({ isStale: v }),
}));

// ─── Hook ─────────────────────────────────────────────────────────────────

const RECONNECT_DELAY_BASE = 1_000;
const RECONNECT_DELAY_MAX = 30_000;

let wsInstance: WebSocket | null = null;
let pendingSubscriptions: Set<string> = new Set();
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function connectWs(
  onPrice: (assetId: string, data: PriceData) => void,
  onStale: (assetId: string) => void,
  onConnected: (v: boolean) => void
): void {
  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) return;

  const url = getWsUrl();
  const ws = new WebSocket(url);
  wsInstance = ws;

  ws.onopen = () => {
    reconnectAttempt = 0;
    onConnected(true);
    console.log("[priceSocket] Connected");

    // Send pending subscriptions
    if (pendingSubscriptions.size > 0) {
      ws.send(
        JSON.stringify({ type: "subscribe", assetIds: [...pendingSubscriptions] })
      );
    }
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        assetId?: string;
        bestAsk?: number;
        bestBid?: number;
        updatedAt?: number;
        ageMs?: number;
      };

      if (msg.type === "price" && msg.assetId != null && msg.bestAsk != null && msg.bestBid != null) {
        onPrice(msg.assetId, {
          bestAsk: msg.bestAsk,
          bestBid: msg.bestBid,
          updatedAt: msg.updatedAt ?? Date.now(),
        });
      } else if (msg.type === "stale" && msg.assetId != null) {
        onStale(msg.assetId);
      }
    } catch (err) {
      console.warn("[priceSocket] Failed to parse message:", err);
    }
  };

  ws.onclose = () => {
    onConnected(false);
    console.warn("[priceSocket] Disconnected");

    const delay = Math.min(
      RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempt) + Math.random() * 500,
      RECONNECT_DELAY_MAX
    );
    reconnectAttempt++;

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connectWs(onPrice, onStale, onConnected);
    }, delay);
  };

  ws.onerror = (err) => {
    console.error("[priceSocket] Error:", err);
  };
}

// ─── Public hook ──────────────────────────────────────────────────────────

export function usePriceSocket() {
  const { prices, isConnected, isStale, setPrice, setStale, setConnected } =
    usePriceSocketStore();

  const isPrimed = useRef(false);

  useEffect(() => {
    if (isPrimed.current) return;
    isPrimed.current = true;

    connectWs(setPrice, setStale, setConnected);
  }, [setPrice, setStale, setConnected]);

  const subscribe = useCallback(
    (assetIds: string[]) => {
      assetIds.forEach((id) => pendingSubscriptions.add(id));

      if (wsInstance?.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify({ type: "subscribe", assetIds }));
      }
    },
    []
  );

  return { prices, isConnected, isStale, subscribe };
}
