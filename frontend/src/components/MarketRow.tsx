import { useState, useCallback } from "react";
import { Market, PriceData } from "../types";
import { useParlayStore } from "../hooks/useParlayStore";
import { formatPrice, formatVolume, calcSpread } from "../utils/parlay";

const CATEGORY_COLORS = {
  Sports: "#7F77DD",
  Politics: "#D85A30",
  Crypto: "#1D9E75",
  Finance: "#639922",
} as const;

interface MarketRowProps {
  market: Market;
  prices: Map<string, PriceData>;
  maxVolume: number;
}

export function MarketRow({ market, prices, maxVolume }: MarketRowProps) {
  const addLeg = useParlayStore((s) => s.addLeg);
  const legs = useParlayStore((s) => s.legs);

  const liveData = prices.get(market.assetId);
  const yesPrice = liveData?.bestAsk ?? market.yesPrice;
  const noPrice = parseFloat((1 - yesPrice).toFixed(4));
  const spread = liveData
    ? calcSpread(liveData.bestAsk, liveData.bestBid)
    : market.spread;

  const isLowLiquidity = spread > 0.1;

  const currentLeg = legs.find((l) => l.market.id === market.id);
  const dotColor = CATEGORY_COLORS[market.category];
  const volumePct = maxVolume > 0 ? (market.volume24h / maxVolume) * 100 : 0;
  const atMax = legs.length >= 5 && !currentLeg;

  const [toast, setToast] = useState(false);

  const showToast = useCallback(() => {
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  }, []);

  function handleYes() {
    if (atMax) { showToast(); return; }
    if (currentLeg?.outcome === "yes") {
      useParlayStore.getState().removeLeg(currentLeg.assetId);
    } else {
      addLeg(market, "yes");
    }
  }

  function handleNo() {
    if (atMax) { showToast(); return; }
    if (currentLeg?.outcome === "no") {
      useParlayStore.getState().removeLeg(currentLeg.assetId);
    } else {
      addLeg(market, "no");
    }
  }

  const yesActive = currentLeg?.outcome === "yes";
  const noActive = currentLeg?.outcome === "no";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
        borderBottom: "1px solid #1e1e28",
        background: currentLeg ? "#1a1a28" : "transparent",
        transition: "background 0.15s",
        position: "relative",
      }}
    >
      {/* Max legs toast */}
      {toast && (
        <div
          style={{
            position: "absolute",
            top: -32,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#2a2a38",
            border: "1px solid #3a3a50",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            color: "#f0f0f5",
            whiteSpace: "nowrap",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          Max 5 legs
        </div>
      )}
      {/* Category dot */}
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />

      {/* Question + volume bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 13,
            color: "#f0f0f5",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {market.question}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 3,
              background: "#2a2a38",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${volumePct}%`,
                height: "100%",
                background: dotColor,
                borderRadius: 2,
                opacity: 0.6,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: "#8888aa",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {formatVolume(market.volume24h)}
          </span>
        </div>
      </div>

      {/* Liquidity badge */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 4,
          background: isLowLiquidity ? "#3D2E1A" : "#1A2E24",
          color: isLowLiquidity ? "#E8A44A" : "#1D9E75",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {isLowLiquidity ? "⚠ low liq" : "liquid"}
      </div>

      {/* Yes / No buttons */}
      <div
        style={{
          display: "flex",
          gap: 4,
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleYes}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid",
            borderColor: yesActive ? "#7F77DD" : "#2a2a38",
            background: yesActive ? "#7F77DD" : "transparent",
            color: yesActive ? "#fff" : "#8888aa",
            fontSize: 12,
            fontWeight: 600,
            cursor: atMax && !yesActive ? "not-allowed" : "pointer",
            opacity: atMax && !yesActive ? 0.4 : 1,
            transition: "all 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          Y {formatPrice(yesPrice)}
        </button>
        <button
          onClick={handleNo}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid",
            borderColor: noActive ? "#D85A30" : "#2a2a38",
            background: noActive ? "#D85A30" : "transparent",
            color: noActive ? "#fff" : "#8888aa",
            fontSize: 12,
            fontWeight: 600,
            cursor: atMax && !noActive ? "not-allowed" : "pointer",
            opacity: atMax && !noActive ? 0.4 : 1,
            transition: "all 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          N {formatPrice(noPrice)}
        </button>
      </div>
    </div>
  );
}
