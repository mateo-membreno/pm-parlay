import { useParlayStore } from "../hooks/useParlayStore";

interface FOKFailureModalProps {
  walletAddress: string | null;
}

export function FOKFailureModal({ walletAddress }: FOKFailureModalProps) {
  const state = useParlayStore((s) => s.state);
  const failedLegInfo = useParlayStore((s) => s.failedLegInfo);
  const retryParlay = useParlayStore((s) => s.retryParlay);
  const resetParlay = useParlayStore((s) => s.resetParlay);

  if (state !== "failed") return null;

  async function handleRetry() {
    if (!walletAddress) return;
    await retryParlay(walletAddress);
  }

  function handleEdit() {
    useParlayStore.setState({ state: "building", failedLegInfo: undefined });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#1a1a23",
          border: "1px solid #2a2a38",
          borderRadius: 16,
          padding: 28,
          maxWidth: 400,
          width: "100%",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#3a1a12",
            border: "1px solid #D85A30",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            fontSize: 22,
          }}
        >
          ✗
        </div>

        <h2
          style={{
            color: "#f0f0f5",
            fontSize: 18,
            fontWeight: 700,
            margin: "0 0 10px",
          }}
        >
          Parlay could not be placed
        </h2>

        {failedLegInfo && (
          <div
            style={{
              padding: "12px 14px",
              background: "#12121a",
              border: "1px solid #2a2a38",
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: 12, color: "#8888aa" }}>
              Leg {failedLegInfo.legIndex + 1}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "#f0f0f5", lineHeight: 1.4 }}>
              "{failedLegInfo.question}"
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#D85A30" }}>
              could not fill at the target price.
            </p>
          </div>
        )}

        <div
          style={{
            padding: "10px 14px",
            background: "#1a2e24",
            border: "1px solid #1D9E75",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "#1D9E75", fontWeight: 600 }}>
            No funds were moved.
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8888aa" }}>
            All legs used Fill-or-Kill (FOK) orders. A rejection means no partial fills occurred.
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleRetry}
            disabled={!walletAddress}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 10,
              background: "#7F77DD",
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: walletAddress ? "pointer" : "not-allowed",
              opacity: walletAddress ? 1 : 0.6,
            }}
          >
            Try again
          </button>
          <button
            onClick={handleEdit}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 10,
              background: "transparent",
              border: "1px solid #2a2a38",
              color: "#f0f0f5",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Edit parlay
          </button>
        </div>

        <button
          onClick={resetParlay}
          style={{
            width: "100%",
            marginTop: 10,
            padding: "8px 0",
            background: "none",
            border: "none",
            color: "#8888aa",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel and start over
        </button>
      </div>
    </div>
  );
}