import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDesktopConfigFromEnv } from "./desktopConfig.js";

// Tauri / packaged installs: AGENT_STUDIO_CONFIG overrides .env for DB + paths
applyDesktopConfigFromEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeEnv = process.env.NODE_ENV ?? "development";
const desktopApp = process.env.AGENT_STUDIO_DESKTOP === "true";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export type DataResidency = "US" | "IN" | "EU" | "GLOBAL";

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** Bind locally by default; remote deployments must opt in explicitly. */
  apiHost: (process.env.API_HOST ?? "127.0.0.1").trim(),
  desktopApp,
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
  /** Explicit UI origins. Avoid wildcard CORS for local and remote services. */
  corsOrigin: process.env.CORS_ORIGIN ??
    "http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost",

  /** Production remote API defaults to authenticated; desktop is bound to loopback. */
  authRequired: bool(
    process.env.AUTH_REQUIRED,
    nodeEnv === "production" && !desktopApp,
  ),
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

  /** Process execution mode. Local mode is only allowed for loopback development/desktop use. */
  runnerSandbox: (process.env.RUNNER_SANDBOX ?? "local").trim().toLowerCase(),
  runnerDockerImage: (process.env.RUNNER_DOCKER_IMAGE ?? "agent-studio-runner:local").trim(),
  runnerDockerNetwork: (process.env.RUNNER_DOCKER_NETWORK ?? "none").trim(),
  runnerMemoryMb: boundedNumber(process.env.RUNNER_MEMORY_MB, 1024, 256, 8192),
  runnerCpuLimit: boundedNumber(process.env.RUNNER_CPU_LIMIT, 1, 0.25, 8),
  runnerPidsLimit: boundedNumber(process.env.RUNNER_PIDS_LIMIT, 128, 32, 1024),

  /** Reject weak SECRETS_KEY in production */
  nodeEnv,

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
  if (config.secretsKey.toLowerCase().includes("change-me")) {
    warnings.push("SECRETS_KEY must not use a placeholder value");
  }
  if (config.nodeEnv === "production" && !config.desktopApp && !config.authRequired) {
    warnings.push("AUTH_REQUIRED must be enabled for remote production deployments");
  }
  if (!loopbackHosts.has(config.apiHost.toLowerCase()) && config.runnerSandbox !== "docker") {
    warnings.push("Remote API should use RUNNER_SANDBOX=docker to isolate workflow execution");
  }
  if (config.authRequired && !config.apiKeysRaw.trim()) {
    warnings.push("API_KEYS must be configured when AUTH_REQUIRED=true");
  }
  if (config.corsOrigin.trim() === "*") {
    warnings.push("CORS_ORIGIN is wildcard; restrict it to trusted UI origins");
  }
  if (!loopbackHosts.has(config.apiHost.toLowerCase()) && !config.authRequired) {
    warnings.push("Non-loopback API_HOST requires AUTH_REQUIRED=true");
  }
  return warnings;
}

/** Configuration errors that must prevent starting an unsafe network service. */
export function securityConfigErrors(): string[] {
  const errors: string[] = [];
  const isLoopback = loopbackHosts.has(config.apiHost.toLowerCase());
  if (!(["local", "docker"].includes(config.runnerSandbox))) {
    errors.push("RUNNER_SANDBOX must be either local or docker.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(config.runnerDockerImage)) {
    errors.push("RUNNER_DOCKER_IMAGE must be a valid image reference without shell syntax.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(config.runnerDockerNetwork)) {
    errors.push("RUNNER_DOCKER_NETWORK must be a Docker network name (default: none).");
  }
  if (!isLoopback && config.nodeEnv !== "production") {
    errors.push("Network-exposed API requires NODE_ENV=production.");
  }
  if (!isLoopback && config.runnerSandbox !== "docker") {
    errors.push("Network-exposed API requires RUNNER_SANDBOX=docker; unsandboxed workflow execution is not allowed remotely.");
  }
  const keyParts = config.apiKeysRaw.split(",").map((part) => part.trim()).filter(Boolean);
  const validKeyPart = (part: string) => {
    const separator = part.lastIndexOf(":");
    if (separator < 0) return false;
    const key = part.slice(0, separator);
    const role = part.slice(separator + 1);
    return key.length >= 32 && new Set(key).size >= 12 && /^[A-Za-z0-9._-]+$/.test(key) && ["admin", "operator", "viewer"].includes(role);
  };
  const hasKeys = keyParts.length > 0 && keyParts.every(validKeyPart);
  if (keyParts.length > 0 && !hasKeys) {
    errors.push("API_KEYS must contain a non-placeholder random key (at least 32 characters) followed by :admin, :operator, or :viewer.");
  }

  const normalizedSecretsKey = config.secretsKey.trim();
  const invalidSecretsKey =
    normalizedSecretsKey.length < 32 ||
    new Set(normalizedSecretsKey).size < 12 ||
    /change-me|replace-me|your-secret|example-key/i.test(normalizedSecretsKey);
  if (config.nodeEnv === "production" && invalidSecretsKey) {
    errors.push(config.desktopApp
      ? "Desktop secrets key could not be loaded or created, or is a placeholder; refusing to start with an unsafe encryption key."
      : "Production requires a non-placeholder, non-trivial SECRETS_KEY with at least 32 characters.");
  }
  if (config.authRequired && !hasKeys) {
    errors.push("AUTH_REQUIRED=true requires at least one valid API_KEYS entry (key length >=32).");
  }
  if (!isLoopback && (!config.authRequired || !hasKeys)) {
    errors.push("Binding to a non-loopback API_HOST requires AUTH_REQUIRED=true and a valid API_KEYS entry (key length >=32).");
  }
  if (!isLoopback && config.corsOrigin.trim() === "*") {
    errors.push("Wildcard CORS is not allowed for a network-exposed API.");
  }
  if (config.nodeEnv === "production" && !config.desktopApp && !config.authRequired) {
    errors.push("Remote production API requires AUTH_REQUIRED=true.");
  }
  return errors;
}
