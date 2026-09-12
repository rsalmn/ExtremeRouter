// Xiaomi MiMo custom OAuth — ECDH encrypted-callback flow.
//
// Xiaomi's authorize endpoint encrypts the token payload with an ephemeral
// X25519 key derived against the public key we hand it. The callback then
// carries ?u=<base64url ciphertext> instead of ?code=, so this is NOT the
// generic PKCE pipeline — it needs its own keypair + decrypt step.
//
// Wire format (verified against MiMo Desktop traffic):
//   u = base64url( server_ephemeral_pubkey(32) || iv(12) || ciphertext+gcm_tag )
// Key derivation: SHA256( X25519(my_private, server_ephemeral) ) → AES-256-GCM key.
// Plaintext is JSON: { uid, sk, url }.
import crypto from "node:crypto";

const KN = "mimocode";
const AUTHORIZE_URL = "https://platform.xiaomimimo.com/authorize";

/** Generate an X25519 keypair for one login attempt. */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return {
    // Raw 32-byte forms — what the wire format needs.
    publicKey: publicKey.export({ type: "spki", format: "der" }).subarray(-32),
    privateKeyDer: privateKey.export({ type: "pkcs8", format: "der" }),
  };
}

/** The key-name tag Xiaomi associates with this client. */
export function getKeyName() {
  return KN;
}

/**
 * Build the browser authorize URL.
 * @param {Buffer} publicKey - raw 32-byte X25519 public key
 * @param {string} redirectUri - loopback callback URL
 * @param {string} keyName - client tag (kn)
 */
export function buildAuthorizeUrl(publicKey, redirectUri, keyName = KN) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("public_key", Buffer.from(publicKey).toString("base64url"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("kn", keyName);
  return url.toString();
}

/**
 * Decrypt a callback `u` payload into { uid, sk, url }.
 * Returns null on any malformed/undecryptable input — never throws.
 *
 * @param {string} encrypted - base64url payload from the ?u= param
 * @param {Buffer|Uint8Array} privateKeyDer - PKCS#8 private key from generateKeyPair
 */
export function decryptCallback(encrypted, privateKeyDer) {
  if (!encrypted || !privateKeyDer) return null;
  let raw;
  try {
    raw = Buffer.from(String(encrypted), "base64url");
  } catch {
    return null;
  }
  // Layout: server_pubkey(32) || iv(12) || ciphertext+tag(>=17)
  if (raw.length < 32 + 12 + 17) return null;
  const serverPub = raw.subarray(0, 32);
  const iv = raw.subarray(32, 44);
  const ciphertext = raw.subarray(44);

  try {
    const priv = crypto.createPrivateKey({ key: Buffer.from(privateKeyDer), format: "der", type: "pkcs8" });
    const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), serverPub]), format: "der", type: "spki" });
    const shared = crypto.diffieHellman({ privateKey: priv, publicKey: pub });
    const aesKey = crypto.createHash("sha256").update(shared).digest();

    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");

    const parsed = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") return null;
    // Normalise to the shape the exchange route persists.
    return {
      uid: parsed.uid || parsed.userId || null,
      sk: parsed.sk || parsed.accessToken || parsed.token || null,
      url: parsed.url || parsed.baseUrl || null,
    };
  } catch {
    return null;
  }
}
