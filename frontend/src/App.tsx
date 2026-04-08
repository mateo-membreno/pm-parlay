import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { TopBar } from "./components/TopBar";
import { FeaturedStrip } from "./components/FeaturedStrip";
import { MarketList } from "./components/MarketList";
import { BetSlip } from "./components/BetSlip";
import { ActiveParlay } from "./components/ActiveParlay";
import { FOKFailureModal } from "./components/FOKFailureModal";
import { useParlayStore } from "./hooks/useParlayStore";
import { usePriceSocket, usePriceSocketStore } from "./hooks/usePriceSocket";

export default function App() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const parlayState = useParlayStore((s) => s.state);

  const isStale = usePriceSocketStore((s) => s.isStale);
  const isConnected = usePriceSocketStore((s) => s.isConnected);

  // Initialize WS connection and get prices
  const { prices } = usePriceSocket();

  const showActiveParlay =
    parlayState === "active" ||
    parlayState === "cashing_out" ||
    parlayState === "closed" ||
    parlayState === "settled";

  // Check already-connected wallet on mount
  useEffect(() => {
    async function checkWallet() {
      if (!window.ethereum) return;
      try {
        const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
        const accounts = await provider.send("eth_accounts", []);
        if (Array.isArray(accounts) && accounts.length > 0) {
          setWalletAddress(accounts[0] as string);
        }
      } catch {
        // ignore
      }
    }
    checkWallet();

    // Listen for account changes
    if (window.ethereum) {
      const eth = window.ethereum as {
        on: (event: string, cb: (accts: string[]) => void) => void;
        removeListener: (event: string, cb: (accts: string[]) => void) => void;
      };
      const handleAccountsChanged = (accounts: string[]) => {
        setWalletAddress(accounts[0] ?? null);
      };
      eth.on("accountsChanged", handleAccountsChanged);
      return () => eth.removeListener("accountsChanged", handleAccountsChanged);
    }
  }, []);

  async function handleConnect() {
    if (!window.ethereum) return;
    try {
      const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
      const accounts = await provider.send("eth_requestAccounts", []);
      setWalletAddress((accounts as string[])[0] ?? null);
    } catch (err) {
      console.error("[App] Wallet connect error:", err);
    }
  }

  function handleDisconnect() {
    setWalletAddress(null);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f0f13",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <TopBar
        walletAddress={walletAddress}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      {/* Stale price banner (homescreen only) */}
      {!showActiveParlay && (isStale || !isConnected) && (
        <div
          style={{
            padding: "10px 20px",
            background: "#1e1a2a",
            borderBottom: "1px solid #4a3a6a",
            fontSize: 13,
            color: "#9988CC",
            textAlign: "center",
          }}
        >
          Live prices paused. Reconnecting…
        </div>
      )}

      {showActiveParlay ? (
        <ActiveParlay walletAddress={walletAddress} />
      ) : (
        <div style={{ paddingBottom: 120 }}>
          <FeaturedStrip />
          <MarketList prices={prices} />
        </div>
      )}

      {!showActiveParlay && (
        <BetSlip walletAddress={walletAddress} onConnectWallet={handleConnect} />
      )}

      <FOKFailureModal walletAddress={walletAddress} />
    </div>
  );
}
