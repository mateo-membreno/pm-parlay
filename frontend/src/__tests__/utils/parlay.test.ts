/**
 * Tests for frontend parlay math utilities (spec §5, §8)
 *
 * Key behaviors covered:
 * - Implied odds = product of leg prices (spec §5)
 * - Multiplier = 1 / implied (spec §5)
 * - PotentialPayout = stake × multiplier (spec §5)
 * - CashOutValue = Σ(shares_i × bestBid_i) (spec §5, §9)
 * - Spread = (ask - bid) / ask (spec §5)
 * - Low liquidity if spread > 10% (spec §5, §7)
 * - getPrice: Yes = bestAsk, No = 1 - bestAsk (spec §8)
 * - formatPrice rounds to nearest cent (spec §7)
 */

import {
  calcImpliedOdds,
  calcMultiplier,
  calcPotentialPayout,
  calcCashOutValue,
  calcSpread,
  hasLowLiquidity,
  getPrice,
  formatPrice,
  formatDollars,
  formatVolume,
} from "../../utils/parlay";
import type { ParlayLeg, ActiveLeg, Market, PriceData } from "../../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLeg(price: number, assetId = "a1"): ParlayLeg {
  return {
    market: { id: "m1", question: "Q?", category: "Crypto", yesPrice: price, noPrice: 1 - price, volume24h: 0, spread: 0, assetId, yesAssetId: assetId, noAssetId: "no-" + assetId } as Market,
    outcome: "yes",
    price,
    assetId,
  };
}

function makeActiveLeg(price: number, sharesHeld: number, assetId = "a1"): ActiveLeg {
  return { ...makeLeg(price, assetId), sharesHeld, status: "OPEN" };
}

function priceMap(entries: Record<string, { bestAsk: number; bestBid: number }>): Map<string, PriceData> {
  const m = new Map<string, PriceData>();
  for (const [id, p] of Object.entries(entries)) {
    m.set(id, { ...p, updatedAt: Date.now() });
  }
  return m;
}

// ─── calcImpliedOdds (spec §5) ────────────────────────────────────────────────

describe("calcImpliedOdds", () => {
  it("returns 0 for empty legs array", () => {
    expect(calcImpliedOdds([])).toBe(0);
  });

  it("returns the price for a single leg", () => {
    expect(calcImpliedOdds([makeLeg(0.60)])).toBeCloseTo(0.60);
  });

  it("returns product of all leg prices (spec §5)", () => {
    const legs = [makeLeg(0.60, "a1"), makeLeg(0.44, "a2"), makeLeg(0.28, "a3")];
    expect(calcImpliedOdds(legs)).toBeCloseTo(0.60 * 0.44 * 0.28, 6);
  });
});

// ─── calcMultiplier (spec §5) ────────────────────────────────────────────────

describe("calcMultiplier", () => {
  it("returns 0 when implied odds are 0", () => {
    expect(calcMultiplier([])).toBe(0);
  });

  it("returns 1/implied for valid legs (spec §5)", () => {
    const legs = [makeLeg(0.50, "a1"), makeLeg(0.50, "a2")];
    expect(calcMultiplier(legs)).toBeCloseTo(1 / (0.50 * 0.50), 4);
  });

  it("higher multiplier for less likely parlays", () => {
    const longShot = [makeLeg(0.10, "a1"), makeLeg(0.10, "a2")];
    const favourite = [makeLeg(0.80, "a3"), makeLeg(0.80, "a4")];
    expect(calcMultiplier(longShot)).toBeGreaterThan(calcMultiplier(favourite));
  });
});

// ─── calcPotentialPayout (spec §5) ───────────────────────────────────────────

describe("calcPotentialPayout", () => {
  it("returns 0 for empty legs", () => {
    expect(calcPotentialPayout([], 25)).toBe(0);
  });

  it("stake × multiplier (spec §5)", () => {
    const legs = [makeLeg(0.50, "a1"), makeLeg(0.50, "a2")];
    const multiplier = calcMultiplier(legs);
    expect(calcPotentialPayout(legs, 25)).toBeCloseTo(25 * multiplier, 4);
  });

  it("scales linearly with stake", () => {
    const legs = [makeLeg(0.44, "a1")];
    const p1 = calcPotentialPayout(legs, 10);
    const p2 = calcPotentialPayout(legs, 20);
    expect(p2).toBeCloseTo(p1 * 2, 6);
  });
});

// ─── calcCashOutValue (spec §5, §9) ──────────────────────────────────────────

