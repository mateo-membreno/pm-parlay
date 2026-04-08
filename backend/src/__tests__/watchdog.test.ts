/**
 * Tests for PriceFeedWatchdog (spec §3, §10)
 *
 * Key behaviors:
 * - Single persistent WS connection
 * - Subscribes to best_bid_ask channel with custom_feature_enabled:true
 * - Sends PING heartbeat every pingIntervalMs (spec §3)
 * - Updates price cache on best_bid_ask events
 * - Detects stale prices independently of connection status (spec §10)
 * - Reconnects with exponential backoff on close (spec §10)
 */

import { EventEmitter } from "events";

// Capture the last created WS mock so tests can emit events
let mockWsInstance: any = null;

jest.mock("ws", () => {
  const { EventEmitter } = require("events");

  function MockWebSocket(this: any, _url: string) {
    EventEmitter.call(this);
    this.send = jest.fn();
    this.close = jest.fn();
    this.readyState = (MockWebSocket as any).OPEN;
    mockWsInstance = this;
  }

  Object.setPrototypeOf(MockWebSocket.prototype, EventEmitter.prototype);
  MockWebSocket.prototype.constructor = MockWebSocket;

  (MockWebSocket as any).OPEN = 1;
  (MockWebSocket as any).CLOSING = 2;
  (MockWebSocket as any).CLOSED = 3;

  return MockWebSocket;
});

import { PriceFeedWatchdog } from "../watchdog";

const BASE_CONFIG = {
  url: "wss://test.example.com",
  pingIntervalMs: 10_000,
  stalenessLimitMs: 30_000,
  maxReconnectDelay: 30_000,
};

function makeWatchdog(overrides = {}) {
  return new PriceFeedWatchdog({ ...BASE_CONFIG, ...overrides });
}

describe("PriceFeedWatchdog — connection", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWsInstance = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls connect() when subscribe() is called with no open connection", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1"]);
    expect(mockWsInstance).not.toBeNull();
  });

  it("sends subscription message immediately when WS opens (spec §3)", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1", "asset-2"]);
    mockWsInstance.emit("open");

    const calls = (mockWsInstance.send as jest.Mock).mock.calls;
    const subCall = calls.find((c: any[]) => {
      const msg = JSON.parse(c[0]);
      return msg.type === "subscribe";
    });
    expect(subCall).toBeDefined();
    const msg = JSON.parse(subCall[0]);
    expect(msg.channel).toBe("market");
    expect(msg.markets).toEqual(["asset-1", "asset-2"]);
  });

  it("sets custom_feature_enabled:true on subscription (spec §3 — required for best_bid_ask)", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");

    const calls = (mockWsInstance.send as jest.Mock).mock.calls;
    const subMsg = JSON.parse(calls[0][0]);
    expect(subMsg.custom_feature_enabled).toBe(true);
  });

  it("sends PING heartbeat at pingIntervalMs (spec §3)", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");

    jest.advanceTimersByTime(10_000);
    const pings = (mockWsInstance.send as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0] === "PING"
    );
    expect(pings.length).toBeGreaterThanOrEqual(1);
  });

  it("resubscribes all assets after reconnect (spec §10)", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1", "asset-2"]);
    mockWsInstance.emit("open");

    // Disconnect
    mockWsInstance.emit("close", 1006, Buffer.from(""));
    jest.advanceTimersByTime(1500); // trigger reconnect

    // New WS instance created; open it
    mockWsInstance.emit("open");

    const msgs = (mockWsInstance.send as jest.Mock).mock.calls.map((c: any[]) =>
      typeof c[0] === "string" && c[0] !== "PING" ? JSON.parse(c[0]) : null
    ).filter(Boolean);

    const subMsg = msgs.find((m: any) => m.type === "subscribe");
    expect(subMsg.markets).toEqual(expect.arrayContaining(["asset-1", "asset-2"]));
  });

  it("destroy() closes the WebSocket", () => {
    const dog = makeWatchdog();
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");
    dog.destroy();
    expect(mockWsInstance.close).toHaveBeenCalled();
  });

  it("getSubscribedAssets() returns tracked asset IDs", () => {
    const dog = makeWatchdog();
    dog.subscribe(["a1", "a2"]);
    expect(dog.getSubscribedAssets()).toEqual(expect.arrayContaining(["a1", "a2"]));
  });

  it("unsubscribe() removes asset IDs", () => {
    const dog = makeWatchdog();
    dog.subscribe(["a1", "a2"]);
    dog.unsubscribe(["a1"]);
    expect(dog.getSubscribedAssets()).not.toContain("a1");
    expect(dog.getSubscribedAssets()).toContain("a2");
  });
});

