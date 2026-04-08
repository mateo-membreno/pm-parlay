import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * Signs an HTTP request using HMAC-SHA256 per Polymarket's auth spec.
 *
 * The message format is: `{timestamp}{METHOD}{path}{body}`
 */
export function signRequest(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  apiSecret: string
): string {
  const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("base64");
}

/**
 * Builds the full set of Polymarket HMAC auth headers for an outbound request.
 * Uses env vars POLY_API_KEY, POLY_SECRET, POLY_PASSPHRASE.
 */
export function buildAuthHeaders(
  method: string,
  path: string,
  body: string
): Record<string, string> {
  const apiKey = process.env.POLY_API_KEY;
  const secret = process.env.POLY_SECRET;
  const passphrase = process.env.POLY_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    console.warn("[hmac] Missing Polymarket API credentials in env vars. Requests may fail.");
    return {
      "Content-Type": "application/json",
    };
  }

  const ts = Math.floor(Date.now() / 1000);
  const signature = signRequest(method, path, body, ts, secret);

  return {
    "POLY-API-KEY": apiKey,
    "POLY-SIGNATURE": signature,
    "POLY-TIMESTAMP": String(ts),
    "POLY-PASSPHRASE": passphrase,
    "Content-Type": "application/json",
  };
}
