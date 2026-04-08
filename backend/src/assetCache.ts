import { buildAuthHeaders } from "./hmac";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MarketData {
  id: string;
  question: string;
  category: "Sports" | "Politics" | "Crypto" | "Finance";
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  spread: number;
  assetId: string;
  yesAssetId: string;
  noAssetId: string;
}

interface PolyToken {
  token_id: string;
  outcome: string;
  price?: number;
  winner?: boolean;
}

interface PolyMarket {
  condition_id: string;
  question_id?: string;
  market_slug?: string;
  question: string;
  description?: string;
  category?: string;
  tags?: string[];
  tokens: PolyToken[];
  volume?: number | string;
  volume_24hr?: number | string;
  spread?: number | string;
  active?: boolean;
  closed?: boolean;
}

// ─── Mock data fallback ────────────────────────────────────────────────────

const MOCK_MARKETS: MarketData[] = [
  {
    id: "mock-btc-100k",
    question: "Will BTC exceed $100,000 before end of 2025?",
    category: "Crypto",
    yesPrice: 0.62,
    noPrice: 0.38,
    volume24h: 1_200_000,
    spread: 0.02,
    assetId: "21742633143463906290569050155826241533067272736897614950488156847949938836455",
    yesAssetId: "21742633143463906290569050155826241533067272736897614950488156847949938836455",
    noAssetId: "52114319501245915516055106046884209969926127482827954674443846427813813222426",
  },
  {
    id: "mock-eth-flip",
    question: "Will ETH flip BTC in market cap before 2026?",
    category: "Crypto",
    yesPrice: 0.12,
    noPrice: 0.88,
    volume24h: 850_000,
    spread: 0.04,
    assetId: "mock-eth-flip-yes",
    yesAssetId: "mock-eth-flip-yes",
    noAssetId: "mock-eth-flip-no",
  },
  {
    id: "mock-fed-rate",
    question: "Will the Fed cut rates in Q3 2025?",
    category: "Finance",
    yesPrice: 0.44,
    noPrice: 0.56,
    volume24h: 650_000,
    spread: 0.03,
    assetId: "mock-fed-rate-yes",
    yesAssetId: "mock-fed-rate-yes",
    noAssetId: "mock-fed-rate-no",
  },
  {
    id: "mock-election",
    question: "Will the incumbent party win the next US presidential election?",
    category: "Politics",
    yesPrice: 0.51,
    noPrice: 0.49,
    volume24h: 2_100_000,
    spread: 0.01,
    assetId: "mock-election-yes",
    yesAssetId: "mock-election-yes",
    noAssetId: "mock-election-no",
  },
  {
    id: "mock-superbowl",
    question: "Will the Kansas City Chiefs win Super Bowl LX?",
    category: "Sports",
    yesPrice: 0.28,
    noPrice: 0.72,
    volume24h: 980_000,
    spread: 0.025,
    assetId: "mock-superbowl-yes",
    yesAssetId: "mock-superbowl-yes",
    noAssetId: "mock-superbowl-no",
  },
];

// ─── Cache state ───────────────────────────────────────────────────────────

export const assetIdCache: Map<string, string> = new Map(); // slug:outcome -> token_id
let marketsCache: MarketData[] = [];
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helper: derive category from tags/category field ──────────────────────

function deriveCategory(market: PolyMarket): "Sports" | "Politics" | "Crypto" | "Finance" {
  const cat = (market.category ?? "").toLowerCase();
  const tags = (market.tags ?? []).map((t) => t.toLowerCase());
  const all = [cat, ...tags].join(" ");

  if (all.includes("sport") || all.includes("soccer") || all.includes("nfl") || all.includes("nba") || all.includes("mlb") || all.includes("tennis") || all.includes("golf")) {
    return "Sports";
  }
  if (all.includes("politic") || all.includes("election") || all.includes("government") || all.includes("congress") || all.includes("senate") || all.includes("president")) {
    return "Politics";
  }
  if (all.includes("financ") || all.includes("stock") || all.includes("fed") || all.includes("economy") || all.includes("gdp") || all.includes("inflation") || all.includes("rate")) {
    return "Finance";
  }
  if (all.includes("crypto") || all.includes("bitcoin") || all.includes("ethereum") || all.includes("btc") || all.includes("eth") || all.includes("defi") || all.includes("nft")) {
    return "Crypto";
  }
  return "Crypto"; // Default
}