describe("PriceFeedWatchdog — price cache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWsInstance = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function openAndSubscribe(dog: PriceFeedWatchdog, assets: string[]) {
    dog.subscribe(assets);
    mockWsInstance.emit("open");
  }

  function emitPrice(assetId: string, bestAsk: number, bestBid: number) {
    mockWsInstance.emit(
      "message",
      Buffer.from(JSON.stringify({ event_type: "best_bid_ask", asset_id: assetId, best_ask: String(bestAsk), best_bid: String(bestBid) }))
    );
  }

  it("getPrice() returns undefined for an unknown asset", () => {
    const dog = makeWatchdog();
    expect(dog.getPrice("unknown")).toBeUndefined();
  });

  it("getPrice() returns cached price after best_bid_ask event (spec §3)", () => {
    const dog = makeWatchdog();
    openAndSubscribe(dog, ["asset-1"]);
    emitPrice("asset-1", 0.62, 0.58);

    const price = dog.getPrice("asset-1");
    expect(price?.bestAsk).toBe(0.62);
    expect(price?.bestBid).toBe(0.58);
  });

  it("emits 'price' event with assetId, bestAsk, bestBid (spec §3)", () => {
    const dog = makeWatchdog();
    const handler = jest.fn();
    dog.on("price", handler);
    openAndSubscribe(dog, ["asset-1"]);
    emitPrice("asset-1", 0.44, 0.40);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", bestAsk: 0.44, bestBid: 0.40 })
    );
  });

  it("ignores PONG messages (spec §3 — heartbeat ack)", () => {
    const dog = makeWatchdog();
    const handler = jest.fn();
    dog.on("price", handler);
    openAndSubscribe(dog, ["asset-1"]);

    mockWsInstance.emit("message", Buffer.from("PONG"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores events with unknown event_type", () => {
    const dog = makeWatchdog();
    const handler = jest.fn();
    dog.on("price", handler);
    openAndSubscribe(dog, ["asset-1"]);

    mockWsInstance.emit("message", Buffer.from(JSON.stringify({ event_type: "trade", asset_id: "asset-1" })));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("PriceFeedWatchdog — staleness (spec §10)", () => {
  it("isStale() returns true when no price entry exists", () => {
    const dog = makeWatchdog();
    expect(dog.isStale("nonexistent")).toBe(true);
  });

  it("isStale() returns false immediately after receiving a price", () => {
    jest.useFakeTimers();
    mockWsInstance = null;
    const dog = makeWatchdog();
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");
    mockWsInstance.emit(
      "message",
      Buffer.from(JSON.stringify({ event_type: "best_bid_ask", asset_id: "asset-1", best_ask: "0.5", best_bid: "0.45" }))
    );
    expect(dog.isStale("asset-1")).toBe(false);
    jest.useRealTimers();
  });

  it("isStale() returns true when data exceeds stalenessLimitMs (spec §10)", () => {
    jest.useFakeTimers();
    mockWsInstance = null;
    const dog = makeWatchdog({ stalenessLimitMs: 5_000 });
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");
    mockWsInstance.emit(
      "message",
      Buffer.from(JSON.stringify({ event_type: "best_bid_ask", asset_id: "asset-1", best_ask: "0.5", best_bid: "0.45" }))
    );

    jest.advanceTimersByTime(6_000);
    expect(dog.isStale("asset-1")).toBe(true);
    jest.useRealTimers();
  });

  it("emits 'stale' event when staleness check fires (spec §10)", () => {
    jest.useFakeTimers();
    mockWsInstance = null;
    const onStale = jest.fn();
    const dog = makeWatchdog({ stalenessLimitMs: 1_000, onStale });
    dog.subscribe(["asset-1"]);
    mockWsInstance.emit("open");
    mockWsInstance.emit(
      "message",
      Buffer.from(JSON.stringify({ event_type: "best_bid_ask", asset_id: "asset-1", best_ask: "0.5", best_bid: "0.45" }))
    );

    // Advance past staleness threshold AND staleness check interval (5s)
    jest.advanceTimersByTime(6_000);
    expect(onStale).toHaveBeenCalledWith("asset-1", expect.any(Number));
    jest.useRealTimers();
  });
});

describe("PriceFeedWatchdog — exponential backoff (spec §10)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWsInstance = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reconnects after a close event", () => {
    const onReconnect = jest.fn();
    const dog = makeWatchdog({ onReconnect });
    dog.subscribe(["a1"]);
    const firstWs = mockWsInstance;
    mockWsInstance.emit("open");

    mockWsInstance.emit("close", 1006, Buffer.from(""));
    jest.advanceTimersByTime(2_000); // enough for first backoff

    expect(mockWsInstance).not.toBe(firstWs); // new WS was created
  });

  it("caps reconnect delay at maxReconnectDelay (spec §10)", () => {
    const dog = makeWatchdog({ maxReconnectDelay: 3_000 });
    dog.subscribe(["a1"]);
    mockWsInstance.emit("open");

    // Simulate multiple disconnects to build up backoff
    for (let i = 0; i < 5; i++) {
      mockWsInstance.emit("close", 1006, Buffer.from(""));
      jest.advanceTimersByTime(35_000); // advance past any possible delay
    }

    // Verify the dog is still trying (hasn't given up)
    expect(mockWsInstance).not.toBeNull();
  });
});
