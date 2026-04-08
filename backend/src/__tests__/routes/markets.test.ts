/**
 * Tests for GET /api/markets routes (spec §7)
 *
 * Key behaviors:
 * - /featured returns top 5 volume-accelerating markets
 * - / returns all markets sorted by volume
 * - Both routes enrich with live prices from watchdog
 * - spread is recalculated from live bid/ask (spec §5)
 */

import express from "express";
import request from "supertest";
import { createMarketsRouter } from "../../routes/markets";

jest.mock("../../assetCache", () => ({
  getFeaturedMarkets: jest.fn(),
  getAllMarkets: jest.fn(),
}));

import { getFeaturedMarkets, getAllMarkets } from "../../assetCache";

const MOCK_MARKETS = [
  {
    id: "m1",
    question: "Will BTC exceed $100k?",
    category: "Crypto",
    yesPrice: 0.62,
    noPrice: 0.38,
    volume24h: 1_200_000,
    spread: 0.02,
    assetId: "asset-yes-1",
    yesAssetId: "asset-yes-1",
    noAssetId: "asset-no-1",
  },
  {
    id: "m2",
    question: "Will the Fed cut rates?",
    category: "Finance",
    yesPrice: 0.44,
    noPrice: 0.56,
    volume24h: 650_000,
    spread: 0.05,
    assetId: "asset-yes-2",
    yesAssetId: "asset-yes-2",
    noAssetId: "asset-no-2",
  },
];

function makeMockWatchdog(priceOverrides: Record<string, { bestAsk: number; bestBid: number }> = {}) {
  return {
    getPrice: jest.fn((assetId: string) => priceOverrides[assetId] ?? null),
    isStale: jest.fn().mockReturnValue(false),
  };
}

function makeApp(watchdog: ReturnType<typeof makeMockWatchdog>) {
  const app = express();
  app.use(express.json());
  app.use("/api/markets", createMarketsRouter(watchdog as any));
  return app;
}

describe("GET /api/markets/featured (spec §7)", () => {
  beforeEach(() => {
    (getFeaturedMarkets as jest.Mock).mockReturnValue(MOCK_MARKETS.slice(0, 1));
  });

  it("returns 200 with an array", async () => {
    const app = makeApp(makeMockWatchdog());
    const res = await request(app).get("/api/markets/featured");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns markets with required fields (spec §7)", async () => {
    const app = makeApp(makeMockWatchdog());
    const res = await request(app).get("/api/markets/featured");
    const market = res.body[0];
    expect(market.id).toBeDefined();
    expect(market.question).toBeDefined();
    expect(market.yesPrice).toBeDefined();
    expect(market.category).toBeDefined();
  });

  it("overlays live bestAsk when watchdog has price data (spec §7)", async () => {
    const watchdog = makeMockWatchdog({ "asset-yes-1": { bestAsk: 0.70, bestBid: 0.65 } });
    const app = makeApp(watchdog);
    const res = await request(app).get("/api/markets/featured");
    expect(res.body[0].yesPrice).toBe(0.70);
  });

  it("recalculates spread from live bid/ask (spec §5)", async () => {
    const watchdog = makeMockWatchdog({ "asset-yes-1": { bestAsk: 0.70, bestBid: 0.63 } });
    const app = makeApp(watchdog);
    const res = await request(app).get("/api/markets/featured");
    const expectedSpread = parseFloat(((0.70 - 0.63) / 0.70).toFixed(4));
    expect(res.body[0].spread).toBeCloseTo(expectedSpread, 4);
  });

  it("falls back to cached price when watchdog has no data", async () => {
    const app = makeApp(makeMockWatchdog()); // no prices
    const res = await request(app).get("/api/markets/featured");
    expect(res.body[0].yesPrice).toBe(0.62); // original cached price
  });
});

describe("GET /api/markets (spec §7)", () => {
  beforeEach(() => {
    (getAllMarkets as jest.Mock).mockReturnValue([...MOCK_MARKETS]);
  });

  it("returns 200 with all markets", async () => {
    const app = makeApp(makeMockWatchdog());
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("enriches noPrice as 1 - yesAsk when live price available (spec §8)", async () => {
    const watchdog = makeMockWatchdog({ "asset-yes-1": { bestAsk: 0.60, bestBid: 0.55 } });
    const app = makeApp(watchdog);
    const res = await request(app).get("/api/markets");
    const m1 = res.body.find((m: any) => m.id === "m1");
    expect(m1.noPrice).toBeCloseTo(1 - 0.60, 4);
  });
});
