# Agent Studio — domain node tests

Fixtures + scripts that exercise node handlers with sample CSV data.

## Layout

| Folder | Domain | What it covers |
|--------|--------|----------------|
| `basics/` | Core data/logic | stage, transform, code/python, file, log, triggers |
| `control_workflow/` | Control flow | if, switch, loop, parallel, wait, return, approval, error_handler |
| `databases/` | DB plugins | ClickHouse SQL builders, Mongo/PG/MySQL routing |
| `data_engineering/` | Lake / compute | S3 (8 nodes), Spark (7 nodes) |
| `automation/` | Orchestration | Prefect routing, wait, log |
| `ai_communication/` | AI / notify | llm/agent wiring, RAG-style stages, log |
| `common/` | Shared harness | sandbox, CSV→stage, task helpers |
| `_generated/` | Emitted codegen | `run_workflow.py` + `stage_dataset.py` (from server) |

Each domain has:
- `data/*.csv` — dummy datasets
- `test_*.py` — unittest suite

## Quick start

```bash
# from repo root
npx tsx testing/scripts/emit_codegen.ts
python3 testing/run_all.py
```

Or via npm:

```bash
npm run test:domains:emit
npm run test:domains
``` 3


Single domain:

```bash
python3 -m unittest testing.basics.test_basics -v
python3 -m unittest testing.control_workflow.test_control -v
python3 -m unittest testing.databases.test_databases -v
python3 -m unittest testing.data_engineering.test_data_engineering -v
python3 -m unittest testing.automation.test_automation -v
python3 -m unittest testing.ai_communication.test_ai_communication -v
```

## Optional live integrations

```bash
AS_LIVE_DB=1 python3 -m unittest testing.databases.test_databases -v
AS_LIVE_SPARK=1 python3 -m unittest testing.data_engineering.test_data_engineering -v
AS_LIVE_S3=1 python3 -m unittest testing.data_engineering.test_data_engineering -v
```

Live tests need matching local services + credentials; offline suites still validate
handlers, SQL builders, and CSV→stage plumbing without external systems.

## Studio UI runs (IF / switch / etc.)

Handlers are written into each run’s `code/run_workflow.py` when the API materializes
the run. After pulling control-flow fixes, **restart the API** (`npm run dev:server`)
and re-run — an old Node process keeps emitting the previous runner and you’ll see
stub notes like “No dedicated handler yet”.
