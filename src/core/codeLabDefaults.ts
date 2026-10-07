export type NotebookCellType = "code" | "markdown";
export type NotebookCellStatus = "idle" | "running" | "success" | "error";

export interface NotebookCell {
  id: string;
  cell_type: NotebookCellType;
  source: string;
  /** Databricks-style execution metadata */
  execution_count?: number | null;
  status?: NotebookCellStatus;
  /** Captured stdout/stderr shown under the cell */
  output?: string;
  output_error?: boolean;
}

export const DEFAULT_PYTHON = `# Agent Studio — Python lab
# Runs on the API host like a workflow step (logs under data/runs/...)

from pathlib import Path

print("Hello from Agent Studio Python editor")
print("cwd:", Path(".").resolve())

# Example: simple data cleanup
rows = [
    {"name": "  Acme  ", "status": "active"},
    {"name": "Beta", "status": None},
    {"name": "Acme", "status": "active"},
]

cleaned = []
seen = set()
for r in rows:
    name = (r["name"] or "").strip()
    if not name or name in seen:
        continue
    seen.add(name)
    cleaned.append({"name": name, "status": r["status"] or "unknown"})

print("cleaned:", cleaned)
`;

export function defaultNotebookCells(): NotebookCell[] {
  return [
    {
      id: "md1",
      cell_type: "markdown",
      status: "idle",
      source:
        "# Customer enrichment notebook\n\nDatabricks-style cells for **data processing** and **cleanup**.\n\n- `Shift+Enter` run cell & advance\n- `Cmd/Ctrl+Enter` run cell\n- Use **Run all** for the full notebook",
    },
    {
      id: "c1",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# COMMAND ----------
# Load sample frame (replace with Mongo / stage_cache reads)
import pandas as pd

df = pd.DataFrame([
    {"city": "Bengaluru", "temp_c": 28, "status": "ok"},
    {"city": "Austin", "temp_c": 32, "status": "ok"},
    {"city": "Bengaluru", "temp_c": 27, "status": "stale"},
    {"city": "  Seattle ", "temp_c": None, "status": "ok"},
])
print(df.to_string(index=False))
`,
    },
    {
      id: "c2",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# COMMAND ----------
# Cleanup: trim strings, drop null metrics, dedupe
df["city"] = df["city"].astype(str).str.strip()
cleaned = (
    df.dropna(subset=["temp_c"])
      .drop_duplicates(subset=["city"], keep="last")
      .reset_index(drop=True)
)
print(cleaned.to_string(index=False))
print(f"rows_in={len(df)} rows_out={len(cleaned)}")
`,
    },
  ];
}

