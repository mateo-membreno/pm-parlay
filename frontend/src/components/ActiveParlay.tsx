import { useParlayStore } from "../hooks/useParlayStore";
import { usePriceSocketStore } from "../hooks/usePriceSocket";
import {
  calcCashOutValue,
  formatDollars,
  formatPrice,
  calcSpread,
} from "../utils/parlay";

interface ActiveParlayProps {
  walletAddress: string | null;
}

export function ActiveParlay({ walletAddress }: ActiveParlayProps) {
  const activeLegs = useParlayStore((s) => s.activeLegs);
  const entryStake = useParlayStore((s) => s.entryStake);
  const state = useParlayStore((s) => s.state);
  const cashOut = useParlayStore((s) => s.cashOut);
  const resetParlay = useParlayStore((s) => s.resetParlay);

  const prices = usePriceSocketStore((s) => s.prices);
  const isConnected = usePriceSocketStore((s) => s.isConnected);
  const isStale = usePriceSocketStore((s) => s.isStale);

  const liveValue = calcCashOutValue(activeLegs, prices);
  const pnl = liveValue - entryStake;
  const pnlPositive = pnl >= 0;

  const isCashingOut = state === "cashing_out";
  const isClosed = state === "closed";

  const hasLowLiqLeg = activeLegs.some((leg) => {
    const price = prices.get(leg.assetId);
    if (!price) return false;
    return calcSpread(price.bestAsk, price.bestBid) > 0.1;
  });

  async function handleCashOut() {
    if (!walletAddress) return;
    await cashOut(walletAddress);
  }

  if (isClosed) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0f0f13",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
          }}
        >
          ✓
        </div>
        <h2
          style={{
            color: "#f0f0f5",
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          Parlay cashed out
        </h2>
        <p style={{ color: "#8888aa", fontSize: 14, marginBottom: 32, textAlign: "center" }}>
          All positions have been sold.
        </p>
        <button
          onClick={resetParlay}
          style={{
            padding: "12px 32px",
            borderRadius: 10,
            background: "#7F77DD",
            border: "none",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Start new parlay
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f0f13",
        padding: "20px 20px 100px",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {/* Stale banner */}
      {(isStale || !isConnected) && (
        <div
          style={{
            padding: "10px 14px",
            background: "#1e1a2a",
            border: "1px solid #4a3a6a",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            color: "#9988CC",
          }}
        >
          Live prices paused. Reconnecting…
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            color: "#f0f0f5",
            fontSize: 24,
            fontWeight: 700,
            margin: "0 0 4px",
          }}
        >
          Active Parlay
        </h1>
        <p style={{ color: "#8888aa", fontSize: 13, margin: 0 }}>
          {activeLegs.length} leg{activeLegs.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Live value card */}
      <div
        style={{
          background: "#1a1a23",
          border: "1px solid #2a2a38",
          borderRadius: 12,
          padding: "20px 20px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, color: "#8888aa", fontWeight: 600 }}>
              LIVE VALUE
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 32,
                fontWeight: 700,
                color: "#f0f0f5",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatDollars(liveValue)}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: "0 0 4px", fontSize: 12, color: "#8888aa", fontWeight: 600 }}>
              P&amp;L
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: pnlPositive ? "#1D9E75" : "#D85A30",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {pnlPositive ? "+" : ""}
              {formatDollars(pnl)}
            </p>
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid #2a2a38",
            marginTop: 14,
            paddingTop: 12,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 12, color: "#8888aa" }}>Entry stake</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f0f5" }}>
            {formatDollars(entryStake)}
          </span>
        </div>
      </div>

      {/* Low liquidity warning */}
      {hasLowLiqLeg && (
        <div
          style={{
            padding: "10px 12px",
            background: "#2a1e0a",
            border: "1px solid #5a3e10",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            color: "#E8A44A",
          }}
        >
          One or more legs has low liquidity. Cash-out value may be significantly reduced.
        </div>
      )}

      {/* Legs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {activeLegs.map((leg, i) => {
          const livePrice = prices.get(leg.assetId);
          const currentBid = livePrice?.bestBid ?? leg.price;
          const currentAsk = livePrice?.bestAsk ?? leg.price;
          const spread = livePrice ? calcSpread(currentAsk, currentBid) : 0;
          const lowLiq = spread > 0.1;

          const statusColors: Record<string, { bg: string; text: string }> = {
            OPEN: { bg: "#1a2e24", text: "#1D9E75" },
            FILLED: { bg: "#1a2450", text: "#7F77DD" },
            CANCELLED: { bg: "#2a1a1a", text: "#D85A30" },
          };
          const sc = statusColors[leg.status] ?? statusColors.OPEN;

          return (
            <div
              key={leg.assetId}
              style={{
                background: "#1a1a23",
                border: "1px solid #2a2a38",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: leg.outcome === "yes" ? "#261e4a" : "#3a1a12",
                      color: leg.outcome === "yes" ? "#7F77DD" : "#D85A30",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {leg.outcome}
                  </span>
                  <span style={{ fontSize: 11, color: "#8888aa" }}>Leg {i + 1}</span>
                  {lowLiq && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: "#3D2E1A",
                        color: "#E8A44A",
                      }}
                    >
                      ⚠ low liq
                    </span>
                  )}
                </div>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: sc.bg,
                    color: sc.text,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {leg.status}
                </span>
              </div>

              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 13,
                  color: "#f0f0f5",
                  lineHeight: 1.4,
                }}
              >
                {leg.market.question}
              </p>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "#8888aa",
                }}
              >
                <div>
                  <span>Entry: </span>
                  <span style={{ color: "#f0f0f5", fontWeight: 700 }}>
                    {formatPrice(leg.price)}
                  </span>
                </div>
                <div>
                  <span>Current bid: </span>
                  <span
                    style={{
                      color: currentBid > leg.price ? "#1D9E75" : currentBid < leg.price ? "#D85A30" : "#f0f0f5",
                      fontWeight: 700,
                    }}
                  >
                    {formatPrice(currentBid)}
                  </span>
                </div>
                <div>
                  <span>Shares: </span>
                  <span style={{ color: "#f0f0f5", fontWeight: 700 }}>
                    {leg.sharesHeld.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cash Out button */}
      <button
        onClick={handleCashOut}
        disabled={isCashingOut || isStale || !walletAddress}
        style={{
          width: "100%",
          padding: "16px 0",
          borderRadius: 12,
          background: isCashingOut || isStale || !walletAddress ? "#2a2a38" : "#1D9E75",
          border: "none",
          color: isCashingOut || isStale || !walletAddress ? "#8888aa" : "#fff",
          fontSize: 16,
          fontWeight: 700,
          cursor: isCashingOut || isStale || !walletAddress ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
        title={isStale ? "Price feed temporarily unavailable — please wait" : undefined}
      >
        {isCashingOut ? "Cashing out…" : `Cash Out ${formatDollars(liveValue)}`}
      </button>

      {isStale && (
        <p
          style={{
            textAlign: "center",
            fontSize: 11,
            color: "#8888aa",
            marginTop: 8,
          }}
        >
          Price feed temporarily unavailable — please wait
        </p>
      )}
    </div>
  );
}
