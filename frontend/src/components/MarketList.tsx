import { useEffect, useState } from "react";
import { Market, PriceData } from "../types";
import { MarketRow } from "./MarketRow";
import { usePriceSocket } from "../hooks/usePriceSocket";

interface MarketListProps {
  prices: Map<string, PriceData>;
}

export function MarketList({ prices }: MarketListProps) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = usePriceSocket();

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as Market[];
        setMarkets(data);

        // Subscribe all asset IDs to price feed
        const assetIds = data.flatMap((m) => [m.yesAssetId, m.noAssetId]);
        subscribe(assetIds);
      } catch (err) {
        setError("Could not load markets");
        console.error("[MarketList] fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchMarkets();
  }, [subscribe]);

  const maxVolume = Math.max(...markets.map((m) => m.volume24h), 1);

  return (
    <section style={{ padding: "20px 0 0" }}>
      <h2
        style={{
          margin: "0 0 2px",
          fontSize: 16,
          fontWeight: 700,
          color: "#f0f0f5",
          padding: "0 20px",
          letterSpacing: "-0.2px",
        }}
      >
        All Markets
      </h2>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 12,
          color: "#8888aa",
          padding: "0 20px",
        }}
      >
        sorted by volume
      </p>

      {loading && (
        <div style={{ padding: "20px", color: "#8888aa", fontSize: 13 }}>
          Loading markets…
        </div>
      )}

      {error && (
        <div style={{ padding: "20px", color: "#D85A30", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && markets.length === 0 && (
        <div style={{ padding: "20px", color: "#8888aa", fontSize: 13 }}>
          No markets available.
        </div>
      )}

      {!loading && !error && markets.length > 0 && (
        <div>
          {markets.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              prices={prices}
              maxVolume={maxVolume}
            />
          ))}
        </div>
      )}
    </section>
  );
}
