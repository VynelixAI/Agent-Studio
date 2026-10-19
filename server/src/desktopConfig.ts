/**
 * Optional desktop YAML config (Tauri / packaged installs).
 * Env AGENT_STUDIO_CONFIG → path to agent-studio.yaml
 * Values populate process.env before the main config object is built.
 */

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

export type DesktopYaml = {
  workspace?: { path?: string };
  backend?: { host?: string; port?: number; api_url?: string };
  database?: { mode?: string; name?: string; uri?: string };
  connectors?: {
    mongodb_default_database?: string;
    notes?: string;
  };
  setup_complete?: boolean;
};

/** Create a stable per-user key for local desktop installs when none is configured.
 * Unix permissions are restricted to the current user. Remote production services must
 * supply SECRETS_KEY explicitly and never use this desktop-only fallback.
 */
function loadOrCreateDesktopSecretsKey(): string {
  const keyDir = path.join(os.homedir(), ".agent-studio");
  const keyPath = path.join(keyDir, "secrets.key");
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });

  try {
    const existing = fs.readFileSync(keyPath, "utf8").trim();
    if (existing.length >= 32) {
      try { fs.chmodSync(keyPath, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
      return existing;
    }
    throw new Error(`Desktop secrets key at ${keyPath} is invalid; back it up and rotate it before continuing.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const generated = randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(keyPath, `${generated}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const saved = fs.readFileSync(keyPath, "utf8").trim();
  if (saved.length < 32) throw new Error(`Could not create a valid desktop secrets key at ${keyPath}.`);
  try { fs.chmodSync(keyPath, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
  return saved;
}

export function applyDesktopConfigFromEnv(): string | null {
  // Provision the per-user encryption key even on first launch, before the user
  // has completed setup and created agent-studio.yaml. Otherwise the production
  // API would refuse to start on a clean desktop install.
  if (process.env.AGENT_STUDIO_DESKTOP === "true" && !process.env.SECRETS_KEY?.trim()) {
    process.env.SECRETS_KEY = loadOrCreateDesktopSecretsKey();
  }

  const fromEnv = process.env.AGENT_STUDIO_CONFIG?.trim();
  const homeYaml = path.join(os.homedir(), "AgentStudio", "agent-studio.yaml");
  const cfgPath = fromEnv && fs.existsSync(fromEnv) ? fromEnv : fs.existsSync(homeYaml) ? homeYaml : "";
  if (!cfgPath) return null;

  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const doc = yaml.load(raw) as DesktopYaml | null;
    if (!doc || typeof doc !== "object") return cfgPath;

    const workspaceRoot =
      (doc.workspace?.path && String(doc.workspace.path).trim()) ||
      path.dirname(cfgPath);

    if (doc.database?.uri) {
      process.env.MONGODB_URI = String(doc.database.uri);
    }
    if (doc.database?.name) {
      process.env.MONGODB_DB = String(doc.database.name);
    }
    if (doc.backend?.port != null) {
      process.env.PORT = String(doc.backend.port);
    }

    // Keep runs/plugins/workspace memory under the chosen workspace
    const runs = path.join(workspaceRoot, "data", "runs");
    const plugins = path.join(workspaceRoot, "data", "plugins");
    process.env.RUNS_ROOT = runs;
    process.env.PLUGINS_ROOT = plugins;
    process.env.LOCAL_WORKSPACES_ROOT = path.join(workspaceRoot, "data", "workspaces");

    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = "production";
    }

    return cfgPath;
  } catch (err) {
    console.error("[desktop-config] failed to load", cfgPath, err);
    return null;
  }
}
