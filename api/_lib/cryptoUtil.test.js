import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./cryptoUtil.js";

beforeAll(() => {
  // 64 hex chars = 32 bytes
  process.env.CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
});

describe("cryptoUtil", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("xxxx-yyyy-zzzz-wwww");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("xxxx-yyyy-zzzz-wwww");
    expect(decryptSecret(stored)).toBe("xxxx-yyyy-zzzz-wwww");
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("decrypts legacy base64 values", () => {
    const legacy = Buffer.from("old-password").toString("base64");
    expect(decryptSecret(legacy)).toBe("old-password");
  });

  it("returns null for empty input", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("throws on tampered ciphertext", () => {
    const stored = encryptSecret("secret");
    const parts = stored.split(":");
    parts[4] = Buffer.from("tampered-data").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("throws when key is missing", () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
  });
});
