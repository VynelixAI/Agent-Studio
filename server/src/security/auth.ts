import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { Role } from "./types.js";

export interface AuthPrincipal {
  keyId: string;
  role: Role;
}

function hashKey(raw: string): Buffer {
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Parse API_KEYS=key:role,key2:role2 */
export function parseApiKeys(
  raw: string = config.apiKeysRaw,
): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [key, roleRaw] = part.split(":");
    if (!key) continue;
    const role = (roleRaw ?? "operator") as Role;
    if (!["admin", "operator", "viewer"].includes(role)) continue;
    map.set(key, role);
  }
  return map;
}

const keyTable = parseApiKeys();

export function authenticateApiKey(
  headerValue: string | undefined,
): AuthPrincipal | null {
  if (!headerValue) return null;
  const raw = headerValue.replace(/^Bearer\s+/i, "").trim();
  if (!raw) return null;

  const presented = hashKey(raw);
  for (const [key, role] of keyTable.entries()) {
    const expected = hashKey(key);
    if (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    ) {
      return {
        keyId: `key_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
        role,
      };
    }
  }
  return null;
}

export function roleAllows(role: Role, action: "read" | "write" | "admin"): boolean {
  if (action === "read") return true;
  if (action === "write") return role === "admin" || role === "operator";
  return role === "admin";
}

export function generateApiKey(): string {
  return `as_${randomBytes(24).toString("base64url")}`;
}

export function hasConfiguredKeys(): boolean {
  return keyTable.size > 0;
}
