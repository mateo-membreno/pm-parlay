import crypto from "crypto";
import { signRequest, buildAuthHeaders } from "../hmac";

const ORIG_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

// ─── signRequest ─────────────────────────────────────────────────────────────

describe("signRequest", () => {
  it("produces the correct HMAC-SHA256 base64 signature", () => {
    const ts = 1700000000;
    const secret = "test-secret";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}POST/orders{"orders":[]}`)
      .digest("base64");

    expect(signRequest("POST", "/orders", '{"orders":[]}', ts, secret)).toBe(expected);
  });

  it("uppercases the HTTP method before hashing (spec §2)", () => {
    const sig1 = signRequest("post", "/orders", "", 1000, "s");
    const sig2 = signRequest("POST", "/orders", "", 1000, "s");
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different timestamps", () => {
    const sig1 = signRequest("POST", "/orders", "", 1000, "s");
    const sig2 = signRequest("POST", "/orders", "", 2000, "s");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different bodies", () => {
    const sig1 = signRequest("POST", "/orders", '{"orders":[]}', 1000, "s");
    const sig2 = signRequest("POST", "/orders", '{"orders":[1]}', 1000, "s");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different paths", () => {
    const sig1 = signRequest("POST", "/orders", "", 1000, "s");
    const sig2 = signRequest("POST", "/heartbeat", "", 1000, "s");
    expect(sig1).not.toBe(sig2);
  });
});

// ─── buildAuthHeaders ────────────────────────────────────────────────────────

describe("buildAuthHeaders", () => {
  beforeEach(() => {
    process.env.POLY_API_KEY = "my-key";
    process.env.POLY_SECRET = "my-secret";
    process.env.POLY_PASSPHRASE = "my-pass";
  });

  it("returns all five required Polymarket headers (spec §2)", () => {
    const headers = buildAuthHeaders("POST", "/orders", "{}");
    expect(headers["POLY-API-KEY"]).toBe("my-key");
    expect(headers["POLY-PASSPHRASE"]).toBe("my-pass");
    expect(headers["POLY-SIGNATURE"]).toBeDefined();
    expect(headers["POLY-TIMESTAMP"]).toBeDefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("POLY-TIMESTAMP is a unix timestamp string", () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = buildAuthHeaders("GET", "/markets", "");
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(headers["POLY-TIMESTAMP"]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("POLY-SIGNATURE is a base64 string", () => {
    const headers = buildAuthHeaders("POST", "/orders", "{}");
    const b64 = /^[A-Za-z0-9+/]+=*$/;
    expect(headers["POLY-SIGNATURE"]).toMatch(b64);
  });

  it("returns only Content-Type when env vars are missing", () => {
    delete process.env.POLY_API_KEY;
    delete process.env.POLY_SECRET;
    delete process.env.POLY_PASSPHRASE;
    const headers = buildAuthHeaders("GET", "/markets", "");
    expect(Object.keys(headers)).toEqual(["Content-Type"]);
  });
});