// ─── Fetch from Polymarket CLOB ────────────────────────────────────────────

async function fetchMarketsFromAPI(): Promise<MarketData[]> {
  const apiUrl = process.env.CLOB_API_URL ?? "https://clob-api.polymarket.com";
  const headers = buildAuthHeaders("GET", "/markets", "");

  const url = `${apiUrl}/markets?limit=100&active=true`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Polymarket API returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as { data?: PolyMarket[]; markets?: PolyMarket[] } | PolyMarket[];

  let rawMarkets: PolyMarket[];
  if (Array.isArray(data)) {
    rawMarkets = data;
  } else if (data.data) {
    rawMarkets = data.data;
  } else if (data.markets) {
    rawMarkets = data.markets;
  } else {
    rawMarkets = [];
  }

  const markets: MarketData[] = [];

  for (const m of rawMarkets) {
    if (!m.tokens || m.tokens.length < 2) continue;

    const yesToken = m.tokens.find((t) => t.outcome?.toUpperCase() === "YES");
    const noToken = m.tokens.find((t) => t.outcome?.toUpperCase() === "NO");

    if (!yesToken || !noToken) continue;

    const yesPrice = Number(yesToken.price ?? 0.5);
    const noPrice = Number(noToken.price ?? 0.5);
    const volume24h = Number(m.volume_24hr ?? m.volume ?? 0);
    const spread = Number(m.spread ?? 0.02);

    // Populate assetIdCache
    if (m.market_slug) {
      assetIdCache.set(`${m.market_slug}:YES`, yesToken.token_id);
      assetIdCache.set(`${m.market_slug}:NO`, noToken.token_id);
    }

    markets.push({
      id: m.condition_id,
      question: m.question,
      category: deriveCategory(m),
      yesPrice,
      noPrice: parseFloat((1 - yesPrice).toFixed(4)),
      volume24h,
      spread,
      assetId: yesToken.token_id,
      yesAssetId: yesToken.token_id,
      noAssetId: noToken.token_id,
    });
  }

  return markets;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function warmAssetCache(): Promise<void> {
  try {
    console.log("[assetCache] Warming asset cache from Polymarket CLOB...");
    const markets = await fetchMarketsFromAPI();
    marketsCache = markets.sort((a, b) => b.volume24h - a.volume24h);
    lastRefresh = Date.now();
    console.log(`[assetCache] Loaded ${marketsCache.length} markets.`);
  } catch (err) {
    console.warn("[assetCache] Failed to fetch from CLOB API, using mock data:", err instanceof Error ? err.message : err);
    marketsCache = MOCK_MARKETS;
    lastRefresh = Date.now();

    // Populate assetIdCache from mock data
    for (const m of MOCK_MARKETS) {
      assetIdCache.set(`${m.id}:YES`, m.yesAssetId);
      assetIdCache.set(`${m.id}:NO`, m.noAssetId);
    }
  }

  // Schedule auto-refresh
  setTimeout(async () => {
    await warmAssetCache();
  }, REFRESH_INTERVAL_MS);
}

export function getAssetId(slug: string, outcome: string): string | undefined {
  return assetIdCache.get(`${slug}:${outcome.toUpperCase()}`);
}

export function getFeaturedMarkets(): MarketData[] {
  // Return top 5 markets sorted by volume (simulating volume acceleration)
  return [...marketsCache].sort((a, b) => b.volume24h - a.volume24h).slice(0, 5);
}

export function getAllMarkets(): MarketData[] {
  return [...marketsCache].sort((a, b) => b.volume24h - a.volume24h);
}

export function isStale(): boolean {
  return Date.now() - lastRefresh > REFRESH_INTERVAL_MS;
}
