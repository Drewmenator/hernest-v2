// ─── AES-256-GCM secret encryption ─────────────────────────────────
// Key: CREDENTIALS_ENCRYPTION_KEY env var — 64 hex chars (32 bytes).
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
import crypto from "crypto";

function getKey() {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("CREDENTIALS_ENCRYPTION_KEY missing or not 64 hex chars");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  // Legacy: pre-encryption values were plain base64
  if (!stored.startsWith("enc:v1:")) {
    return Buffer.from(stored, "base64").toString("utf-8");
  }
  const [, , ivB64, tagB64, dataB64] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
