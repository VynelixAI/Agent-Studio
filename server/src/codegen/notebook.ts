import type { TasksFile } from "./tasksYaml.js";

function mdCell(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return {
    cell_type: "markdown" as const,
    metadata: {},
    source: lines.split(/(?<=\n)/),
  };
}

function codeCell(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/^\n/, "");
  const withNl = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return {
    cell_type: "code" as const,
    execution_count: null as number | null,
    metadata: {},
    outputs: [] as unknown[],
    source: withNl.split(/(?<=\n)/),
  };
}

/** Build a Jupyter notebook for data processing / cleanup on this run's stage cache. */
export function buildDataCleanupNotebook(tasks: TasksFile): string {
  const cells = [
    mdCell(
      `# Data processing & cleanup

Workspace **${tasks.run.workspace_name}** · run \`${tasks.run.run_id}\` · v${tasks.run.version}

Use this notebook for exploratory cleanup, profiling, and fixing stage-cache datasets before/after pipeline steps.`,
    ),
    codeCell(`from pathlib import Path
import json
import sys
import yaml
import pandas as pd

ROOT = Path("..").resolve()
STAGE = Path("../code/stage_cache")
sys.path.insert(0, str((ROOT / "code").resolve()))

# Connector helpers (Mongo / S3) — uses tasks.yaml + secrets.local.yaml from this run
from studio_connectors import (
    list_connectors,
    get_connector,
    fetch_mongodb,
    write_s3_json,
)

TASKS = yaml.safe_load((ROOT / "tasks.yaml").read_text())
secrets_path = ROOT / "secrets.local.yaml"
SECRETS = yaml.safe_load(secrets_path.read_text()) if secrets_path.exists() else {"secrets": {}}

print("workspace:", TASKS["run"]["workspace_id"])
print("tasks:", [t["id"] for t in TASKS["tasks"]])
print("connectors:", [c["id"] for c in TASKS.get("connectors", [])])
print("secret refs:", list((SECRETS.get("secrets") or {}).keys()))
`),
    mdCell(`## Fetch live data via connectors

Set \`USE_LIVE_CONNECTOR = True\` to read from the MongoDB connector configured in Agent Studio.
If the connector / pymongo / network is unavailable, the cell falls back to sample docs.`),
    codeCell(`USE_LIVE_CONNECTOR = True  # flip to False for sample-only
# Pick among multiple Mongo connectors (Atlas / local / staging):
MONGO_CONNECTOR_ID = ""  # e.g. "mongodb_atlas_prod" — empty = first mongodb

FALLBACK = [
    {"_id": "o1", "customer": "  Acme Corp ", "amount": 120.5, "status": "paid"},
    {"_id": "o2", "customer": "Beta LLC", "amount": None, "status": "pending"},
    {"_id": "o3", "customer": "Acme Corp", "amount": 120.5, "status": "paid"},
    {"_id": "o4", "customer": "Gamma", "amount": 45, "status": "PAID"},
]

print("mongodb connectors:", [
    (c.get("id"), c.get("label"))
    for c in list_connectors()
    if c.get("type") == "mongodb"
])
mongo = get_connector(connector_id=MONGO_CONNECTOR_ID or None, connector_type="mongodb")
print("mongo connector:", (mongo or {}).get("id"), (mongo or {}).get("config"))

if USE_LIVE_CONNECTOR:
    raw_docs = fetch_mongodb(
        collection=(mongo or {}).get("config", {}).get("collection") or "orders",
        connector_id=MONGO_CONNECTOR_ID or None,
        database=(mongo or {}).get("config", {}).get("database") or "ops",
        # limit omitted ⇒ read ALL matching rows; set limit=N to cap
        fallback_docs=FALLBACK,
    )
else:
    raw_docs = FALLBACK
    print("sample mode · rows=", len(raw_docs))

df = pd.json_normalize(raw_docs)
df.head()
`),
    mdCell("## Stage cache inventory"),
    codeCell(`def list_stages(stage_dir: Path = STAGE):
    rows = []
    if not stage_dir.exists():
        return pd.DataFrame(columns=["key", "path", "bytes"])
    for p in sorted(stage_dir.glob("*.json")):
        rows.append({"key": p.stem, "path": str(p), "bytes": p.stat().st_size})
    return pd.DataFrame(rows)

stages = list_stages()
stages
`),
    mdCell("## Load a stage into a DataFrame"),
    codeCell(`from stage_dataset import dataset_to_dataframe, rows_from_dataset

def load_stage_df(key: str) -> pd.DataFrame:
    """Prefer columnar stage datasets (schema.columns + rows / parquet spill)."""
    safe = key.replace("/", "_").replace(":", "_")
    path = STAGE / f"{safe}.json"
    raw = json.loads(path.read_text())
    data = raw.get("data")
    try:
        return dataset_to_dataframe(data)
    except Exception:
        if isinstance(data, list):
            return pd.json_normalize(data)
        if isinstance(data, dict) and isinstance(data.get("rows"), list):
            return pd.json_normalize(data["rows"])
        if isinstance(data, dict):
            return pd.json_normalize(data)
        return pd.DataFrame([{"value": data}])

example_key = next((o for t in TASKS["tasks"] for o in t.get("outputs") or []), None)
print("example_key:", example_key)
if example_key:
    safe = example_key.replace("/", "_").replace(":", "_")
    df = load_stage_df(example_key) if (STAGE / f"{safe}.json").exists() else pd.DataFrame()
    if not df.empty:
        print("columns:", list(df.columns), "rows:", len(df))
else:
    df = pd.DataFrame()
df.head()
`),
    mdCell("## Data cleanup helpers"),
    codeCell(`def cleanup_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Standard DE cleanup: trim strings, drop empty cols, drop duplicates."""
    out = frame.copy()
    for col in out.select_dtypes(include=["object"]).columns:
        out[col] = out[col].map(lambda x: x.strip() if isinstance(x, str) else x)
    out = out.dropna(axis=1, how="all")
    out = out.drop_duplicates()
    return out

cleaned = cleanup_frame(df) if not df.empty else df
cleaned
`),
    mdCell("## Write cleaned data back to stage cache"),
    codeCell(`def save_stage(key: str, data):
    STAGE.mkdir(parents=True, exist_ok=True)
    safe = key.replace("/", "_").replace(":", "_")
    path = STAGE / f"{safe}.json"
    payload = {
        "key": key,
        "data": data,
        "updated_at": pd.Timestamp.utcnow().isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    print("wrote", path)

# Uncomment to persist:
# if not cleaned.empty:
#     save_stage("stage.cleaned", cleaned.to_dict(orient="records"))
`),
    mdCell("## Optional — publish cleaned frame to S3 via connector"),
    codeCell(`# Requires Amazon S3 connector + secrets applied on the workspace
USE_S3 = False  # set True after configuring the S3 plugin connector

cleaned_records = cleaned.to_dict(orient="records") if not cleaned.empty else []
payload = {"dataset": "orders_clean", "row_count": len(cleaned_records), "rows": cleaned_records}

if USE_S3:
    write_s3_json(payload, key="orders/orders_clean.json")
else:
    out = ROOT / "outputs" / "orders_clean_preview.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("wrote local preview", out)
`),
    mdCell("## Task catalogue (from tasks.yaml)"),
    codeCell(`pd.DataFrame([
    {
        "id": t["id"],
        "type": t["type"],
        "connector": t.get("connector"),
        "inputs": ",".join(t.get("inputs") or []),
        "outputs": ",".join(t.get("outputs") or []),
        "depends_on": ",".join(t.get("depends_on") or []),
    }
    for t in TASKS["tasks"]
])
`),
  ];

  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11",
      },
      agent_studio: {
        workspace_id: tasks.run.workspace_id,
        run_id: tasks.run.run_id,
        purpose: "data_processing_cleanup",
      },
    },
    cells,
  };

  return `${JSON.stringify(nb, null, 2)}\n`;
}
