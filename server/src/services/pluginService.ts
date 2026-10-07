/**
 * Materialize loosely coupled plugin packages under data/plugins/<id>.
 * Packages include verify scripts, node templates, and remote-runnable runners.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface PluginInstallNode {
  type: string;
  label: string;
  description: string;
  kind?: string;
}

export interface PluginInstallRequest {
  pluginId: string;
  name: string;
  vendor?: string;
  category?: string;
  connectorType: string;
  accent?: string;
  badge?: string;
  description?: string;
  nodes: PluginInstallNode[];
  /** Optional connector field keys for verify template */
  configKeys?: string[];
}

export interface PluginInstallResult {
  pluginId: string;
  localPath: string;
  files: string[];
  nodesUnlocked: string[];
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function pluginsRoot(): string {
  return path.resolve(config.pluginsRoot);
}

export async function listInstalledPlugins(): Promise<
  Array<{ pluginId: string; localPath: string; manifest?: Record<string, unknown> }>
> {
  const root = pluginsRoot();
  try {
    await fs.mkdir(root, { recursive: true });
    const entries = await fs.readdir(root, { withFileTypes: true });
    const items = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const localPath = path.join(root, e.name);
      let manifest: Record<string, unknown> | undefined;
      try {
        const raw = await fs.readFile(path.join(localPath, "plugin.json"), "utf8");
        manifest = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* missing */
      }
      items.push({ pluginId: e.name, localPath, manifest });
    }
    return items;
  } catch {
    return [];
  }
}

