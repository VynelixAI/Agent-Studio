# Agent Studio — desktop packaging

## Install / first launch (Windows, macOS, Linux)

Installers (NSIS/MSI, DMG, deb/rpm) install the app binary. **Configuration is collected on first launch** (Tauri cannot reliably host a full Mongo wizard inside every OS installer UI).

### First-run wizard (required)

When you open Agent Studio the first time you must set:

1. **Workspace path** — where runs / plugins are stored.  
   Default: `~/AgentStudio` (Windows: `%USERPROFILE%\AgentStudio`).
2. **MongoDB deployment**
   - **Local** — `mongodb://127.0.0.1:27017`
   - **Atlas** — `mongodb+srv://…`
   - **IaaS / remote** — self-hosted / VM URI
3. **Database name** + **URI** + **API port**

These are written to an editable YAML file. Edit later and **restart** the app.

### Where `agent-studio.yaml` lives

| Platform | Primary editable config |
|----------|-------------------------|
| Windows | `%ProgramData%\AgentStudio\agent-studio.yaml` |
| Windows (all-users install) | also `%ProgramFiles%\AgentStudio\agent-studio.yaml` when writable |
| macOS | `~/Library/Application Support/AgentStudio/agent-studio.yaml` |
| Linux | `~/.config/AgentStudio/agent-studio.yaml` |

A **mirror** is also kept at `<workspace>/agent-studio.yaml`.

NSIS install mode is **both** (per-user or all-users). Choosing all-users installs under Program Files and the post-install hook creates `Program Files\AgentStudio` + `%ProgramData%\AgentStudio`.

From the **WS** tab: **Edit desktop config (YAML)**.

## Build packages

```bash
npm install
npm install -D @tauri-apps/cli
cd server && npm install && cd ..

npm run build:desktop
npm run tauri:build
```

Artifacts: `src-tauri/target/release/bundle/` (exe/msi, dmg, deb/rpm).

### Target machine requirements

- MongoDB reachable at the URI in `agent-studio.yaml`
- Node.js 20+ on PATH (bundled API runner) — unless you ship a sidecar later

## Config reference

See `src-tauri/resources/agent-studio.yaml.example`.
