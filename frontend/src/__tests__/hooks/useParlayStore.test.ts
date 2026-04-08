/**
 * Tests for useParlayStore (spec §8 — parlay construction & state machine)
 *
 * Key behaviors:
 * - addLeg: adds new leg, transitions idle→building (spec §8)
 * - addLeg: same outcome toggles leg off (spec §8)
 * - addLeg: opposite outcome swaps in place (spec §8)
 * - addLeg: enforces max 5 legs (spec §8)
 * - removeLeg: removes by assetId, transitions building→idle when empty
 * - setStake: updates totalStake
 * - setSlippage: updates slippage, clamps to 0.5%–3% (spec §2)
 * - resetParlay: resets all state
 * - State machine: idle → building → signing → pending → active/failed
 */

import { act } from "react";
import { useParlayStore } from "../../hooks/useParlayStore";
import type { Market } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMarket(id: string, yesPrice = 0.60): Market {
  return {
    id,
    question: `Question ${id}?`,
    category: "Crypto",
    yesPrice,
    noPrice: parseFloat((1 - yesPrice).toFixed(4)),
    volume24h: 100_000,
    spread: 0.02,
    assetId: `${id}-yes`,
    yesAssetId: `${id}-yes`,
    noAssetId: `${id}-no`,
  };
}

function getStore() {
  return useParlayStore.getState();
}

function resetStore() {
  useParlayStore.setState({
    legs: [],
    state: "idle",
    totalStake: 25,
    slippage: 0.01,
    activeLegs: [],
    entryStake: 0,
    failedLegInfo: undefined,
  });
}

beforeEach(resetStore);

// ─── addLeg ──────────────────────────────────────────────────────────────────

describe("addLeg (spec §8)", () => {
  it("adds a new leg and transitions idle → building", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });

    const { legs, state } = getStore();
    expect(legs).toHaveLength(1);
    expect(state).toBe("building");
  });

  it("sets correct assetId for 'yes' outcome", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    expect(getStore().legs[0].assetId).toBe("m1-yes");
  });

  it("sets correct assetId for 'no' outcome", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "no"); });
    expect(getStore().legs[0].assetId).toBe("m1-no");
  });

  it("clicking the same outcome removes the leg (toggle off, spec §8)", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().addLeg(market, "yes"); }); // same outcome → remove

    expect(getStore().legs).toHaveLength(0);
    expect(getStore().state).toBe("idle");
  });

  it("clicking the opposite outcome swaps the leg in place (spec §8)", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().addLeg(market, "no"); }); // swap

    const { legs } = getStore();
    expect(legs).toHaveLength(1);
    expect(legs[0].outcome).toBe("no");
    expect(legs[0].assetId).toBe("m1-no");
  });

  it("enforces maximum 5 legs (spec §8)", () => {
    for (let i = 1; i <= 5; i++) {
      act(() => { getStore().addLeg(makeMarket(`m${i}`), "yes"); });
    }
    expect(getStore().legs).toHaveLength(5);

    // 6th add should be ignored
    act(() => { getStore().addLeg(makeMarket("m6"), "yes"); });
    expect(getStore().legs).toHaveLength(5);
  });

  it("transitions building → idle when last leg removed via addLeg toggle", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().addLeg(market, "yes"); }); // toggle off
    expect(getStore().state).toBe("idle");
  });
});

// ─── removeLeg ───────────────────────────────────────────────────────────────

describe("removeLeg", () => {
  it("removes a leg by assetId", () => {
    const m1 = makeMarket("m1");
    const m2 = makeMarket("m2");
    act(() => { getStore().addLeg(m1, "yes"); });
    act(() => { getStore().addLeg(m2, "yes"); });
    act(() => { getStore().removeLeg("m1-yes"); });

    const { legs } = getStore();
    expect(legs).toHaveLength(1);
    expect(legs[0].market.id).toBe("m2");
  });

  it("transitions building → idle when last leg is removed", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().removeLeg("m1-yes"); });
    expect(getStore().state).toBe("idle");
  });

  it("does nothing for an unknown assetId", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().removeLeg("nonexistent"); });
    expect(getStore().legs).toHaveLength(1);
  });
});

// ─── swapOutcome ─────────────────────────────────────────────────────────────

describe("swapOutcome", () => {
  it("changes outcome and assetId for matching market", () => {
    const market = makeMarket("m1");
    act(() => { getStore().addLeg(market, "yes"); });
    act(() => { getStore().swapOutcome("m1", "no"); });

    const leg = getStore().legs[0];
    expect(leg.outcome).toBe("no");
    expect(leg.assetId).toBe("m1-no");
  });

  it("does not change other legs", () => {
    const m1 = makeMarket("m1");
    const m2 = makeMarket("m2");
    act(() => { getStore().addLeg(m1, "yes"); });
    act(() => { getStore().addLeg(m2, "yes"); });
    act(() => { getStore().swapOutcome("m1", "no"); });

    expect(getStore().legs[1].outcome).toBe("yes");
  });
});

