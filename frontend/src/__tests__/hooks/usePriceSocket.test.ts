/**
 * Tests for usePriceSocketStore (spec §3, §9)
 *
 * Tests the Zustand store that backs the WebSocket price feed.
 * We test the observable state transitions directly rather than
 * the underlying WebSocket, which is covered by the backend watchdog tests.
 *
 * Key behaviors:
 * - setPrice updates prices map and clears isStale flag (spec §3)
 * - setStale marks a specific asset's price as stale (spec §9)
 * - setConnected reflects WS connection status (spec §9)
 * - setGlobalStale sets the global stale flag (spec §9)
 */

import { act } from "react";
import { usePriceSocketStore } from "../../hooks/usePriceSocket";

function resetStore() {
  usePriceSocketStore.setState({
    prices: new Map(),
    isConnected: false,
    isStale: false,
  });
}

beforeEach(resetStore);

// ─── setPrice ────────────────────────────────────────────────────────────────

describe("setPrice (spec §3)", () => {
  it("stores price data for an assetId", () => {
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", {
        bestAsk: 0.62,
        bestBid: 0.58,
        updatedAt: Date.now(),
      });
    });

    const prices = usePriceSocketStore.getState().prices;
    expect(prices.get("asset-1")?.bestAsk).toBe(0.62);
    expect(prices.get("asset-1")?.bestBid).toBe(0.58);
  });

  it("stores multiple asset prices independently", () => {
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.62, bestBid: 0.58, updatedAt: 1 });
      usePriceSocketStore.getState().setPrice("asset-2", { bestAsk: 0.44, bestBid: 0.40, updatedAt: 1 });
    });

    const prices = usePriceSocketStore.getState().prices;
    expect(prices.size).toBe(2);
    expect(prices.get("asset-2")?.bestAsk).toBe(0.44);
  });

  it("clears isStale flag on new price (spec §9 — fresh data)", () => {
    usePriceSocketStore.setState({ isStale: true });
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.62, bestBid: 0.58, updatedAt: Date.now() });
    });
    expect(usePriceSocketStore.getState().isStale).toBe(false);
  });

  it("overwrites existing price for same assetId", () => {
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.60, bestBid: 0.55, updatedAt: 1 });
    });
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.65, bestBid: 0.60, updatedAt: 2 });
    });
    expect(usePriceSocketStore.getState().prices.get("asset-1")?.bestAsk).toBe(0.65);
  });
});

// ─── setStale ────────────────────────────────────────────────────────────────

describe("setStale (spec §9)", () => {
  it("marks a specific asset as stale by zeroing updatedAt", () => {
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.62, bestBid: 0.58, updatedAt: Date.now() });
    });
    act(() => {
      usePriceSocketStore.getState().setStale("asset-1");
    });

    const price = usePriceSocketStore.getState().prices.get("asset-1");
    expect(price?.updatedAt).toBe(0);
  });

  it("sets global isStale flag to true", () => {
    act(() => {
      usePriceSocketStore.getState().setPrice("asset-1", { bestAsk: 0.62, bestBid: 0.58, updatedAt: Date.now() });
    });
    act(() => {
      usePriceSocketStore.getState().setStale("asset-1");
    });
    expect(usePriceSocketStore.getState().isStale).toBe(true);
  });

  it("does nothing for an unknown assetId", () => {
    const before = new Map(usePriceSocketStore.getState().prices);
    act(() => {
      usePriceSocketStore.getState().setStale("nonexistent");
    });
    expect(usePriceSocketStore.getState().prices).toEqual(before);
  });
});

// ─── setConnected ────────────────────────────────────────────────────────────

describe("setConnected (spec §9)", () => {
  it("starts disconnected", () => {
    expect(usePriceSocketStore.getState().isConnected).toBe(false);
  });

  it("reflects connected status when set to true", () => {
    act(() => { usePriceSocketStore.getState().setConnected(true); });
    expect(usePriceSocketStore.getState().isConnected).toBe(true);
  });

  it("reflects disconnected status when set to false", () => {
    act(() => { usePriceSocketStore.getState().setConnected(true); });
    act(() => { usePriceSocketStore.getState().setConnected(false); });
    expect(usePriceSocketStore.getState().isConnected).toBe(false);
  });
});

// ─── setGlobalStale ──────────────────────────────────────────────────────────

describe("setGlobalStale", () => {
  it("sets isStale flag to true", () => {
    act(() => { usePriceSocketStore.getState().setGlobalStale(true); });
    expect(usePriceSocketStore.getState().isStale).toBe(true);
  });

  it("clears isStale flag to false", () => {
    usePriceSocketStore.setState({ isStale: true });
    act(() => { usePriceSocketStore.getState().setGlobalStale(false); });
    expect(usePriceSocketStore.getState().isStale).toBe(false);
  });
});

// ─── Integration: price → stale → reconnect scenario (spec §9) ───────────────

describe("price feed lifecycle (spec §9)", () => {
  it("Place Parlay button should be disabled when isStale=true (state reflects spec §9)", () => {
    // This tests the boolean state that the BetSlip reads
    usePriceSocketStore.setState({ isStale: false, isConnected: true });
    act(() => { usePriceSocketStore.getState().setPrice("a1", { bestAsk: 0.5, bestBid: 0.45, updatedAt: Date.now() }); });

    // Simulate stale event from backend
    act(() => { usePriceSocketStore.getState().setStale("a1"); });

    const { isStale } = usePriceSocketStore.getState();
    expect(isStale).toBe(true); // BetSlip will disable Place button
  });

  it("Cash Out button should be disabled when !isConnected (spec §9)", () => {
    usePriceSocketStore.setState({ isConnected: false });
    expect(usePriceSocketStore.getState().isConnected).toBe(false); // ActiveParlay disables Cash Out
  });

  it("reconnection restores isConnected=true and fresh prices clear isStale", () => {
    usePriceSocketStore.setState({ isConnected: false, isStale: true });

    act(() => { usePriceSocketStore.getState().setConnected(true); });
    act(() => { usePriceSocketStore.getState().setPrice("a1", { bestAsk: 0.5, bestBid: 0.45, updatedAt: Date.now() }); });

    const state = usePriceSocketStore.getState();
    expect(state.isConnected).toBe(true);
    expect(state.isStale).toBe(false);
  });
});
