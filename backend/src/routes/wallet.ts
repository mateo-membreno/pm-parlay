import { Router, Request, Response } from "express";

/**
 * GET /api/proxy-wallet/:address
 *
 * Resolves the Polymarket Proxy Wallet (Gnosis Safe) for a given EOA.
 * Per the spec: the `funder` field in every order MUST be the Proxy Wallet,
 * not the EOA — using the EOA causes order rejection.
 *
 * Resolution strategy:
 *   1. Try the Polymarket Gamma API (public, no auth required)
 *   2. Fall back to the CLOB profiles endpoint
 *   3. Last resort: return the EOA itself (order will likely fail on-chain
 *      but at least the request reaches the CLOB for a cleaner error)
 */

interface GammaProfile {
  address?: string;
  proxyWallet?: string;
  polymarketProxy?: string;
  username?: string;
}

async function resolveViaGamma(address: string): Promise<string | null> {
  try {
    const url = `https://gamma-api.polymarket.com/profile?address=${address}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json() as GammaProfile;
    return data.proxyWallet ?? data.polymarketProxy ?? null;
  } catch {
    return null;
  }
}

async function resolveViaDataApi(address: string): Promise<string | null> {
  try {
    const url = `https://data-api.polymarket.com/profile?address=${address}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json() as GammaProfile;
    return data.proxyWallet ?? data.polymarketProxy ?? null;
  } catch {
    return null;
  }
}

export function createWalletRouter(): Router {
  const router = Router();

  router.get("/:address", async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    // Try Gamma API first, then data API
    let proxyWallet = await resolveViaGamma(address);
    if (!proxyWallet) {
      proxyWallet = await resolveViaDataApi(address);
    }

    if (proxyWallet) {
      console.log(`[wallet] Resolved proxy wallet for ${address}: ${proxyWallet}`);
      return res.json({ proxyWallet, resolved: true });
    }

    // Fallback: return EOA with a warning flag
    console.warn(
      `[wallet] Could not resolve proxy wallet for ${address} — falling back to EOA. ` +
      `Orders placed with funder=EOA may be rejected by Polymarket.`
    );
    return res.json({ proxyWallet: address, resolved: false });
  });

  return router;
}
