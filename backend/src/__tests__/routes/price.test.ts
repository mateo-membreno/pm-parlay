/**
 * Tests for GET /api/price routes (spec §3, §9)
 *
 * Key behaviors:
 * - Returns 503 when price is missing or stale (spec §9)
 * - Returns bestAsk, bestBid, updatedAt when fresh
 * - Batch endpoint returns map of assetId → price data
 */

import express from "express";
import request from "supertest";
import { createPriceRouter } from "../../routes/price";

function makeMockWatchdog(
  prices: Record<string, { bestAsk: number; bestBid: number; updatedAt: number }> = {},
  staleIds: string[] = [],
  subscribedAssets: string[] = []
) {
  return {
    getPrice: jest.fn((id: string) => prices[id] ?? null),
    isStale: jest.fn((id: string) => staleIds.includes(id)),
    getSubscribedAssets: jest.fn(() => subscribedAssets),
  };
}

function makeApp(watchdog: ReturnType<typeof makeMockWatchdog>) {
  const app = express();
  app.use(express.json());
  app.use("/api/price", createPriceRouter(watchdog as any));
  return app;
}

const FRESH_PRICE = { bestAsk: 0.62, bestBid: 0.58, updatedAt: Date.now() };

describe("GET /api/price/:assetId", () => {
  it("returns 503 when price is not available (spec §9)", async () => {
    const app = makeApp(makeMockWatchdog());
    const res = await request(app).get("/api/price/unknown-asset");
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  it("returns 503 when price data is stale (spec §9)", async () => {
    const app = makeApp(
      makeMockWatchdog({ "asset-1": FRESH_PRICE }, ["asset-1"])
    );
    const res = await request(app).get("/api/price/asset-1");
    expect(res.status).toBe(503);
  });

  it("returns 200 with price data when fresh (spec §3)", async () => {
    const app = makeApp(makeMockWatchdog({ "asset-1": FRESH_PRICE }));
    const res = await request(app).get("/api/price/asset-1");
    expect(res.status).toBe(200);
    expect(res.body.bestAsk).toBe(0.62);
    expect(res.body.bestBid).toBe(0.58);
    expect(res.body.updatedAt).toBeDefined();
    expect(res.body.assetId).toBe("asset-1");
  });
});

describe("GET /api/price (batch)", () => {
  it("returns all subscribed prices when no assetIds param", async () => {
    const app = makeApp(
      makeMockWatchdog({ "asset-1": FRESH_PRICE }, [], ["asset-1"])
    );
    const res = await request(app).get("/api/price");
    expect(res.status).toBe(200);
    expect(res.body["asset-1"]).toBeDefined();
    expect(res.body["asset-1"].bestAsk).toBe(0.62);
  });

  it("returns filtered prices when assetIds param provided", async () => {
    const app = makeApp(
      makeMockWatchdog({ "asset-1": FRESH_PRICE, "asset-2": { bestAsk: 0.3, bestBid: 0.25, updatedAt: Date.now() } })
    );
    const res = await request(app).get("/api/price?assetIds[]=asset-1");
    expect(res.status).toBe(200);
    expect(res.body["asset-1"]).toBeDefined();
    expect(res.body["asset-2"]).toBeUndefined();
  });

  it("includes stale:true flag for stale assets", async () => {
    const app = makeApp(
      makeMockWatchdog({ "asset-1": FRESH_PRICE }, ["asset-1"], ["asset-1"])
    );
    const res = await request(app).get("/api/price");
    expect(res.body["asset-1"].stale).toBe(true);
  });

  it("returns error for unknown assetIds in batch", async () => {
    const app = makeApp(makeMockWatchdog());
    const res = await request(app).get("/api/price?assetIds[]=unknown");
    expect(res.status).toBe(200);
    expect(res.body["unknown"].error).toBeDefined();
  });
});
