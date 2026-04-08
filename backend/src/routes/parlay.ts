import { Router, Request, Response } from "express";
import { PriceFeedWatchdog } from "../watchdog";
import { buildAuthHeaders } from "../hmac";

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

interface BatchOrderPayload {
  orders: ClobOrder[];
}

export function createParlayRouter(watchdog: PriceFeedWatchdog): Router {
  const router = Router();

  /**
   * POST /api/parlay/watch
   * Subscribes a list of asset IDs to the price feed watchdog.
   */
  router.post("/watch", (req: Request, res: Response) => {
    const { assetIds } = req.body as { assetIds: string[] };

    if (!Array.isArray(assetIds) || !assetIds.every((id) => typeof id === "string")) {
      return res.status(400).json({ error: "assetIds must be an array of strings" });
    }

    watchdog.subscribe(assetIds);
    console.log(`[parlay/watch] Subscribed to ${assetIds.length} asset(s)`);
    return res.json({ ok: true, subscribed: assetIds.length });
  });

  /**
   * POST /api/parlay/orders
   * Forwards pre-signed EIP-712 orders from the frontend to Polymarket CLOB.
   * Adds HMAC auth headers to the outbound HTTP request.
   */
  router.post("/orders", async (req: Request, res: Response) => {
    const payload = req.body as BatchOrderPayload;

    if (!payload.orders || !Array.isArray(payload.orders)) {
      return res.status(400).json({ error: "Invalid payload: missing orders array" });
    }

    if (payload.orders.length === 0) {
      return res.status(400).json({ error: "Orders array is empty" });
    }

    if (payload.orders.length > 15) {
      return res.status(400).json({ error: "Too many orders: max 15 per batch" });
    }

    const apiUrl = process.env.CLOB_API_URL ?? "https://clob-api.polymarket.com";
    const bodyStr = JSON.stringify(payload);
    const authHeaders = buildAuthHeaders("POST", "/orders", bodyStr);

    // Check if we have real API credentials
    if (!process.env.POLY_API_KEY) {
      console.warn("[parlay/orders] No API key configured — returning mock success response");
      return res.json({
        success: true,
        mock: true,
        orderIds: payload.orders.map((_, i) => `mock-order-${Date.now()}-${i}`),
        message: "Mock order placement (no API key configured)",
      });
    }

    try {
      const response = await fetch(`${apiUrl}/orders`, {
        method: "POST",
        headers: authHeaders,
        body: bodyStr,
      });

      const responseData: unknown = await response.json();

      if (!response.ok) {
        console.error(`[parlay/orders] CLOB API error ${response.status}:`, responseData);
        return res.status(response.status).json({
          error: "Order submission failed",
          detail: responseData,
        });
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[parlay/orders] Network error submitting orders:", err);
      return res.status(502).json({
        error: "Failed to reach Polymarket CLOB",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
