import { ethers } from "ethers";

interface TopBarProps {
  walletAddress: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TopBar({ walletAddress, onConnect, onDisconnect }: TopBarProps) {
  const hasEthereum = typeof window !== "undefined" && !!window.ethereum;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "#0f0f13",
        borderBottom: "1px solid #2a2a38",
        padding: "0 20px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(135deg, #7F77DD 0%, #5B54B5 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          P
        </div>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#f0f0f5",
            letterSpacing: "-0.3px",
          }}
        >
          PM Parlay
        </span>
      </div>

      {/* Wallet pill */}
      <div>
        {!hasEthereum ? (
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: "#1a1a23",
              border: "1px solid #2a2a38",
              color: "#8888aa",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Install MetaMask
          </a>
        ) : walletAddress ? (
          <button
            onClick={onDisconnect}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: "#1a1a23",
              border: "1px solid #2a2a38",
              color: "#7F77DD",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#1D9E75",
                display: "inline-block",
              }}
            />
            {truncateAddress(walletAddress)}
          </button>
        ) : (
          <button
            onClick={onConnect}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: "#7F77DD",
              border: "none",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}

// Export a hook for connecting wallet
export async function connectWallet(): Promise<string | null> {
  if (!window.ethereum) return null;
  try {
    const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
    const accounts = await provider.send("eth_requestAccounts", []);
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}
