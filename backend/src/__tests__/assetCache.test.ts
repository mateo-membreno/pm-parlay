/**
 * Tests for assetCache (spec §6 — latency optimization via asset ID caching)
 *
 * Key behaviors:
 * - warmAssetCache populates marketsCache from CLOB API
 * - Falls back to mock data when API is unavailable (spec §6)
 * - getFeaturedMarkets returns exactly 5 markets (spec §7)
 * - getAllMarkets returns all markets sorted by volume desc (spec §7)
 * - getAssetId resolves slug:outcome → token_id (spec §6)
 * - Cache refreshes every 5 minutes (spec §6)
 */

// Mock dotenv to avoid loading .env during tests
jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock hmac so we don't need real API credentials
jest.mock("../hmac", () => ({
  buildAuthHeaders: jest.fn().mockReturnValue({ "Content-Type": "application/json" }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  warmAssetCache,
  getFeaturedMarkets,
  getAllMarkets,
  getAssetId,
  isStale,
} from "../assetCache";

const MOCK_POLY_RESPONSE = {
  data: [
    {
      condition_id: "cid-1",
      question: "Will BTC exceed $100k?",
      market_slug: "btc-100k",
      category: "crypto",
      tokens: [
        { token_id: "yes-token-1", outcome: "YES", price: 0.62 },
        { token_id: "no-token-1", outcome: "NO", price: 0.38 },
      ],
      volume_24hr: 1_200_000,
      spread: 0.02,
      active: true,
    },
    {
      condition_id: "cid-2",
      question: "Will the Fed cut rates?",
      market_slug: "fed-cut",
      category: "finance",
      tokens: [
        { token_id: "yes-token-2", outcome: "YES", price: 0.44 },
        { token_id: "no-token-2", outcome: "NO", price: 0.56 },
      ],
      volume_24hr: 650_000,
      spread: 0.03,
      active: true,
    },
    {
      condition_id: "cid-3",
      question: "Super Bowl winner?",
      market_slug: "superbowl",
      category: "sports",
      tokens: [
        { token_id: "yes-token-3", outcome: "YES", price: 0.28 },
        { token_id: "no-token-3", outcome: "NO", price: 0.72 },
      ],
      volume_24hr: 980_000,
      spread: 0.025,
      active: true,
    },
  ],
};

describe("warmAssetCache — success path", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_POLY_RESPONSE,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    mockFetch.mockReset();
  });

  it("populates market cache from API response (spec §6)", async () => {
    await warmAssetCache();
    const markets = getAllMarkets();
    expect(markets.length).toBeGreaterThan(0);
  });

  it("getAllMarkets returns markets sorted by volume descending (spec §7)", async () => {
    await warmAssetCache();
    const markets = getAllMarkets();
    for (let i = 1; i < markets.length; i++) {
      expect(markets[i - 1].volume24h).toBeGreaterThanOrEqual(markets[i].volume24h);
    }
  });

  it("getFeaturedMarkets returns at most 5 markets (spec §7)", async () => {
    await warmAssetCache();
    expect(getFeaturedMarkets().length).toBeLessThanOrEqual(5);
  });

  it("populates assetIdCache with slug:outcome keys (spec §6)", async () => {
    await warmAssetCache();
    expect(getAssetId("btc-100k", "YES")).toBe("yes-token-1");
    expect(getAssetId("btc-100k", "NO")).toBe("no-token-1");
  });

  it("getAssetId is case-insensitive for outcome (spec §6)", async () => {
    await warmAssetCache();
    expect(getAssetId("btc-100k", "yes")).toBe("yes-token-1");
    expect(getAssetId("btc-100k", "no")).toBe("no-token-1");
  });

  it("isStale returns false immediately after warmAssetCache", async () => {
    await warmAssetCache();
    expect(isStale()).toBe(false);
  });

  it("isStale returns true after 5 minutes (spec §6)", async () => {
    await warmAssetCache();
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(isStale()).toBe(true);
  });
});

describe("warmAssetCache — fallback to mock data", () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it("falls back to mock data when API fetch fails (spec §6)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    await warmAssetCache();
    const markets = getAllMarkets();
    expect(markets.length).toBeGreaterThan(0);
  });

  it("falls back to mock data when API returns non-ok status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => "Service Unavailable" });
    await warmAssetCache();
    const markets = getAllMarkets();
    expect(markets.length).toBeGreaterThan(0);
  });
});

describe("market data shape", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_POLY_RESPONSE });
  });
  afterEach(() => { mockFetch.mockReset(); });

  it("each market has required fields", async () => {
    await warmAssetCache();
    for (const m of getAllMarkets()) {
      expect(m.id).toBeDefined();
      expect(m.question).toBeDefined();
      expect(["Sports", "Politics", "Crypto", "Finance"]).toContain(m.category);
      expect(m.yesPrice).toBeGreaterThanOrEqual(0);
      expect(m.yesPrice).toBeLessThanOrEqual(1);
      expect(m.yesAssetId).toBeDefined();
      expect(m.noAssetId).toBeDefined();
    }
  });

  it("noPrice is derived as 1 - yesPrice (spec §8)", async () => {
    await warmAssetCache();
    for (const m of getAllMarkets()) {
      expect(m.noPrice).toBeCloseTo(1 - m.yesPrice, 4);
    }
  });

  it("skips markets without both YES and NO tokens", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { condition_id: "bad", question: "Bad market", tokens: [{ token_id: "t1", outcome: "YES" }] },
          ...MOCK_POLY_RESPONSE.data,
        ],
      }),
    });
    await warmAssetCache();
    const ids = getAllMarkets().map((m) => m.id);
    expect(ids).not.toContain("bad");
  });
});
