/**
 * Tests for GET /api/proxy-wallet/:address (spec §1)
 *
 * Key behaviors:
 * - Validates Ethereum address format
 * - Resolves Polymarket Proxy Wallet (Gnosis Safe) from Gamma API
 * - Falls back to data API if Gamma fails
 * - Returns EOA with resolved:false if both APIs fail
 *   (spec §1: using EOA as funder causes order rejection)
 */

import express from "express";
import request from "supertest";
import { createWalletRouter } from "../../routes/wallet";

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => {
  mockFetch.mockReset();
});

const VALID_EOA = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const PROXY_WALLET = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/proxy-wallet", createWalletRouter());
  return app;
}

describe("GET /api/proxy-wallet/:address — address validation (spec §1)", () => {
  it("returns 400 for a non-hex address", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/proxy-wallet/not-an-address");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for an address that is too short", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/proxy-wallet/0x1234");
    expect(res.status).toBe(400);
  });

  it("accepts a valid 42-char checksummed address", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const app = makeApp();
    const res = await request(app).get(`/api/proxy-wallet/${VALID_EOA}`);
    expect(res.status).toBe(200); // resolves (possibly with fallback)
  });
});

describe("GET /api/proxy-wallet/:address — resolution (spec §1)", () => {
  it("returns proxyWallet from Gamma API with resolved:true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ proxyWallet: PROXY_WALLET }),
    });
    const app = makeApp();
    const res = await request(app).get(`/api/proxy-wallet/${VALID_EOA}`);
    expect(res.status).toBe(200);
    expect(res.body.proxyWallet).toBe(PROXY_WALLET);
    expect(res.body.resolved).toBe(true);
  });

  it("falls back to data API when Gamma fails", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false }) // Gamma fails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ proxyWallet: PROXY_WALLET }),
      }); // data API succeeds
    const app = makeApp();
    const res = await request(app).get(`/api/proxy-wallet/${VALID_EOA}`);
    expect(res.body.proxyWallet).toBe(PROXY_WALLET);
    expect(res.body.resolved).toBe(true);
  });

  it("returns EOA with resolved:false when both APIs fail (spec §1 warning)", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const app = makeApp();
    const res = await request(app).get(`/api/proxy-wallet/${VALID_EOA}`);
    expect(res.status).toBe(200);
    expect(res.body.proxyWallet).toBe(VALID_EOA); // falls back to EOA
    expect(res.body.resolved).toBe(false);
  });

  it("returns EOA with resolved:false when both APIs throw network errors", async () => {
    mockFetch.mockRejectedValue(new Error("timeout"));
    const app = makeApp();
    const res = await request(app).get(`/api/proxy-wallet/${VALID_EOA}`);
    expect(res.body.resolved).toBe(false);
    expect(res.body.proxyWallet).toBe(VALID_EOA);
  });
});
