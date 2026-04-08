/**
 * Tests for POST /api/parlay routes (spec §2, §4)
 *
 * Key behaviors:
 * - /watch subscribes asset IDs to the price feed
 * - /orders validates batch (max 15, spec §2)
 * - /orders forwards to CLOB with HMAC auth headers (spec §2, §4)
 * - /orders returns mock success when no API key configured
 */

import express from "express";
import request from "supertest";
import { createParlayRouter } from "../../routes/parlay";

jest.mock("../../hmac", () => ({
  buildAuthHeaders: jest.fn().mockReturnValue({ "Content-Type": "application/json" }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const ORIG_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIG_ENV };
  mockFetch.mockReset();
});

function makeMockWatchdog() {
  return { subscribe: jest.fn() };
}

function makeApp(watchdog = makeMockWatchdog()) {
  const app = express();
  app.use(express.json());
  app.use("/api/parlay", createParlayRouter(watchdog as any));
  return app;
}

const VALID_ORDER = {
  market: "asset-1",
  side: "BUY",
  size: 8.33,
  price: 0.626,
  orderType: "FOK",
  funder: "0xProxyWallet",
  signature: "0xsig",
  nonce: 1700000000000,
  expiration: 1700000060,
};

// ─── POST /watch ─────────────────────────────────────────────────────────────

describe("POST /api/parlay/watch", () => {
  it("returns 400 when assetIds is missing", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/parlay/watch").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when assetIds is not an array", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/parlay/watch").send({ assetIds: "not-array" });
    expect(res.status).toBe(400);
  });

  it("subscribes asset IDs and returns ok:true", async () => {
    const watchdog = makeMockWatchdog();
    const app = makeApp(watchdog);
    const res = await request(app)
      .post("/api/parlay/watch")
      .send({ assetIds: ["asset-1", "asset-2"] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(watchdog.subscribe).toHaveBeenCalledWith(["asset-1", "asset-2"]);
  });

  it("returns subscribed count", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/parlay/watch")
      .send({ assetIds: ["a1", "a2", "a3"] });
    expect(res.body.subscribed).toBe(3);
  });
});

// ─── POST /orders ─────────────────────────────────────────────────────────────

describe("POST /api/parlay/orders — validation (spec §2)", () => {
  it("returns 400 when orders array is missing", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/parlay/orders").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when orders is empty", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/parlay/orders").send({ orders: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 15 orders (spec §2 — batch limit)", async () => {
    const app = makeApp();
    const orders = Array(16).fill(VALID_ORDER);
    const res = await request(app).post("/api/parlay/orders").send({ orders });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/15/);
  });

  it("accepts exactly 15 orders (spec §2 — batch limit)", async () => {
    // No API key → mock success path
    delete process.env.POLY_API_KEY;
    const app = makeApp();
    const orders = Array(15).fill(VALID_ORDER);
    const res = await request(app).post("/api/parlay/orders").send({ orders });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/parlay/orders — no API key (mock mode)", () => {
  beforeEach(() => {
    delete process.env.POLY_API_KEY;
  });

  it("returns mock success with orderIds when no API key configured", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/parlay/orders")
      .send({ orders: [VALID_ORDER, { ...VALID_ORDER, market: "asset-2" }] });
    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.orderIds).toHaveLength(2);
  });

  it("does not call Polymarket CLOB when no API key", async () => {
    const app = makeApp();
    await request(app).post("/api/parlay/orders").send({ orders: [VALID_ORDER] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/parlay/orders — CLOB forwarding (spec §2, §4)", () => {
  beforeEach(() => {
    process.env.POLY_API_KEY = "test-key";
  });

  it("forwards orders to Polymarket CLOB with HMAC headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, orderIds: ["order-1"] }),
    });
    const app = makeApp();
    const res = await request(app)
      .post("/api/parlay/orders")
      .send({ orders: [VALID_ORDER] });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/orders"),
      expect.objectContaining({ method: "POST" })
    );
    expect(res.status).toBe(200);
  });

  it("returns 502 when CLOB is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const app = makeApp();
    const res = await request(app)
      .post("/api/parlay/orders")
      .send({ orders: [VALID_ORDER] });
    expect(res.status).toBe(502);
  });

  it("proxies CLOB error status back to client", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid signature" }),
    });
    const app = makeApp();
    const res = await request(app)
      .post("/api/parlay/orders")
      .send({ orders: [VALID_ORDER] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