describe("calcCashOutValue", () => {
  it("returns 0 for empty active legs", () => {
    expect(calcCashOutValue([], new Map())).toBe(0);
  });

  it("sums shares × bestBid for each leg (spec §5)", () => {
    const legs = [
      makeActiveLeg(0.60, 16.67, "a1"),
      makeActiveLeg(0.44, 18.94, "a2"),
    ];
    const prices = priceMap({ a1: { bestAsk: 0.62, bestBid: 0.58 }, a2: { bestAsk: 0.46, bestBid: 0.42 } });
    const expected = 16.67 * 0.58 + 18.94 * 0.42;
    expect(calcCashOutValue(legs, prices)).toBeCloseTo(expected, 4);
  });

  it("uses 0 for bestBid when price not available", () => {
    const legs = [makeActiveLeg(0.60, 10, "missing")];
    const prices = new Map<string, PriceData>();
    expect(calcCashOutValue(legs, prices)).toBe(0);
  });
});

// ─── calcSpread (spec §5) ────────────────────────────────────────────────────

describe("calcSpread", () => {
  it("returns (ask - bid) / ask (spec §5)", () => {
    expect(calcSpread(0.60, 0.54)).toBeCloseTo((0.60 - 0.54) / 0.60, 6);
  });

  it("returns 0 when ask is 0 (avoid division by zero)", () => {
    expect(calcSpread(0, 0)).toBe(0);
  });

  it("returns 0 when bid equals ask (zero spread)", () => {
    expect(calcSpread(0.50, 0.50)).toBe(0);
  });
});

// ─── hasLowLiquidity (spec §5, §7) ───────────────────────────────────────────

describe("hasLowLiquidity", () => {
  it("returns false when all spreads are ≤ 10% (spec §5)", () => {
    const legs = [makeLeg(0.60, "a1"), makeLeg(0.44, "a2")];
    const prices = priceMap({
      a1: { bestAsk: 0.60, bestBid: 0.55 }, // spread ≈ 8.3%
      a2: { bestAsk: 0.44, bestBid: 0.41 }, // spread ≈ 6.8%
    });
    expect(hasLowLiquidity(legs, prices)).toBe(false);
  });

  it("returns true when any leg spread exceeds 10% (spec §5)", () => {
    const legs = [makeLeg(0.60, "a1"), makeLeg(0.44, "a2")];
    const prices = priceMap({
      a1: { bestAsk: 0.60, bestBid: 0.55 }, // spread ≈ 8.3%
      a2: { bestAsk: 0.44, bestBid: 0.35 }, // spread ≈ 20.5%
    });
    expect(hasLowLiquidity(legs, prices)).toBe(true);
  });

  it("returns true when price data is missing for any leg (spec §5)", () => {
    const legs = [makeLeg(0.60, "no-price")];
    expect(hasLowLiquidity(legs, new Map())).toBe(true);
  });
});

// ─── getPrice (spec §8) ──────────────────────────────────────────────────────

describe("getPrice", () => {
  const market: Market = {
    id: "m1", question: "Q?", category: "Crypto",
    yesPrice: 0.62, noPrice: 0.38,
    volume24h: 0, spread: 0,
    assetId: "yes-1", yesAssetId: "yes-1", noAssetId: "no-1",
  };

  it("returns yesPrice for 'yes' outcome (spec §8)", () => {
    expect(getPrice(market, "yes")).toBe(0.62);
  });

  it("returns 1 - yesPrice for 'no' outcome (spec §8)", () => {
    expect(getPrice(market, "no")).toBeCloseTo(1 - 0.62, 4);
  });

  it("Yes + No prices sum to 1 (binary market invariant)", () => {
    expect(getPrice(market, "yes") + getPrice(market, "no")).toBeCloseTo(1, 4);
  });
});

// ─── formatPrice (spec §7) ───────────────────────────────────────────────────

describe("formatPrice", () => {
  it("formats 0.44 as '44¢'", () => {
    expect(formatPrice(0.44)).toBe("44¢");
  });

  it("rounds to nearest cent", () => {
    expect(formatPrice(0.4449)).toBe("44¢");
    expect(formatPrice(0.445)).toBe("45¢");
  });

  it("formats 0 as '0¢'", () => {
    expect(formatPrice(0)).toBe("0¢");
  });

  it("formats 1 as '100¢'", () => {
    expect(formatPrice(1)).toBe("100¢");
  });
});

// ─── formatDollars ───────────────────────────────────────────────────────────

describe("formatDollars", () => {
  it("formats 47.82 as '$47.82'", () => {
    expect(formatDollars(47.82)).toBe("$47.82");
  });

  it("always shows 2 decimal places", () => {
    expect(formatDollars(10)).toBe("$10.00");
    expect(formatDollars(10.1)).toBe("$10.10");
  });

  it("formats negative values", () => {
    expect(formatDollars(-5)).toBe("-$5.00");
  });
});

// ─── formatVolume ─────────────────────────────────────────────────────────────

describe("formatVolume", () => {
  it("formats 1,200,000 as '$1.2M'", () => {
    expect(formatVolume(1_200_000)).toBe("$1.2M");
  });

  it("formats 650,000 as '$650K'", () => {
    expect(formatVolume(650_000)).toBe("$650K");
  });

  it("formats small amounts without suffix", () => {
    expect(formatVolume(500)).toBe("$500");
  });
});