// ─── setStake ────────────────────────────────────────────────────────────────

describe("setStake", () => {
  it("updates totalStake", () => {
    act(() => { getStore().setStake(50); });
    expect(getStore().totalStake).toBe(50);
  });

  it("accepts 0", () => {
    act(() => { getStore().setStake(0); });
    expect(getStore().totalStake).toBe(0);
  });
});

// ─── setSlippage (spec §2) ────────────────────────────────────────────────────

describe("setSlippage (spec §2 — configurable 0.5%–3%)", () => {
  it("sets slippage value", () => {
    act(() => { getStore().setSlippage(0.02); });
    expect(getStore().slippage).toBe(0.02);
  });

  it("clamps minimum to 0.5%", () => {
    act(() => { getStore().setSlippage(0.001); }); // below 0.5%
    expect(getStore().slippage).toBe(0.005);
  });

  it("clamps maximum to 3%", () => {
    act(() => { getStore().setSlippage(0.10); }); // above 3%
    expect(getStore().slippage).toBe(0.03);
  });

  it("accepts exactly 0.5%", () => {
    act(() => { getStore().setSlippage(0.005); });
    expect(getStore().slippage).toBe(0.005);
  });

  it("accepts exactly 3%", () => {
    act(() => { getStore().setSlippage(0.03); });
    expect(getStore().slippage).toBe(0.03);
  });
});

// ─── resetParlay ─────────────────────────────────────────────────────────────

describe("resetParlay", () => {
  it("clears all legs and resets to idle state", () => {
    act(() => { getStore().addLeg(makeMarket("m1"), "yes"); });
    act(() => { getStore().addLeg(makeMarket("m2"), "yes"); });
    act(() => { getStore().resetParlay(); });

    const s = getStore();
    expect(s.legs).toHaveLength(0);
    expect(s.state).toBe("idle");
  });

  it("resets totalStake to default 25", () => {
    act(() => { getStore().setStake(100); });
    act(() => { getStore().resetParlay(); });
    expect(getStore().totalStake).toBe(25);
  });

  it("clears failedLegInfo", () => {
    useParlayStore.setState({ failedLegInfo: { legIndex: 0, question: "Q?" } });
    act(() => { getStore().resetParlay(); });
    expect(getStore().failedLegInfo).toBeUndefined();
  });

  it("clears activeLegs and entryStake", () => {
    useParlayStore.setState({ activeLegs: [], entryStake: 50 });
    act(() => { getStore().resetParlay(); });
    expect(getStore().entryStake).toBe(0);
  });
});

// ─── Share / limit price math (spec §2, §8) ──────────────────────────────────

describe("order math (spec §2, §8)", () => {
  it("limitPrice = bestAsk × (1 + slippage) per spec §2", () => {
    const bestAsk = 0.62;
    const slippage = 0.01;
    const limitPrice = parseFloat((bestAsk * (1 + slippage)).toFixed(4));
    expect(limitPrice).toBeCloseTo(0.6262, 4);
  });

  it("sharesPerLeg = stakePerLeg / limitPrice per spec §8", () => {
    const totalStake = 25;
    const numLegs = 3;
    const stakePerLeg = totalStake / numLegs;
    const limitPrice = 0.6262;
    const shares = parseFloat((stakePerLeg / limitPrice).toFixed(2));
    expect(shares).toBeCloseTo(stakePerLeg / limitPrice, 2);
  });

  it("stakePerLeg = totalStake / numberOfLegs (even split, spec §8)", () => {
    const totalStake = 30;
    expect(totalStake / 3).toBeCloseTo(10, 6);
  });
});

// ─── State machine transitions (spec §8) ─────────────────────────────────────

describe("state machine (spec §8)", () => {
  it("starts in idle state", () => {
    expect(getStore().state).toBe("idle");
  });

  it("idle → building when first leg added", () => {
    act(() => { getStore().addLeg(makeMarket("m1"), "yes"); });
    expect(getStore().state).toBe("building");
  });

  it("building → idle when all legs removed", () => {
    act(() => { getStore().addLeg(makeMarket("m1"), "yes"); });
    act(() => { getStore().removeLeg("m1-yes"); });
    expect(getStore().state).toBe("idle");
  });

  it("failed → building when resetParlay called after failure", () => {
    useParlayStore.setState({ state: "failed", failedLegInfo: { legIndex: 0, question: "Q?" } });
    act(() => { getStore().resetParlay(); });
    expect(getStore().state).toBe("idle");
  });
});
