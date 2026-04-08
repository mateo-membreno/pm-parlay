import { create } from "zustand";
import { ethers } from "ethers";
import {
  Market,
  ParlayLeg,
  ParlayState,
  ActiveLeg,
  ParlayStore,
} from "../types";
import { getPrice } from "../utils/parlay";

// ─── EIP-712 Domain ────────────────────────────────────────────────────────

const EIP712_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: 137,
  verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
} as const;

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "feeRateBps", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "signer", type: "address" },
    { name: "expiration", type: "uint256" },
  ],
};

// ─── Order helpers ─────────────────────────────────────────────────────────

interface ClobOrder {
  market: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  orderType: "FOK" | "FAK";
  funder: string;
  signature: string;
  nonce: number;
  expiration: number;
}

async function signOrderEIP712(
  signer: ethers.Signer,
  makerAddress: string,
  proxyWallet: string,
  assetId: string,
  side: "BUY" | "SELL",
  makerAmount: bigint,
  takerAmount: bigint,
  nonce: number
): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + 60;

  const orderValue = {
    maker: makerAddress,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: BigInt(assetId.length > 20 ? assetId : "0"),
    makerAmount,
    takerAmount,
    side: side === "BUY" ? 0 : 1,
    feeRateBps: BigInt(0),
    nonce: BigInt(nonce),
    signer: makerAddress,
    expiration: BigInt(expiration),
  };

  // ethers v6: signTypedData(domain, types, value)
  const signature = await (signer as ethers.JsonRpcSigner).signTypedData(
    EIP712_DOMAIN,
    ORDER_TYPES,
    orderValue
  );

  // Suppress unused var warning - proxyWallet is needed for funder field on order
  void proxyWallet;

  return signature;
}

function buildLegOrders(
  legs: ParlayLeg[],
  totalStake: number,
  slippage: number,
  proxyWallet: string,
  signatures: string[]
): ClobOrder[] {
  const stakePerLeg = totalStake / legs.length;

  return legs.map((leg, i) => {
    const limitPrice = parseFloat((leg.price * (1 + slippage)).toFixed(4));
    const shares = parseFloat((stakePerLeg / limitPrice).toFixed(2));

    return {
      market: leg.assetId,
      side: "BUY",
      size: shares,
      price: limitPrice,
      orderType: "FOK",
      funder: proxyWallet,
      signature: signatures[i],
      nonce: Date.now() + i,
      expiration: Math.floor(Date.now() / 1000) + 60,
    };
  });
}

function buildCashOutOrders(
  positions: ActiveLeg[],
  slippage: number,
  proxyWallet: string,
  signatures: string[]
): ClobOrder[] {
  return positions.map((pos, i) => {
    // For cash out, we use current price - slippage as a fallback
    const sellPrice = parseFloat((pos.price * (1 - slippage)).toFixed(4));

    return {
      market: pos.assetId,
      side: "SELL",
      size: pos.sharesHeld,
      price: sellPrice,
      orderType: "FOK",
      funder: proxyWallet,
      signature: signatures[i],
      nonce: Date.now() + i,
      expiration: Math.floor(Date.now() / 1000) + 60,
    };
  });
}

// ─── Zustand Store ─────────────────────────────────────────────────────────

interface ParlayStoreState extends ParlayStore {
  _lastSignedLegs: ParlayLeg[];
  _lastSignatures: string[];
  _walletAddress: string;
}

