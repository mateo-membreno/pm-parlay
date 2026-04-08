import { Router, Request, Response } from "express";
import { getFeaturedMarkets, getAllMarkets } from "../assetCache";
import { PriceFeedWatchdog } from "../watchdog";

export function createMarketsRouter(watchdog: PriceFeedWatchdog): Router {
  const router = Router();

  /**
   * GET /api/markets/featured
   * Returns top 5 featured markets (by volume acceleration / volume)
   */
  router.get("/featured", (_req: Request, res: Response) => {
    const markets = getFeaturedMarkets();

    const enriched = markets.map((m) => {
      const livePrice = watchdog.getPrice(m.assetId);
      return {
        ...m,
        yesPrice: livePrice?.bestAsk ?? m.yesPrice,
        noPrice: livePrice ? parseFloat((1 - livePrice.bestAsk).toFixed(4)) : m.noPrice,
        spread:
          livePrice
            ? parseFloat(((livePrice.bestAsk - livePrice.bestBid) / livePrice.bestAsk).toFixed(4))
            : m.spread,
      };
    });

    res.json(enriched);
  });

  /**
   * GET /api/markets
   * Returns all markets sorted by volume
   */
  router.get("/", (_req: Request, res: Response) => {
    const markets = getAllMarkets();

    const enriched = markets.map((m) => {
      const livePrice = watchdog.getPrice(m.assetId);
      return {
        ...m,
        yesPrice: livePrice?.bestAsk ?? m.yesPrice,
        noPrice: livePrice ? parseFloat((1 - livePrice.bestAsk).toFixed(4)) : m.noPrice,
        spread:
          livePrice
            ? parseFloat(((livePrice.bestAsk - livePrice.bestBid) / livePrice.bestAsk).toFixed(4))
            : m.spread,
      };
    });

    res.json(enriched);
  });

  return router;
}
