export interface Market {
  id: string;
  question: string;
  category: "Sports" | "Politics" | "Crypto" | "Finance";
  yesPrice: number;   // 0-1
  noPrice: number;    // derived: 1 - yesPrice
  volume24h: number;
  spread: number;     // (ask - bid) / ask
  yesAssetId: string;
  noAssetId: string;
  assetId: string;    // YES token asset id (primary)
}

export interface ParlayLeg {
  market: Market;
  outcome: "yes" | "no";
  price: number;      // current price for chosen outcome
  assetId: string;    // asset id for chosen outcome
  shares?: number;    // filled after order placement
}

export interface PriceData {
  bestAsk: number;
  bestBid: number;
  updatedAt: number;
}

export type ParlayState =
  | "idle"
  | "building"
  | "signing"
  | "pending"
  | "active"
  | "cashing_out"
  | "failed"
  | "closed"
  | "settled";

export interface ActiveLeg extends ParlayLeg {
  sharesHeld: number;
  status: "OPEN" | "FILLED" | "CANCELLED";
}

export interface ParlayStore {
  legs: ParlayLeg[];
  state: ParlayState;
  totalStake: number;
  slippage: number;
  activeLegs: ActiveLeg[];
  entryStake: number;
  failedLegInfo?: { legIndex: number; question: string };

  addLeg: (market: Market, outcome: "yes" | "no") => void;
  removeLeg: (assetId: string) => void;
  swapOutcome: (marketId: string, outcome: "yes" | "no") => void;
  setStake: (amount: number) => void;
  setSlippage: (value: number) => void;
  placeParlay: (proxyWallet: string) => Promise<void>;
  cashOut: (proxyWallet: string) => Promise<void>;
  resetParlay: () => void;
  retryParlay: (proxyWallet: string) => Promise<void>;
}
