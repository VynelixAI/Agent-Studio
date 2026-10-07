# Agent Studio by VynelixAI

Desktop workspace for **Data Engineering & AI** teams — Oracle AI Agent Studio–style mental model (workflow agent teams, categorized nodes, tools, testing) with a **data-engineering-first** palette, **YAML-as-source-of-truth**, and **MongoDB** as a first-class connector.

Visual language matches [VynelixAI](https://www.vynelixai.com/) theme tokens exactly:

| | Light | Dark |
|--|--|--|
| Background | `#ffffff` (sharp white, no mesh) | `#05070d` / mesh `#070b16→#060a14` |
| Surface | `#ffffff` · wells `#f8fafc` | `#0b1120` · elevated `#101a30` |
| Text | `#0f172a` · muted `#64748b` | `#e8edf5` · muted `#94a3b8` |
| Primary button | `#0f172a` / text `#f8fafc` | `#22d3ee` / text `#05070d` |
| Accent button | `#06b6d4` / text `#082f33` | `#22d3ee` / text `#05070d` |
| Secondary | `#2563eb` | `#3b82f6` |

Toggle sun/moon in the header; preference is stored in `localStorage` (`vynelix-theme`) and defaults to light.

## Security (USA + India)

See **[SECURITY.md](./SECURITY.md)** for controls aligned to:

- **US:** NIST CSF, SOC 2–aligned practices, CCPA/CPRA readiness  
- **India:** DPDP Act 2023, CERT-In logging, IT Act reasonable security practices  

Includes API-key RBAC, AES-256-GCM secrets, audit logs, residency/purpose metadata, retention purge, Helmet, rate limits, and PII scrubbing on run logs. Machine-readable: `GET /security/policy`.

## Product hierarchy

```
Agentic Application (optional)
  └── Agent Team / Workflow   ← primary unit (deterministic graph preferred)
        ├── Nodes
        ├── Agents (LLM + tools)
        └── Tools / Connectors (MongoDB, REST, files, MCP…)
```

| Mode | Use when |
|------|----------|
| **Workflow Agent Team** (default) | Pipelines, compliance, auditable graphs; AI at specific nodes |
| **Supervisor / Hierarchical** | Open-ended routing to specialist agents + optional sub-workflows |

## Stack

| Layer | Choice |
|-------|--------|
| Desktop | Tauri 2 (preferred) — React UI runs in Vite today; `src-tauri/` ready |
| UI | React 19 + TypeScript strict + Vite + Tailwind 4 + React Flow + Monaco |
| State | Zustand |
| Local cache | Dexie (IndexedDB) — workspaces, offline edit, stage preview |
| Backend | Fastify + MongoDB — workspaces, versioned YAML, encrypted secrets, runs |
| Secrets | AES-256-GCM in MongoDB; YAML only holds `secretRef` |

## Quick start

```bash
# 1) MongoDB
npm run mongo:up          # or: docker compose up -d mongo

# 2) API
cd server && npm install && npm run dev

# 3) Studio UI (another terminal)
npm install
npm run dev
```

Open http://localhost:1420 · API http://localhost:8787/health

### Run on another server / VM

Both processes must be running **on that server**, and MongoDB must be reachable:

```bash
# on the server
npm run mongo:up
cd server && cp .env.example .env && npm install && npm run dev
# other terminal
npm install && npm run dev
```

Then open `http://<server-ip>:1420` from your laptop. The UI auto-targets `http://<server-ip>:8787`.

If you still see **API offline**:

1. Confirm API health: `curl http://<server-ip>:8787/health`
2. In the WS panel, set **API URL** to `http://<server-ip>:8787` and click **Use**
3. Ensure firewall allows ports **1420** and **8787**
4. In `server/.env`, set `CORS_ORIGIN=*` (default in `.env.example`)

### Apply → MongoDB

1. Edit YAML / canvas  
2. Click **Apply** (header) or **Apply to DB** (YAML panel)  
3. Confirm: **Override current** or **Create new version** (or create if new)  
4. Stores document, YAML, attachments metadata, and secrets (encrypted) in MongoDB  

### Run → local folder + logs

1. Workspace must be applied (synced to DB)  
2. Click **Run**  
3. API creates `data/runs/<workspaceId>/<runId>/` with YAML, code copy, secrets (local), and writes `logs/run.log` + per-node logs  
4. Run metadata + log paths stored in MongoDB  
5. The same run also updates the workspace agent folder (below). A disk error there does not fail the run.

### Workspace agent folder

Each workspace also has a folder next to the run artifacts:

```
data/workspaces/<workspaceId>/
  memory.json            latest input and output of every node
  brain.json             Workspace Brain model (mode 0600, API key never returned by the API)
  chat.json              brain conversation
  logs/success.log       lines from succeeded runs
  logs/failure.log       lines from failed runs
  executions/<id>/snapshot.json
```

`executions/` keeps the **last 5** snapshots (graph, node I/O, log excerpt). Older ones are deleted after each run. Writes use a temp file plus rename, and a lock file so two runs cannot corrupt `memory.json`.

The **Brain** panel (header, or Ctrl/Cmd+J) talks to that memory. Pick one model per workspace: Ollama, LM Studio, vLLM, OpenAI, Grok, Claude, Gemini, or OpenRouter. The **Runs** tab in the bottom panel replays those five executions. Empty canvases start with “What do you want this agent to do?” instead of a blank graph.  

## Studio layout

- **Left** — Workspaces (CacheDB) · Node palette (AI / Data / Logic / Control / Communication / Triggers) · Templates
- **Center** — React Flow canvas and/or Monaco YAML (Canvas / Split / YAML)
- **Right** — Inspector (workspace meta, node config, Mongo schema browser stub)
- **Bottom** — Console · validation errors · stage-cache preview

## YAML shape

```yaml
workspace:
  id: ws_...
  name: customer-360
  version: 1.2.0
  mode: workflow   # or supervisor

connectors:
  - id: mongo_prod
    type: mongodb
    mode: atlas    # local | atlas | iaas
    secretRef: secret://mongo_prod

tools: []
agents: []

flow:
  triggers:
    - type: manual
  nodes:
    - id: extract
      category: data
      type: mongodb.read
      connector: mongo_prod
      config: { collection: users }
      outputs: [stage.users]
  edges: []
  error_handlers: []
```

Canvas ↔ YAML stay in sync; editing YAML applies after a short debounce (or **Apply**).

## Templates included

1. **Mongo CDC Pipeline** — change stream → transform → sink + audit  
2. **LLM Enrichment** — scheduled read → LLM → switch → write / Slack  
3. **RAG Ingest** — files → embeddings → Mongo write  

## Roadmap (phased)

1. **Now (this repo)** — Studio shell, node taxonomy, YAML round-trip, validation, dry-run + stage cache simulation, Dexie cache  
2. **Next** — Tauri packaging, FastAPI/Fastify + Mongo system of record, encrypted credential store  
3. **Mongo plugin** — ping, list DBs/collections, sample, find/aggregate/write/change streams → real stage cache  
4. **Runtime** — true executor, step-through debugger, run history / traces, approval nodes  
5. **Plugins** — Postgres, Snowflake, BigQuery, Kafka, S3; MCP / A2A tool surfaces  

## Desktop packaging (Tauri)

See **[src-tauri/DESKTOP.md](./src-tauri/DESKTOP.md)** for exe / msi / dmg / deb / rpm builds.

On first launch the app asks for three things:

1. **Workspace folder** (default `~/AgentStudio`)
2. **Model** — open source (Ollama, LM Studio, vLLM) or licensed (OpenAI, Grok, Claude, Gemini), plus model name, endpoint, and API key
3. **MongoDB** — local or remote, with database name and URI

That writes `<workspace>/AGENT.md` (readable config, no secrets) and `<workspace>/agent-studio.yaml`. The API key is stored in `<workspace>/.studio-secret` (mode 0600). The next launch reads those files and does not ask again. Restart the API after changing the MongoDB URI.

After a test, the canvas offers **Save to database** (the existing Apply flow) and **Convert to template** (the existing Custom templates library).

Each generated node is a tool: `execute`, `__call__`, and `tool_spec()`. `call_tool(node_id, items)` runs one node when you ask. Listing tools does not run them. After a test, **Save to database** and **Convert to template** stay available until you choose one. Neither runs on its own.

```bash
npm run build:desktop   # bundle API into src-tauri/resources/server
npm run tauri:build     # produce platform installers
```

## Project layout

```
src/
  components/   # studio UI
  core/         # node registry, YAML codec, templates, validate
  lib/          # Dexie CacheDB + Tauri desktop helpers
  store/        # Zustand studio store
  types/        # workspace domain types
src-tauri/      # Tauri 2 shell — starts API + UI, desktop config YAML
server/         # Fastify API (Mongo-backed)
```