export async function uninstallPlugin(pluginId: string): Promise<boolean> {
  const dir = path.join(pluginsRoot(), safeId(pluginId));
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function installPluginPackage(
  req: PluginInstallRequest,
): Promise<PluginInstallResult> {
  const id = safeId(req.pluginId);
  const root = path.join(pluginsRoot(), id);
  const files: string[] = [];

  const write = async (rel: string, content: string) => {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    files.push(rel);
  };

  const manifest = {
    id,
    name: req.name,
    vendor: req.vendor ?? "",
    category: req.category ?? "custom",
    connectorType: req.connectorType,
    accent: req.accent,
    badge: req.badge,
    description: req.description,
    nodes: req.nodes,
    installedAt: new Date().toISOString(),
    version: "1.0.0",
    packageLayout: [
      "plugin.json",
      "README.md",
      "verify.py",
      "verify.sh",
      "templates/",
      "runners/",
      "workflows/",
    ],
  };

  await write("plugin.json", JSON.stringify(manifest, null, 2) + "\n");

  await write(
    "README.md",
    `# ${req.name} plugin

Vendor: ${req.vendor ?? "—"}  
Connector type: \`${req.connectorType}\`  
Installed: ${manifest.installedAt}

## Layout

| Path | Purpose |
|------|---------|
| \`verify.py\` / \`verify.sh\` | Connectivity check using connector config / secrets |
| \`templates/\` | Per-node payload templates passed into workflows |
| \`runners/run_node.py\` | Callable entry for a single node (copy to remote & run) |
| \`runners/remote_bootstrap.sh\` | Bootstrap deps on a remote worker |
| \`workflows/smoke.yaml\` | Minimal smoke workflow using unlocked nodes |

## Unlocked nodes (${req.nodes.length})

${req.nodes.map((n) => `- \`${n.type}\` — ${n.label}: ${n.description}`).join("\n")}

## Remote usage

\`\`\`bash
# on remote host
./runners/remote_bootstrap.sh
export VYNELIX_PLUGIN_CONFIG=/path/to/connector.json
export VYNELIX_SECRETS=/path/to/secrets.json
python3 runners/run_node.py --node ${req.nodes[0]?.type ?? id + ".query"} --config templates/${(req.nodes[0]?.type ?? "node").replace(/\./g, "_")}.json
\`\`\`

Loosely coupled: uninstall removes this directory; Studio palette hides these nodes.
`,
  );

  await write(
    "verify.py",
    `#!/usr/bin/env python3
"""Verify ${req.name} connector — run locally or on a remote worker."""
from __future__ import annotations
import json, os, sys, urllib.request

CONFIG = os.environ.get("VYNELIX_PLUGIN_CONFIG", "connector.example.json")
SECRETS = os.environ.get("VYNELIX_SECRETS", "")

def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def main() -> int:
    cfg = load_json(CONFIG) if os.path.exists(CONFIG) else {}
    secrets = load_json(SECRETS) if SECRETS and os.path.exists(SECRETS) else {}
    print(f"[verify] plugin=${id} connector=${req.connectorType}")
    print(f"[verify] config keys: {sorted(cfg.keys())}")
    print(f"[verify] secret keys: {sorted(secrets.keys())}")
    # Product-specific ping hooks go here (driver import / HTTP health).
    missing = [k for k in ${JSON.stringify(req.configKeys?.slice(0, 6) ?? ["host", "database"])} if k not in cfg and k not in secrets]
    if missing:
        print(f"[verify] WARN optional keys missing: {missing}")
    print("[verify] OK — package materialised; wire real driver ping in CI.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
`,
  );

  await write(
    "verify.sh",
    `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 verify.py "$@"
`,
  );

  await write(
    "connector.example.json",
    JSON.stringify(
      {
        connectorType: req.connectorType,
        label: `${req.name} example`,
        config: Object.fromEntries(
          (req.configKeys ?? ["host", "database"]).map((k) => [k, `<${k}>`]),
        ),
        secretRef: `secret://${id}_example`,
      },
      null,
      2,
    ) + "\n",
  );

  for (const node of req.nodes) {
    const file = `templates/${node.type.replace(/\./g, "_")}.json`;
    await write(
      file,
      JSON.stringify(
        {
          nodeType: node.type,
          label: node.label,
          kind: node.kind ?? "query",
          description: node.description,
          input: {
            stages: [],
            target: "<database.table|collection|topic|path>",
          },
          processing: {
            query: "<SQL | filter | DSL>",
            mode: "insert",
          },
          output: {
            stage: `stage.${node.type.replace(/\./g, "_")}`,
            format: "json",
          },
          remote: {
            entrypoint: "runners/run_node.py",
            copy: ["runners/", "templates/", "verify.py", "plugin.json"],
          },
        },
        null,
        2,
      ) + "\n",
    );
  }

  await write(
    "runners/run_node.py",
    `#!/usr/bin/env python3
"""
Generic remote-callable runner for ${req.name} plugin nodes.
Copy this package to a worker and invoke:

  python3 runners/run_node.py --node <type> --config templates/<type>.json
"""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def run_node(node_type: str, cfg: dict) -> dict:
    started = time.time()
    # Dispatch table — replace stubs with real client calls.
    result = {
        "plugin": "${id}",
        "node": node_type,
        "status": "ok",
        "input": cfg.get("input"),
        "processing": cfg.get("processing"),
        "output": cfg.get("output"),
        "rows": [],
        "message": "Stub execution — implement driver for ${req.connectorType}",
        "durationMs": int((time.time() - started) * 1000),
    }
    out_stage = (cfg.get("output") or {}).get("stage")
    if out_stage:
        result["stageKey"] = out_stage
    return result

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--node", required=True, help="Node type e.g. ${req.nodes[0]?.type ?? "plugin.query"}")
    p.add_argument("--config", required=True, help="Path to node template JSON")
    p.add_argument("--out", default="-", help="Write result JSON to file or stdout")
    args = p.parse_args()
    cfg_path = Path(args.config)
    if not cfg_path.is_file():
        cfg_path = ROOT / args.config
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    result = run_node(args.node, cfg)
    text = json.dumps(result, indent=2)
    if args.out == "-":
        print(text)
    else:
        Path(args.out).write_text(text + "\\n", encoding="utf-8")
    return 0 if result.get("status") == "ok" else 1

if __name__ == "__main__":
    sys.exit(main())
`,
  );

  await write(
    "runners/remote_bootstrap.sh",
    `#!/usr/bin/env bash
# Bootstrap ${req.name} plugin package on a remote machine
set -euo pipefail
echo "Bootstrapping plugin ${id} (${req.connectorType})"
python3 -m pip install --upgrade pip
# Add product drivers here, e.g. pymongo, psycopg, snowflake-connector-python
echo "OK — add driver deps for ${req.connectorType} in requirements.txt"
chmod +x verify.sh runners/run_node.py 2>/dev/null || true
`,
  );

  await write(
    "requirements.txt",
    `# ${req.name} remote worker deps — pin in production
# Add: pymongo / psycopg[binary] / snowflake-connector-python / etc.
`,
  );

  const smokeNodes = req.nodes.slice(0, 3);
  await write(
    "workflows/smoke.yaml",
    `# Smoke workflow for ${req.name} — copy into Agent Studio or remote orchestrator
workspace:
  name: ${id}-smoke
  version: "0.1.0"
  mode: workflow
connectors:
  - id: ${id}_conn
    type: ${req.connectorType}
    secretRef: secret://${id}_conn
flow:
  triggers:
    - type: manual
  nodes:
    - id: start
      type: trigger.manual
      label: Manual Run
${smokeNodes
  .map(
    (n, i) => `    - id: step_${i + 1}
      type: ${n.type}
      label: ${n.label}
      connector: ${id}_conn
      config:
        $ref: ../templates/${n.type.replace(/\./g, "_")}.json
`,
  )
  .join("")}    - id: notify_ok
      type: notify.email
      label: Email success
      config:
        subject: "[OK] ${req.name} smoke"
        bodyTemplate: "Smoke finished for ${id}"
  edges:
    - { id: e0, source: start, target: step_1 }
${smokeNodes
  .slice(0, -1)
  .map(
    (_, i) =>
      `    - { id: e${i + 1}, source: step_${i + 1}, target: step_${i + 2} }`,
  )
  .join("\n")}
    - { id: e_mail, source: step_${smokeNodes.length || 1}, target: notify_ok }
`,
  );

  await write(
    "workflows/remote_call.example.sh",
    `#!/usr/bin/env bash
# Example: rsync package + run a node on remote host
set -euo pipefail
REMOTE="\${REMOTE_HOST:?set REMOTE_HOST}"
REMOTE_DIR="\${REMOTE_DIR:-/opt/vynelix/plugins/${id}}"
rsync -az --delete "$(dirname "$0")/.." "\$REMOTE:\$REMOTE_DIR/"
ssh "\$REMOTE" "cd \$REMOTE_DIR && ./runners/remote_bootstrap.sh && \\
  VYNELIX_PLUGIN_CONFIG=connector.example.json python3 runners/run_node.py \\
  --node ${req.nodes[0]?.type ?? id + ".query"} \\
  --config templates/${(req.nodes[0]?.type ?? "node").replace(/\./g, "_")}.json"
`,
  );

  return {
    pluginId: id,
    localPath: root,
    files,
    nodesUnlocked: req.nodes.map((n) => n.type),
  };
}
