import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDesktopConfigFromEnv } from "./desktopConfig.js";

// Tauri / packaged installs: AGENT_STUDIO_CONFIG overrides .env for DB + paths
applyDesktopConfigFromEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export type DataResidency = "US" | "IN" | "EU" | "GLOBAL";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017",
  mongoDb: process.env.MONGODB_DB ?? "vynelix_agent_studio",
  secretsKey: process.env.SECRETS_KEY ?? "",
  /** Per-workspace memory, logs, and the last 5 execution snapshots. */
  localWorkspacesRoot: (() => {
    const raw = process.env.LOCAL_WORKSPACES_ROOT;
    if (raw && path.isAbsolute(raw)) return path.resolve(raw);
    if (raw) return path.resolve(__dirname, "..", raw);
    return path.resolve(__dirname, "..", "../data/workspaces");
  })(),
  runsRoot: (() => {
    const raw = process.env.RUNS_ROOT;
    if (raw && path.isAbsolute(raw)) return path.resolve(raw);
    if (raw) return path.resolve(__dirname, "..", raw);
    return path.resolve(__dirname, "..", "../data/runs");
  })(),
  pluginsRoot: (() => {
    const raw = process.env.PLUGINS_ROOT;
    if (raw && path.isAbsolute(raw)) return path.resolve(raw);
    if (raw) return path.resolve(__dirname, "..", raw);
    return path.resolve(__dirname, "..", "../data/plugins");
  })(),
  /**
   * CORS: empty / `*` → reflect request origin (works on remote hosts).
   * Or comma-separated list: http://localhost:1420,http://10.0.0.5:1420
   */
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  /** When true, all mutating + data routes require X-API-Key */
  authRequired: bool(process.env.AUTH_REQUIRED, false),
  /**
   * Comma-separated API keys. Format: key:role
   * Roles: admin | operator | viewer
   * Example: as_live_xxx:admin,as_ops_yyy:operator
   */
  apiKeysRaw: process.env.API_KEYS ?? "",

  /** Default data residency for new workspaces / runs */
  dataResidency: (process.env.DATA_RESIDENCY ?? "IN") as DataResidency,

  /** Retain run artifacts & audit logs (days) — US retention + India DPDP storage limitation */
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 365),
  runRetentionDays: Number(process.env.RUN_RETENTION_DAYS ?? 90),

  /** Reject weak SECRETS_KEY in production */
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** Rate limit */
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),

  /** Organization / fiduciary contact for DPDP notices */
  privacyContact: process.env.PRIVACY_CONTACT ?? "privacy@vynelixai.com",
  securityContact: process.env.SECURITY_CONTACT ?? "security@vynelixai.com",
};

export function assertSecurityConfig(): string[] {
  const warnings: string[] = [];
  if (config.secretsKey.length < 32) {
    warnings.push("SECRETS_KEY should be at least 32 characters");
  }
  if (
    config.nodeEnv === "production" &&
    config.secretsKey.includes("change-me")
  ) {
    warnings.push("SECRETS_KEY must be rotated before production");
  }
  if (config.nodeEnv === "production" && !config.authRequired) {
    warnings.push("AUTH_REQUIRED should be true in production");
  }
  if (config.nodeEnv === "production" && !config.apiKeysRaw) {
    warnings.push("API_KEYS must be configured when AUTH_REQUIRED=true");
  }
  return warnings;
}
