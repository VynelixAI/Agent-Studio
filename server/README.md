# Agent Studio API

Fastify + MongoDB system of record for workspaces, versioned YAML, encrypted secrets, and local run materialization.

## Quick start

```bash
# from repo root — start MongoDB
docker compose up -d mongo

cd server
cp .env.example .env   # if needed
npm ci
npm run dev
```

API: http://localhost:8787 · Health: http://localhost:8787/health

### Python runtime setup

For consistent local workflow execution, create `server/.venv` and install the runtime dependencies from the repository root.

Windows PowerShell:

```powershell
python -m venv server/.venv
server\.venv\Scripts\python.exe -m pip install --upgrade pip
server\.venv\Scripts\python.exe -m pip install -r server\sandbox\requirements.txt
```

Linux / macOS:

```bash
python3 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/python -m pip install -r server/sandbox/requirements.txt
```

The local runner prefers this environment. Remote deployments should use the Docker runner image instead of executing workflow code in the API process environment.

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
4. Execute Python from the server-managed virtual environment, or use Jupyter for notebook runs.  
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

See `.env.example`. The API binds to `127.0.0.1` by default for safe local development. For a LAN/remote deployment, explicitly set `API_HOST=0.0.0.0`, `NODE_ENV=production`, `AUTH_REQUIRED=true`, a strong `SECRETS_KEY`, valid `API_KEYS`, exact `CORS_ORIGIN` values, and `RUNNER_SANDBOX=docker`. A non-loopback bind is rejected unless authentication and Docker workflow isolation are configured. Build the image from the repository root: `docker build -f server/sandbox/Dockerfile -t agent-studio-runner:local server/sandbox`. The Docker runner defaults to `RUNNER_DOCKER_NETWORK=none`; only enable network through a restricted, firewall-controlled Docker network when the workflow connectors require it. Do not expose this API to the internet before completing the deployment and sandbox validation checklist.

Workflow child processes inherit only essential OS environment variables by default. Configure `RUNNER_ENV_ALLOWLIST` with comma-separated variable names only when a connector explicitly requires them. Core backend secrets are never passed to child processes.


## Workflow isolation

Local development uses host Python for trusted workflows unless `RUNNER_SANDBOX=docker` is selected. Any non-loopback API bind requires the Docker runner. The runner container has read-only root filesystem, dropped Linux capabilities, no-new-privileges, no default network, and configurable CPU/memory/PID/time limits. It still mounts the current run directory (including that run's decrypted connector secrets) for IO. Treat access to the configured Docker daemon as privileged and use network-level egress controls for untrusted workflows. PostgreSQL (`psycopg2-binary`) and DuckDB drivers are included in the standard image. Add any optional provider driver to `server/sandbox/requirements.txt` and rebuild the image; runtime pip installation is intentionally disabled.