/** Demo notebook for Mongo → cleanup → S3 lake publish */
export function deLakeNotebookCells(): NotebookCell[] {
  return [
    {
      id: "md_de1",
      cell_type: "markdown",
      status: "idle",
      source: `# DE lake demo — MongoDB → cleanup → S3

**Live connectors:** when you click **Run all** on this notebook (workspace Applied), Agent Studio materializes your MongoDB / S3 connectors + secrets into the run folder and injects \`studio_connectors.py\`.

1. Install & configure **MongoDB** (+ optional **S3**) under Plug → Apply  
2. Set \`USE_LIVE_CONNECTOR = True\` below to fetch from Mongo  
3. Cleanup cells → optional \`USE_S3 = True\` to publish`,
    },
    {
      id: "c_de1",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# COMMAND ----------
# Fetch via workspace MongoDB connector (or sample fallback)
import json
from datetime import datetime, timezone
from pathlib import Path

# Injected on Run-all by Agent Studio code-lab bootstrap:
#   from studio_connectors import list_connectors, fetch_mongodb, write_s3_json, get_connector
try:
    from studio_connectors import list_connectors, fetch_mongodb, write_s3_json, get_connector
except ImportError:
    list_connectors = lambda: []
    get_connector = lambda **k: None
    def fetch_mongodb(collection, fallback_docs=None, **k):
        print("studio_connectors not available — using fallback")
        return list(fallback_docs or [])
    def write_s3_json(obj, key="", **k):
        p = Path("orders_clean_preview.json")
        p.write_text(json.dumps(obj, indent=2), encoding="utf-8")
        return {"localArtifact": str(p), "uploaded": False}

USE_LIVE_CONNECTOR = True  # False = sample docs only
# When you have several Mongo connectors (Atlas prod, staging, local…), set the id:
MONGO_CONNECTOR_ID = ""  # e.g. "mongodb_atlas_prod" — empty = first mongodb connector

FALLBACK = [
    {"_id": "o1", "customer": "  Acme Corp ", "amount": 120.5, "status": "paid", "ts": "2026-08-26T10:00:00Z"},
    {"_id": "o2", "customer": "Beta LLC", "amount": None, "status": "pending", "ts": "2026-08-26T11:00:00Z"},
    {"_id": "o3", "customer": "Acme Corp", "amount": 120.5, "status": "paid", "ts": "2026-08-26T10:00:00Z"},
    {"_id": "o4", "customer": "Gamma", "amount": 45, "status": "PAID", "ts": "2026-08-26T12:15:00Z"},
]

print("connectors:", [(c.get("id"), c.get("label"), c.get("type")) for c in list_connectors()])
mongo = get_connector(connector_id=MONGO_CONNECTOR_ID or None, connector_type="mongodb")
print("mongo connector:", None if not mongo else {k: mongo.get(k) for k in ("id", "label", "config")})

if USE_LIVE_CONNECTOR:
    raw_docs = fetch_mongodb(
        collection="orders",
        connector_id=MONGO_CONNECTOR_ID or None,
        database=(mongo or {}).get("config", {}).get("database") or "ops",
        limit=500,
        fallback_docs=FALLBACK,
    )
else:
    raw_docs = FALLBACK
    print("sample mode · rows=", len(raw_docs))

print(f"raw docs: {len(raw_docs)}")
if raw_docs:
    print(json.dumps(raw_docs[0], indent=2, default=str))
`,
    },
    {
      id: "c_de2",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# COMMAND ----------
# Cleanup: trim, normalize status, drop null amounts, dedupe
cleaned = []
seen = set()
for d in raw_docs:
    customer = (d.get("customer") or "").strip()
    amount = d.get("amount")
    status = str(d.get("status") or "").strip().lower()
    if not customer or amount is None:
        continue
    key = (customer.lower(), float(amount), status)
    if key in seen:
        continue
    seen.add(key)
    cleaned.append({
        "customer": customer,
        "amount": float(amount),
        "status": status,
        "ts": d.get("ts"),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    })

print(f"cleaned rows: {len(cleaned)}")
for row in cleaned:
    print(row)
`,
    },
    {
      id: "c_de3",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# COMMAND ----------
# Publish via S3 connector (or local preview)
USE_S3 = False  # True after S3 plugin connector + secrets are Applied

payload = {
    "dataset": "orders_clean",
    "format": "json",
    "row_count": len(cleaned),
    "rows": cleaned,
}

if USE_S3:
    write_s3_json(payload, key="orders/orders_clean.json")
else:
    out = Path("orders_clean_preview.json")
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote preview → {out.resolve()}")
    print("Set USE_S3 = True to upload through the S3 connector")
`,
    },
  ];
}

/** Minimal markdown → HTML for Databricks-like preview (no extra deps). */
export function renderSimpleMarkdown(src: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  const flushCode = () => {
    if (!codeBuf.length) return;
    html.push(
      `<pre class="nb-md-code"><code>${esc(codeBuf.join("\n"))}</code></pre>`,
    );
    codeBuf = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^###\s+/.test(line)) {
      html.push(`<h3>${inline(esc(line.replace(/^###\s+/, "")))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      html.push(`<h2>${inline(esc(line.replace(/^##\s+/, "")))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      html.push(`<h1>${inline(esc(line.replace(/^#\s+/, "")))}</h1>`);
    } else if (/^[-*]\s+/.test(line)) {
      html.push(`<li>${inline(esc(line.replace(/^[-*]\s+/, "")))}</li>`);
    } else if (!line.trim()) {
      html.push("<br/>");
    } else {
      html.push(`<p>${inline(esc(line))}</p>`);
    }
  }
  if (inCode) flushCode();
  return html.join("");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
