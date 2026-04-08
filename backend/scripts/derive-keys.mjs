/**
 * One-time script to derive Polymarket API credentials from a wallet private key.
 * Run: PRIVATE_KEY=0x... node scripts/derive-keys.mjs
 *
 * This will print your credentials AND update backend/.env automatically.
 */
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env");

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error("Usage: PRIVATE_KEY=0x... node scripts/derive-keys.mjs");
  process.exit(1);
}

console.log("Deriving API credentials from wallet...");

const wallet = new Wallet(privateKey);
const client = new ClobClient(
  "https://clob.polymarket.com",
  137,
  wallet
);

const credentials = await client.createOrDeriveApiKey();

console.log("\nCredentials derived:");
console.log("  POLY_API_KEY:    ", credentials.apiKey);
console.log("  POLY_SECRET:     ", credentials.secret);
console.log("  POLY_PASSPHRASE: ", credentials.passphrase);

// Update .env file
let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

const updates = {
  POLY_API_KEY: credentials.apiKey,
  POLY_SECRET: credentials.secret,
  POLY_PASSPHRASE: credentials.passphrase,
};

for (const [key, value] of Object.entries(updates)) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    envContent += `\n${key}=${value}`;
  }
}

writeFileSync(envPath, envContent.trimStart());
console.log("\n.env updated with your credentials.");
