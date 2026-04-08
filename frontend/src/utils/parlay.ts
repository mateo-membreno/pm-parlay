import { ParlayLeg, ActiveLeg, PriceData, Market } from "../types";

export function calcImpliedOdds(legs: ParlayLeg[]): number {
  if (!legs.length) return 0;
  return legs.reduce((acc, leg) => acc * leg.price, 1);
}

export function calcMultiplier(legs: ParlayLeg[]): number {
  const implied = calcImpliedOdds(legs);
  if (implied === 0) return 0;
  return 1 / implied;
}

export function calcPotentialPayout(legs: ParlayLeg[], stake: number): number {
  const multiplier = calcMultiplier(legs);
  return stake * multiplier;
}

export function calcCashOutValue(
  activeLegs: ActiveLeg[],
  prices: Map<string, PriceData>
): number {
  return activeLegs.reduce((total, leg) => {
    const priceData = prices.get(leg.assetId);
    const bestBid = priceData?.bestBid ?? 0;
    return total + leg.sharesHeld * bestBid;
  }, 0);
}

export function calcSpread(bestAsk: number, bestBid: number): number {
  if (bestAsk === 0) return 0;
  return (bestAsk - bestBid) / bestAsk;
}

const LOW_LIQUIDITY_THRESHOLD = 0.1; // 10%

export function hasLowLiquidity(
  legs: ParlayLeg[],
  prices: Map<string, PriceData>
): boolean {
  return legs.some((leg) => {
    const priceData = prices.get(leg.assetId);
    if (!priceData) return true;
    return calcSpread(priceData.bestAsk, priceData.bestBid) > LOW_LIQUIDITY_THRESHOLD;
  });
}

export function getPrice(market: Market, outcome: "yes" | "no"): number {
  return outcome === "yes"
    ? market.yesPrice
    : parseFloat((1 - market.yesPrice).toFixed(4));
}

export function formatPrice(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export function formatDollars(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(0)}K`;
  }
  return `$${volume.toFixed(0)}`;
}