export const useParlayStore = create<ParlayStoreState>((set, get) => ({
  legs: [],
  state: "idle" as ParlayState,
  totalStake: 25,
  slippage: 0.01,
  activeLegs: [],
  entryStake: 0,
  failedLegInfo: undefined,
  _lastSignedLegs: [],
  _lastSignatures: [],
  _walletAddress: "",

  addLeg: (market: Market, outcome: "yes" | "no") => {
    const { legs } = get();
    const assetId = outcome === "yes" ? market.yesAssetId : market.noAssetId;

    // Check if this market is already in the slip
    const existingIdx = legs.findIndex((l) => l.market.id === market.id);

    if (existingIdx !== -1) {
      const existing = legs[existingIdx];
      if (existing.outcome === outcome) {
        // Clicking same outcome removes the leg
        const next = legs.filter((_, i) => i !== existingIdx);
        set({
          legs: next,
          state: next.length === 0 ? "idle" : "building",
        });
      } else {
        // Swap outcome
        const price = getPrice(market, outcome);
        const next = legs.map((l, i) =>
          i === existingIdx ? { ...l, outcome, price, assetId } : l
        );
        set({ legs: next });
      }
      return;
    }

    // Max 5 legs
    if (legs.length >= 5) {
      return;
    }

    const price = getPrice(market, outcome);
    const newLeg: ParlayLeg = { market, outcome, price, assetId };

    set({
      legs: [...legs, newLeg],
      state: "building",
    });
  },

  removeLeg: (assetId: string) => {
    const { legs } = get();
    const next = legs.filter((l) => l.assetId !== assetId);
    set({
      legs: next,
      state: next.length === 0 ? "idle" : "building",
    });
  },

  swapOutcome: (marketId: string, outcome: "yes" | "no") => {
    const { legs } = get();
    const next = legs.map((l) => {
      if (l.market.id !== marketId) return l;
      const assetId = outcome === "yes" ? l.market.yesAssetId : l.market.noAssetId;
      const price = getPrice(l.market, outcome);
      return { ...l, outcome, price, assetId };
    });
    set({ legs: next });
  },

  setStake: (amount: number) => {
    set({ totalStake: amount });
  },

  setSlippage: (value: number) => {
    // Clamp to 0.5%–3% per spec
    set({ slippage: Math.min(0.03, Math.max(0.005, value)) });
  },

  placeParlay: async (eoaAddress: string) => {
    const { legs, totalStake, slippage } = get();

    if (!legs.length) return;

    set({ state: "signing" });

    try {
      // Get wallet signer
      if (!window.ethereum) throw new Error("No wallet detected");

      const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // ── Resolve proxy wallet (spec §1: funder MUST be Proxy Wallet, not EOA) ──
      let proxyWallet = eoaAddress;
      try {
        const res = await fetch(`/api/proxy-wallet/${signerAddress}`);
        if (res.ok) {
          const data = await res.json() as { proxyWallet: string; resolved: boolean };
          proxyWallet = data.proxyWallet;
          if (!data.resolved) {
            console.warn("[parlayStore] Proxy wallet unresolved — using EOA as funder (orders may fail)");
          }
        }
      } catch (err) {
        console.warn("[parlayStore] Failed to resolve proxy wallet:", err);
      }

      set((s) => ({ ...s, _walletAddress: signerAddress }));

      // Sign each leg
      const signatures: string[] = [];
      const stakePerLeg = totalStake / legs.length;

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const limitPrice = parseFloat((leg.price * (1 + slippage)).toFixed(4));
        const shares = parseFloat((stakePerLeg / limitPrice).toFixed(2));

        // makerAmount = USDC cost (6 decimals), takerAmount = shares (in token units)
        const makerAmountUnits = BigInt(Math.round(stakePerLeg * 1e6));
        const takerAmountUnits = BigInt(Math.round(shares * 1e6));

        try {
          const sig = await signOrderEIP712(
            signer,
            signerAddress,
            proxyWallet,
            leg.assetId,
            "BUY",
            makerAmountUnits,
            takerAmountUnits,
            Date.now() + i
          );
          signatures.push(sig);
        } catch (sigErr) {
          console.error(`[parlayStore] Failed to sign leg ${i}:`, sigErr);
          set({ state: "building" });
          return;
        }
      }

      set({ state: "pending", _lastSignedLegs: legs, _lastSignatures: signatures });

      const orders = buildLegOrders(legs, totalStake, slippage, proxyWallet, signatures);

      const response = await fetch("/api/parlay/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });

      const result = await response.json() as {
        success?: boolean;
        orderIds?: string[];
        error?: string;
        failedLeg?: number;
        mock?: boolean;
      };

      if (!response.ok) {
        const failedLeg = result.failedLeg ?? 0;
        set({
          state: "failed",
          failedLegInfo: {
            legIndex: failedLeg,
            question: legs[failedLeg]?.market.question ?? "Unknown leg",
          },
        });
        return;
      }

      // Success — move to active state
      const stakePerLegFinal = totalStake / legs.length;
      const activeLegs: ActiveLeg[] = legs.map((leg) => {
        const limitPrice = parseFloat((leg.price * (1 + slippage)).toFixed(4));
        const sharesHeld = parseFloat((stakePerLegFinal / limitPrice).toFixed(2));
        return {
          ...leg,
          sharesHeld,
          status: "OPEN" as const,
        };
      });

      set({
        state: "active",
        activeLegs,
        entryStake: totalStake,
        legs: [],
      });
    } catch (err) {
      console.error("[parlayStore] placeParlay error:", err);
      set({ state: "building" });
    }
  },

  cashOut: async (eoaAddress: string) => {
    const { activeLegs, slippage } = get();

    if (!activeLegs.length) return;

    set({ state: "cashing_out" });

    try {
      if (!window.ethereum) throw new Error("No wallet detected");

      const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // ── Resolve proxy wallet (spec §1: funder MUST be Proxy Wallet, not EOA) ──
      let proxyWallet = eoaAddress;
      try {
        const res = await fetch(`/api/proxy-wallet/${signerAddress}`);
        if (res.ok) {
          const data = await res.json() as { proxyWallet: string; resolved: boolean };
          proxyWallet = data.proxyWallet;
        }
      } catch (err) {
        console.warn("[parlayStore] Failed to resolve proxy wallet for cash out:", err);
      }

      const signatures: string[] = [];

      for (let i = 0; i < activeLegs.length; i++) {
        const leg = activeLegs[i];
        const sellPrice = parseFloat((leg.price * (1 - slippage)).toFixed(4));
        const sharesUnits = BigInt(Math.round(leg.sharesHeld * 1e6));
        const proceedsUnits = BigInt(Math.round(leg.sharesHeld * sellPrice * 1e6));

        try {
          const sig = await signOrderEIP712(
            signer,
            signerAddress,
            proxyWallet,
            leg.assetId,
            "SELL",
            sharesUnits,
            proceedsUnits,
            Date.now() + i
          );
          signatures.push(sig);
        } catch (sigErr) {
          console.error(`[parlayStore] Failed to sign cash out leg ${i}:`, sigErr);
          set({ state: "active" });
          return;
        }
      }

      const orders = buildCashOutOrders(activeLegs, slippage, proxyWallet, signatures);

      const response = await fetch("/api/parlay/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });

      if (!response.ok) {
        set({ state: "active" });
        return;
      }

      set({ state: "closed", activeLegs: [], entryStake: 0 });
    } catch (err) {
      console.error("[parlayStore] cashOut error:", err);
      set({ state: "active" });
    }
  },

  resetParlay: () => {
    set({
      legs: [],
      state: "idle",
      totalStake: 25,
      activeLegs: [],
      entryStake: 0,
      failedLegInfo: undefined,
      _lastSignedLegs: [],
      _lastSignatures: [],
    });
  },

  retryParlay: async (proxyWallet: string) => {
    const { _lastSignedLegs } = get();
    if (!_lastSignedLegs.length) return;

    // Restore legs from last signed state and re-place
    set({ legs: _lastSignedLegs, state: "building", failedLegInfo: undefined });
    await get().placeParlay(proxyWallet);
  },
}));
