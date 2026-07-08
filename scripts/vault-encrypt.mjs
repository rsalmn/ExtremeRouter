/**
 * Offline vault encryption helper for maintainers.
 *
 * Produces an AES-256-GCM blob for vaultSeed.js. Requires VAULT_FRAGMENT_A to
 * be set in the env (same hex string the runtime uses to decrypt).
 *
 * Usage:
 *   VAULT_FRAGMENT_A=<64-hex-chars> node scripts/vault-encrypt.mjs "<api-key>"
 *
 *   → prints the hex blob to stdout. Paste it into open-sse/services/vaultSeed.js
 *     under the matching providerId.
 */
import { vaultEncrypt } from "../open-sse/services/credentialVault.js";

const plaintext = process.argv[2];
if (!plaintext) {
  console.error("Usage: VAULT_FRAGMENT_A=<hex> node scripts/vault-encrypt.mjs \"<api-key>\"");
  process.exit(1);
}

try {
  const blob = vaultEncrypt(plaintext);
  console.log(blob);
} catch (err) {
  console.error("Error:", err.message);
  console.error("Did you set VAULT_FRAGMENT_A (64 hex chars) in the env?");
  process.exit(1);
}
