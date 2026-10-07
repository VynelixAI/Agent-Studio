/**
 * Optional desktop YAML config (Tauri / packaged installs).
 * Env AGENT_STUDIO_CONFIG → path to agent-studio.yaml
 * Values populate process.env before the main config object is built.
 */

import fs from "node:fs";
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

export function applyDesktopConfigFromEnv(): string | null {
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
