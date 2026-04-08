import { Router, Request, Response } from "express";
import { PriceFeedWatchdog } from "../watchdog";

export function createPriceRouter(watchdog: PriceFeedWatchdog): Router {
  const router = Router();

  /**
   * GET /api/price/:assetId
   * Returns { bestAsk, bestBid, updatedAt } or 503 if stale/missing
   */
  router.get("/:assetId", (req: Request, res: Response) => {
    const { assetId } = req.params;
    const price = watchdog.getPrice(assetId);

    if (!price) {
      return res.status(503).json({ error: "Price not available. Market may not be subscribed." });
    }

    if (watchdog.isStale(assetId)) {
      return res.status(503).json({ error: "Price data is stale.", ...price });
    }

    return res.json({
      assetId,
      bestAsk: price.bestAsk,
      bestBid: price.bestBid,
      updatedAt: price.updatedAt,
    });
  });

  /**
   * GET /api/prices?assetIds[]=...&assetIds[]=...
   * Returns map of assetId -> { bestAsk, bestBid, updatedAt, stale }
   */
  router.get("/", (req: Request, res: Response) => {
    const rawIds = req.query["assetIds"];

    let assetIds: string[] = [];
    if (Array.isArray(rawIds)) {
      assetIds = rawIds.map(String);
    } else if (typeof rawIds === "string") {
      assetIds = [rawIds];
    }

    if (!assetIds.length) {
      // Return all known prices
      const allPrices: Record<string, object> = {};
      for (const id of watchdog.getSubscribedAssets()) {
        const price = watchdog.getPrice(id);
        if (price) {
          allPrices[id] = {
            bestAsk: price.bestAsk,
            bestBid: price.bestBid,
            updatedAt: price.updatedAt,
            stale: watchdog.isStale(id),
          };
        }
      }
      return res.json(allPrices);
    }

    const result: Record<string, object> = {};
    for (const id of assetIds) {
      const price = watchdog.getPrice(id);
      if (price) {
        result[id] = {
          bestAsk: price.bestAsk,
          bestBid: price.bestBid,
          updatedAt: price.updatedAt,
          stale: watchdog.isStale(id),
        };
      } else {
        result[id] = { error: "Not available" };
      }
    }

    return res.json(result);
  });

  return router;
}
