import { Market } from "../types";
import { useParlayStore } from "../hooks/useParlayStore";
import { formatPrice, formatVolume } from "../utils/parlay";

const CATEGORY_COLORS = {
  Sports: { dot: "#7F77DD", bg: "#EEEDFE", text: "#534AB7" },
  Politics: { dot: "#D85A30", bg: "#FAECE7", text: "#993C1D" },
  Crypto: { dot: "#1D9E75", bg: "#E1F5EE", text: "#0F6E56" },
  Finance: { dot: "#639922", bg: "#EAF3DE", text: "#3B6D11" },
} as const;

interface FeaturedCardProps {
  market: Market;
}

export function FeaturedCard({ market }: FeaturedCardProps) {
  const addLeg = useParlayStore((s) => s.addLeg);
  const legs = useParlayStore((s) => s.legs);

  const colors = CATEGORY_COLORS[market.category];
  const isAdded = legs.some((l) => l.market.id === market.id);

  function handleAdd() {
    addLeg(market, "yes");
  }

  return (
    <div
      style={{
        minWidth: 200,
        maxWidth: 220,
        background: "#1a1a23",
        border: isAdded ? "1px solid #7F77DD" : "1px solid #2a2a38",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flexShrink: 0,
        transition: "border-color 0.15s",
      }}
    >
      {/* Category tag */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          width: "fit-content",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colors.dot,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: colors.text,
            whiteSpace: "nowrap",
          }}
        >
          {market.category}
        </span>
      </div>

      {/* Question */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "#f0f0f5",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          flex: 1,
        }}
      >
        {market.question}
      </p>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#7F77DD",
          }}
        >
          {formatPrice(market.yesPrice)}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#8888aa",
          }}
        >
          {formatVolume(market.volume24h)} 24h
        </span>
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        style={{
          padding: "8px 0",
          borderRadius: 8,
          background: isAdded ? "#534AB7" : "#7F77DD",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "background 0.15s",
          width: "100%",
        }}
      >
        {isAdded ? "Added" : "+ Add Yes"}
      </button>
    </div>
  );
}
