import { useState, useCallback, useEffect } from "react";
import { useParlayStore } from "../hooks/useParlayStore";
import { usePriceSocketStore } from "../hooks/usePriceSocket";
import {
  calcPotentialPayout,
  calcMultiplier,
  hasLowLiquidity,
  formatPrice,
  formatDollars,
} from "../utils/parlay";

type TrayState = "collapsed" | "peek" | "expanded";

const QUICK_STAKES = [5, 10, 25, 50, 100];

interface BetSlipProps {
  walletAddress: string | null;
  onConnectWallet: () => void;
}

export function BetSlip({ walletAddress, onConnectWallet }: BetSlipProps) {
  const legs = useParlayStore((s) => s.legs);
  const state = useParlayStore((s) => s.state);
  const totalStake = useParlayStore((s) => s.totalStake);
  const slippage = useParlayStore((s) => s.slippage);
  const setStake = useParlayStore((s) => s.setStake);
  const setSlippage = useParlayStore((s) => s.setSlippage);
  const removeLeg = useParlayStore((s) => s.removeLeg);
  const placeParlay = useParlayStore((s) => s.placeParlay);

  const prices = usePriceSocketStore((s) => s.prices);
  const isStale = usePriceSocketStore((s) => s.isStale);

  const [trayState, setTrayState] = useState<TrayState>("collapsed");

  // Auto-advance to peek when first leg added
  useEffect(() => {
    if (legs.length > 0 && trayState === "collapsed") {
      setTrayState("peek");
    }
    if (legs.length === 0) {
      setTrayState("collapsed");
    }
  }, [legs.length, trayState]);

  const handleToggleTray = useCallback(() => {
    if (trayState === "collapsed") return;
    setTrayState((prev) => (prev === "peek" ? "expanded" : "peek"));
  }, [trayState]);

  const handleBackdropClick = useCallback(() => {
    setTrayState("peek");
  }, []);

  const potentialPayout = calcPotentialPayout(legs, totalStake);
  const multiplier = calcMultiplier(legs);
  const stakePerLeg = legs.length > 0 ? totalStake / legs.length : 0;
  const lowLiq = hasLowLiquidity(legs, prices);
  const isPlacing = state === "signing" || state === "pending";

  const canPlace =
    !isPlacing &&
    legs.length >= 2 &&
    totalStake > 0 &&
    !isStale &&
    !!walletAddress;

  async function handlePlace() {
    if (!walletAddress) {
      onConnectWallet();
      return;
    }
    // Using EOA address as proxy wallet for this implementation
    // In production, resolve the actual Polymarket proxy wallet
    await placeParlay(walletAddress);
  }

  // Tray heights
  const trayHeights: Record<TrayState, number | string> = {
    collapsed: 54,
    peek: 112,
    expanded: "auto",
  };

  return (
    <>
      {/* Backdrop */}
      {trayState === "expanded" && (
        <div
          onClick={handleBackdropClick}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 49,
          }}
        />
      )}

      {/* Tray */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "#1a1a23",
          borderTop: "1px solid #2a2a38",
          borderRadius: "16px 16px 0 0",
          height: trayHeights[trayState],
          maxHeight: "85vh",
          overflowY: trayState === "expanded" ? "auto" : "hidden",
          transition: "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Handle */}
        <div
          onClick={handleToggleTray}
          style={{
            padding: "12px 20px",
            cursor: legs.length > 0 ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 4,
                borderRadius: 2,
                background: "#2a2a38",
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                top: 8,
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: legs.length > 0 ? "#f0f0f5" : "#8888aa",
                marginTop: 4,
              }}
            >
              {legs.length === 0
                ? "Bet slip"
                : `Bet slip · ${legs.length} leg${legs.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          {legs.length > 0 && totalStake > 0 && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#7F77DD",
                marginTop: 4,
              }}
            >
              → {formatDollars(potentialPayout)}
            </span>
          )}
        </div>

        {/* Expanded content */}
        {trayState === "expanded" && (
          <div style={{ padding: "0 16px 24px" }}>
            {/* Legs list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {legs.map((leg) => (
                <div
                  key={leg.assetId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: "#12121a",
                    borderRadius: 8,
                    border: "1px solid #2a2a38",
                  }}
                >
                  {/* Outcome tag */}
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: leg.outcome === "yes" ? "#261e4a" : "#3a1a12",
                      color: leg.outcome === "yes" ? "#7F77DD" : "#D85A30",
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      flexShrink: 0,
                    }}
                  >
                    {leg.outcome}
                  </span>

                  {/* Question */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: "#f0f0f5",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {leg.market.question}
                  </span>

                  {/* Price */}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#f0f0f5",
                      flexShrink: 0,
                    }}
                  >
                    {formatPrice(leg.price)}
                  </span>

                  {/* Remove */}
                  <button
                    onClick={() => removeLeg(leg.assetId)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#8888aa",
                      fontSize: 18,
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: 0,
                      flexShrink: 0,
                    }}
                    aria-label="Remove leg"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Stake input */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#8888aa",
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Total stake
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#12121a",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "0 12px",
                  height: 42,
                }}
              >
                <span style={{ color: "#8888aa", fontSize: 15, marginRight: 4 }}>$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={totalStake}
                  onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                  style={{
                    flex: 1,
                    background: "none",
                    border: "none",
                    color: "#f0f0f5",
                    fontSize: 15,
                    fontWeight: 600,
                    outline: "none",
                  }}
                />
              </div>

              {/* Quick stake buttons */}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {QUICK_STAKES.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setStake(amt)}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      borderRadius: 6,
                      background: totalStake === amt ? "#2a2a38" : "transparent",
                      border: "1px solid #2a2a38",
                      color: totalStake === amt ? "#f0f0f5" : "#8888aa",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Slippage control (spec §2: expose 0.5%–3%) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: "#8888aa", fontWeight: 600 }}>
                  Slippage tolerance
                </label>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f0f5" }}>
                  {(slippage * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[0.005, 0.01, 0.02, 0.03].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSlippage(v)}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      borderRadius: 6,
                      background: slippage === v ? "#2a2a38" : "transparent",
                      border: "1px solid #2a2a38",
                      color: slippage === v ? "#f0f0f5" : "#8888aa",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {(v * 100).toFixed(1)}%
                  </button>
                ))}
              </div>
            </div>

            {/* Payout card */}
            {legs.length >= 2 && (
              <div
                style={{
                  background: "#12121a",
                  border: "1px solid #2a2a38",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#8888aa" }}>Implied odds</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f0f5" }}>
                    {multiplier.toFixed(2)}x
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#8888aa" }}>Per-leg allocation</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f0f5" }}>
                    {formatDollars(stakePerLeg)} / leg
                  </span>
                </div>
                <div
                  style={{
                    borderTop: "1px solid #2a2a38",
                    paddingTop: 10,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#8888aa" }}>
                    Potential payout
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#7F77DD" }}>
                    {formatDollars(potentialPayout)}
                  </span>
                </div>
              </div>
            )}

            {/* Low liquidity warning */}
            {lowLiq && (
              <div
                style={{
                  padding: "10px 12px",
                  background: "#2a1e0a",
                  border: "1px solid #5a3e10",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#E8A44A",
                  lineHeight: 1.5,
                }}
              >
                One or more legs has low liquidity ({">"}10% spread). Your cash-out value may be significantly lower than your buy-in.
              </div>
            )}

            {/* Stale price warning */}
            {isStale && (
              <div
                style={{
                  padding: "10px 12px",
                  background: "#1e1a2a",
                  border: "1px solid #4a3a6a",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#9988CC",
                }}
              >
                Live prices paused. Reconnecting…
              </div>
            )}

            {/* Place button */}
            <button
              onClick={handlePlace}
              disabled={!canPlace && !!walletAddress}
              style={{
                width: "100%",
                padding: "14px 0",
                borderRadius: 10,
                background: !walletAddress
                  ? "#7F77DD"
                  : canPlace
                  ? "#7F77DD"
                  : "#2a2a38",
                border: "none",
                color: !walletAddress || canPlace ? "#fff" : "#8888aa",
                fontSize: 14,
                fontWeight: 700,
                cursor: !walletAddress || canPlace ? "pointer" : "not-allowed",
                letterSpacing: "-0.2px",
              }}
            >
              {isPlacing
                ? state === "signing"
                  ? "Waiting for signature…"
                  : "Submitting orders…"
                : !walletAddress
                ? "Connect wallet to place"
                : "Sign & place parlay"}
            </button>

            {legs.length < 2 && legs.length > 0 && (
              <p
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: "#8888aa",
                  marginTop: 8,
                  marginBottom: 0,
                }}
              >
                Add at least 2 legs to place a parlay
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
