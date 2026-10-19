import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

function keyBytes(secretKey = config.secretsKey): Buffer {
  return createHash("sha256").update(secretKey, "utf8").digest();
}

export function encryptSecret(plaintext: string): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptWithKey(payload: { ciphertext: string; iv: string; tag: string }, key: Buffer): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function decryptSecret(payload: {
  ciphertext: string;
  iv: string;
  tag: string;
}): string {
  try {
    return decryptWithKey(payload, keyBytes());
  } catch (error) {
    // Backward compatibility for desktop installs that encrypted secrets before a
    // persistent SECRETS_KEY was provisioned. New writes always use the persistent key.
    // Existing legacy values should be re-saved to migrate them to the stronger key.
    if (config.desktopApp && config.secretsKey.length >= 32) {
      try {
        return decryptWithKey(payload, keyBytes(""));
      } catch {
        // Preserve the original authentication/decryption error.
      }
    }
    throw error;
  }
}
