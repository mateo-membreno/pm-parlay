import { useEffect, useState } from "react";
import { Market } from "../types";
import { FeaturedCard } from "./FeaturedCard";

interface FeaturedStripProps {
  onMarketsLoaded?: (markets: Market[]) => void;
}

export function FeaturedStrip({ onMarketsLoaded }: FeaturedStripProps) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFeatured() {
      try {
        const res = await fetch("/api/markets/featured");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as Market[];
        setMarkets(data);
        onMarketsLoaded?.(data);
      } catch (err) {
        setError("Could not load featured markets");
        console.error("[FeaturedStrip] fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchFeatured();
  }, [onMarketsLoaded]);

  return (
    <section style={{ padding: "20px 20px 0" }}>
      <h2
        style={{
          margin: "0 0 14px",
          fontSize: 16,
          fontWeight: 700,
          color: "#f0f0f5",
          letterSpacing: "-0.2px",
        }}
      >
        What's moving today
      </h2>

      {loading && (
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                minWidth: 200,
                height: 160,
                background: "#1a1a23",
                borderRadius: 12,
                border: "1px solid #2a2a38",
                flexShrink: 0,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <p style={{ color: "#D85A30", fontSize: 13, margin: 0 }}>{error}</p>
      )}

      {!loading && !error && (
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 8,
            scrollbarWidth: "none",
          }}
        >
          {markets.map((market) => (
            <FeaturedCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </section>
  );
}
