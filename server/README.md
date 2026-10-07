# Agent Studio API

Fastify + MongoDB system of record for workspaces, versioned YAML, encrypted secrets, and local run materialization.

## Quick start

```bash
# from repo root — start MongoDB
docker compose up -d mongo

cd server
cp .env.example .env   # if needed
npm install
npm run dev
```

API: http://localhost:8787 · Health: http://localhost:8787/health

## Apply semantics

`POST /workspaces/:id/apply` with `mode`:

| mode | Behavior |
|------|----------|
| `override` | Updates current workspace document/YAML in DB and writes a new **patch** version snapshot |
| `new_version` | Creates a **minor** version bump and keeps full history in `workspace_versions` |

The UI asks for confirmation before either action.

## Runs (local materialization)

`POST /workspaces/:id/runs` with body `{ "runtime": "python" | "notebook" }` will:

1. Load workspace + decrypt secrets from MongoDB  
2. Create `data/runs/<workspaceId>/<runId>/` on the API host  
3. Write:
   - `workspace.yaml` — studio source of truth  
   - `tasks.yaml` — ordered tasks, connectors, secret refs  
   - `secrets.local.yaml` — decrypted secrets for this run only  
   - `code/run_workflow.py` — **step-by-step Python** executor  
   - `notebooks/data_cleanup.ipynb` — Jupyter for data processing / cleanup  
   - `logs/run.log` + `logs/nodes/<nodeId>.log` — **fresh logs every run**  
4. Execute Python (`python3 code/run_workflow.py`) or try `jupyter nbconvert --execute`  
5. Store run metadata + artifact/log paths in MongoDB  

```bash
# Python (default)
curl -X POST localhost:8787/workspaces/ws_x/runs -H 'Content-Type: application/json' \\
  -d '{"runtime":"python"}'

# Jupyter path (materializes notebook; executes if jupyter is installed)
curl -X POST localhost:8787/workspaces/ws_x/runs -H 'Content-Type: application/json' \\
  -d '{"runtime":"notebook"}'
```

## Collections

- `workspaces` — current head  
- `workspace_versions` — immutable history  
- `secrets` — AES-256-GCM encrypted values (`secretRef` only in YAML)  
- `runs` — execution history  

## Env

See `.env.example`. For remote Studio UI hosts, keep `CORS_ORIGIN=*` (or list your UI origins). The API already listens on `0.0.0.0`.
