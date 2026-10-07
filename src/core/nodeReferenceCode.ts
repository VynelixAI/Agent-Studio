/**
 * n8n / Flowise-style reference Python for canvas nodes.
 * Generated in the workspace Python + Notebook tabs for later download.
 */
import type { NotebookCell } from "./codeLabDefaults";
import type {
  ConnectorRef,
  FlowEdge,
  FlowNode,
  WorkspaceDocument,
} from "../types/workspace";

export const GENERATED_NOTEBOOK_CELL_PREFIX = "workflow-node:";
export const GENERATED_NOTEBOOK_MD_PREFIX = "workflow-node-md:";

export function isGeneratedWorkflowCell(id: string): boolean {
  return (
    id.startsWith(GENERATED_NOTEBOOK_CELL_PREFIX) ||
    id.startsWith(GENERATED_NOTEBOOK_MD_PREFIX) ||
    id === "workflow-overview" ||
    id === "workflow-runtime" ||
    id === "workflow-runner"
  );
}

export type NodeCodeOverlay = {
  fingerprint: string;
  source: string;
};

export function nodeFingerprint(node: FlowNode): string {
  return JSON.stringify({
    t: node.type,
    l: node.label,
    c: node.connector ?? null,
    i: node.inputs ?? [],
    o: node.outputs ?? [],
    cfg: node.config ?? {},
  });
}

export function pythonClassName(node: FlowNode): string {
  const id = String(node.id || "node").replace(/[^A-Za-z0-9]+/g, "_");
  const safe = /^[A-Za-z]/.test(id) ? id : `n_${id}`;
  return `Node_${safe}`;
}

export function flattenNodeConfig(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const cfg = { ...(config ?? {}) };
  for (const nest of ["input", "processing", "output", "config", "params"]) {
    const inner = cfg[nest];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
        if (cfg[k] === undefined) cfg[k] = v;
      }
    }
  }
  return cfg;
}

export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => pyLiteral(v)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return "None";
}

function indent(text: string, spaces = 8): string {
  const pad = " ".repeat(spaces);
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.length ? pad + line : pad.trimEnd()))
    .join("\n");
}

function topoIds(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const ids = nodes.map((n) => n.id);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (!incoming.has(e.target) || !adj.has(e.source)) continue;
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const nxt of adj.get(id) ?? []) {
      const n = (incoming.get(nxt) ?? 1) - 1;
      incoming.set(nxt, n);
      if (n === 0) queue.push(nxt);
    }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

function mermaid(document: WorkspaceDocument): string {
  const lines = ["flowchart LR"];
  for (const n of document.flow.nodes) {
    const label = `${n.label ?? n.id}\\n${n.type}`;
    lines.push(`    ${n.id.replace(/[^A-Za-z0-9_]/g, "_")}["${label.replace(/"/g, "'")}"]`);
  }
  for (const e of document.flow.edges) {
    const s = e.source.replace(/[^A-Za-z0-9_]/g, "_");
    const t = e.target.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`    ${s} --> ${t}`);
  }
  return lines.join("\n");
}

type Family =
  | "trigger"
  | "llm"
  | "agent"
  | "rag"
  | "embedding"
  | "tool"
  | "mongodb"
  | "sql"
  | "objectstore"
  | "spark"
  | "airflow"
  | "prefect"
  | "orchestrator"
  | "stream"
  | "cache"
  | "search"
  | "graph"
  | "rest"
  | "file"
  | "transform"
  | "code"
  | "notebook"
  | "control"
  | "generic";

function familyOf(type: string): Family {
  const t = type.toLowerCase();
  if (t.startsWith("trigger.")) return "trigger";
  if (t === "llm") return "llm";
  if (t === "agent") return "agent";
  if (t === "rag") return "rag";
  if (t === "embedding") return "embedding";
  if (t === "tool") return "tool";
  if (t.startsWith("mongodb.")) return "mongodb";
  if (t === "rest") return "rest";
  if (t === "file" || t.startsWith("file.")) return "file";
  if (t === "transform") return "transform";
  if (t === "code" || t === "python") return "code";
  if (t === "notebook") return "notebook";
  if (
    [
      "if",
      "switch",
      "loop",
      "parallel",
      "wait",
      "return",
      "error_handler",
      "human_approval",
      "set_variables",
      "sub_workflow",
      "log",
      "chat.reply",
    ].includes(t)
  ) {
    return "control";
  }
  if (
    t.startsWith("postgresql.") ||
    t.startsWith("mysql.") ||
    t.startsWith("clickhouse.") ||
    t.startsWith("snowflake.") ||
    t.startsWith("duckdb.") ||
    t.startsWith("redshift.") ||
    t.startsWith("trino.") ||
    t.startsWith("cassandra.") ||
    t.startsWith("bigquery.") ||
    t.startsWith("databricks.sql") ||
    t.startsWith("databricks.execute") ||
    t.startsWith("databricks.create") ||
    t.startsWith("databricks.list")
  ) {
    return "sql";
  }
  if (
    t.startsWith("s3.") ||
    t.startsWith("gcs.") ||
    t.startsWith("azure_blob.")
  ) {
    return "objectstore";
  }
  if (t.startsWith("spark.")) return "spark";
  if (t.startsWith("airflow.")) return "airflow";
  if (t.startsWith("prefect.")) return "prefect";
  if (
    t.startsWith("dagster.") ||
    t.startsWith("temporal.") ||
    t.startsWith("nifi.") ||
    t.startsWith("dbt.")
  ) {
    return "orchestrator";
  }
  if (t.startsWith("kafka.") || t.startsWith("flink.")) return "stream";
  if (t.startsWith("redis.")) return "cache";
  if (t.startsWith("elasticsearch.")) return "search";
  if (t.startsWith("neo4j.")) return "graph";
  return "generic";
}

function cfgStr(cfg: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = cfg[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return fallback;
}

function sparkExecute(type: string, cfg: Record<string, unknown>): string {
  const suffix = type.split(".").pop() ?? type;
  const sql = cfgStr(cfg, ["sql", "query"], "SELECT 1 AS ok");
  const path = cfgStr(cfg, ["path", "sourcePath"], "/data/input");
  const format = cfgStr(cfg, ["format"], "parquet");
  const table = cfgStr(cfg, ["target", "table", "resourceName"], "spark_table");
  const appName = cfgStr(cfg, ["appName"], "agent-studio-spark");
  const jobPath = cfgStr(cfg, ["appResource", "jobPath", "application", "jarOrPy"], "jobs/app.py");
  const appId = cfgStr(cfg, ["appId"], "");
  const masterUrl = cfgStr(cfg, ["masterUrl", "sparkUrl", "restUrl"], "");
  const extra = cfgStr(cfg, ["appArgs", "extraArgs"], "");
  const connLookup = "connector_config(ctx, PARAMS.get(\"connectorId\") or CONNECTOR)";

  if (suffix === "sql") {
    return `
# n8n Data Table / Flowise Document pattern: one item per Spark row
sql = PARAMS.get("sql") or PARAMS.get("query") or ${pyLiteral(sql)}
cfg = ${connLookup}
master = str(cfg.get("master") or cfg.get("sparkMaster") or "local[*]")
app_name = PARAMS.get("appName") or cfg.get("appName") or ${pyLiteral(appName)}
try:
    from pyspark.sql import SparkSession
except ImportError as exc:
    raise RuntimeError("Install pyspark to run spark.sql (Databricks SQL / n8n Data Table equivalent)") from exc
spark = SparkSession.builder.appName(str(app_name)).master(master).getOrCreate()
df = spark.sql(str(sql))
lim = PARAMS.get("limit")
collected = df.limit(int(lim)).collect() if lim not in (None, "") else df.collect()
rows = [row.asDict(recursive=True) for row in collected]
print(f"[spark.sql] rows={len(rows)}")
return items_from_rows(rows)`.trim();
  }

  if (suffix === "read") {
    return `
path = PARAMS.get("path") or PARAMS.get("sourcePath") or PARAMS.get("uri") or ${pyLiteral(path)}
fmt = str(PARAMS.get("format") or ${pyLiteral(format)}).lower()
cfg = ${connLookup}
master = str(cfg.get("master") or "local[*]")
try:
    from pyspark.sql import SparkSession
except ImportError as exc:
    raise RuntimeError("Install pyspark to run spark.read") from exc
spark = SparkSession.builder.appName("agent-studio-spark-read").master(master).getOrCreate()
reader = spark.read.format(fmt)
options = PARAMS.get("options") or {}
if isinstance(options, str) and options.strip():
    try:
        options = json.loads(options)
    except Exception:
        options = {}
if isinstance(options, dict):
    for k, v in options.items():
        reader = reader.option(str(k), str(v))
elif fmt in ("csv", "json"):
    reader = reader.option("header", "true").option("inferSchema", "true")
df = reader.load(str(path))
lim = PARAMS.get("limit")
collected = df.limit(int(lim)).collect() if lim not in (None, "") else df.collect()
rows = [row.asDict(recursive=True) for row in collected]
print(f"[spark.read] {fmt} {path} rows={len(rows)}")
return items_from_rows(rows)`.trim();
  }

  if (suffix === "write") {
    return `
path = PARAMS.get("path") or PARAMS.get("targetPath") or PARAMS.get("uri") or ${pyLiteral(path)}
table = PARAMS.get("table") or PARAMS.get("target")
fmt = str(PARAMS.get("format") or ${pyLiteral(format)}).lower()
mode = PARAMS.get("mode") or PARAMS.get("saveMode") or "overwrite"
rows = rows_from_items(items)
if not rows:
    raise RuntimeError("spark.write needs upstream n8n items[{json}]")
cfg = ${connLookup}
master = str(cfg.get("master") or "local[*]")
try:
    from pyspark.sql import SparkSession
except ImportError as exc:
    raise RuntimeError("Install pyspark to run spark.write") from exc
spark = SparkSession.builder.appName("agent-studio-spark-write").master(master).getOrCreate()
df = spark.createDataFrame(rows)
if table:
    df.write.format(fmt).mode(str(mode)).saveAsTable(str(table))
    dest = f"table:{table}"
else:
    df.write.format(fmt).mode(str(mode)).save(str(path))
    dest = path
print(f"[spark.write] {fmt} {dest} rows={len(rows)} mode={mode}")
return [{"json": {"ok": True, "op": "write", "written": len(rows), "destination": dest, "format": fmt, "mode": mode}}]`.trim();
  }

  if (suffix === "createTable") {
    return `
table = PARAMS.get("target") or PARAMS.get("table") or PARAMS.get("resourceName") or ${pyLiteral(table)}
ddl = PARAMS.get("sql") or PARAMS.get("ddl") or ""
cols = PARAMS.get("definition") or PARAMS.get("columns") or "id BIGINT, name STRING"
using = PARAMS.get("using") or "PARQUET"
location = PARAMS.get("location") or ""
cfg = ${connLookup}
master = str(cfg.get("master") or "local[*]")
try:
    from pyspark.sql import SparkSession
except ImportError as exc:
    raise RuntimeError("Install pyspark to run spark.createTable") from exc
spark = SparkSession.builder.appName("agent-studio-spark-ddl").master(master).getOrCreate()
sql = str(ddl).strip()
if not sql:
    ine = "IF NOT EXISTS " if PARAMS.get("ifNotExists", True) else ""
    col_sql = str(cols)
    if not col_sql.startswith("("):
        col_sql = f"({col_sql})"
    sql = f"CREATE TABLE {ine}{table} {col_sql} USING {using}"
    if location:
        sql += f" LOCATION '{location}'"
spark.sql(sql)
print(f"[spark.createTable] {table}")
return [{"json": {"ok": True, "op": "createTable", "table": table, "sql": sql}}]`.trim();
  }

  if (suffix === "submit") {
    return `
# n8n / Databricks Jobs: spark-submit → emit appId for spark.jobStatus ($json.appId)
import os, shlex, subprocess
resource = PARAMS.get("appResource") or PARAMS.get("jobPath") or PARAMS.get("jarOrPy") or ${pyLiteral(jobPath)}
app_name = PARAMS.get("appName") or ${pyLiteral(appName)}
app_args = PARAMS.get("appArgs") or PARAMS.get("extraArgs") or ${pyLiteral(extra)}
main_class = PARAMS.get("mainClass")
cfg = ${connLookup}
master = str(cfg.get("master") or cfg.get("sparkMaster") or os.environ.get("SPARK_MASTER") or "local[*]")
deploy_mode = str(PARAMS.get("deployMode") or cfg.get("deployMode") or "client")
spark_bin = str(PARAMS.get("sparkSubmit") or os.environ.get("SPARK_SUBMIT") or "spark-submit")
cmd = [spark_bin, "--master", master, "--deploy-mode", deploy_mode, "--name", str(app_name)]
conf = PARAMS.get("conf") or {}
if isinstance(conf, str) and conf.strip().startswith("{"):
    conf = json.loads(conf)
if isinstance(conf, dict):
    for k, v in conf.items():
        cmd.extend(["--conf", f"{k}={v}"])
if main_class:
    cmd.extend(["--class", str(main_class)])
cmd.append(str(resource))
if app_args:
    cmd.extend(shlex.split(str(app_args)))
print(f"[spark.submit] {' '.join(cmd)}")
proc = subprocess.run(cmd, capture_output=True, text=True)
combined = (proc.stdout or "") + chr(10) + (proc.stderr or "")
app_id = None
for line in combined.splitlines():
    for tok in line.replace(",", " ").replace(":", " ").split():
        if tok.startswith("app-") or tok.startswith("driver-") or tok.startswith("application_"):
            app_id = tok.strip().strip('"').strip("'")
            break
    if app_id:
        break
if proc.returncode != 0 and not app_id:
    raise RuntimeError(combined[-2000:] or f"spark-submit exit {proc.returncode}")
payload = {
    "ok": True,
    "op": "submit",
    "applicationId": app_id,
    "appId": app_id,
    "appResource": resource,
    "returncode": proc.returncode,
    "command": cmd,
}
return [{"json": payload}]`.trim();
  }

  if (suffix === "jobStatus" || suffix === "status") {
    return `
# Follow-up node: bind $json.appId from spark.submit (n8n paired items)
row = first_json(items)
app_id = PARAMS.get("appId") or row.get("appId") or row.get("applicationId") or ${pyLiteral(appId)}
if not app_id:
    raise RuntimeError("spark.jobStatus needs appId (bind from spark.submit item)")
cfg = ${connLookup}
base = spark_rest_base(cfg, str(cfg.get("master") or ${pyLiteral(masterUrl)}))
if not base:
    raise RuntimeError("Spark REST URL missing (connector restUrl / SPARK_REST_URL)")
body = http_json(f"{base}/v1/submissions/status/{app_id}")
driver = {}
if not (isinstance(body, dict) and body.get("driverState")):
    try:
        driver = http_json(f"{base}/api/v1/applications/{app_id}")
    except Exception:
        driver = {}
payload = {**(body if isinstance(body, dict) else {}), **(driver if isinstance(driver, dict) else {}), "appId": app_id, "applicationId": app_id, "op": "jobStatus", "ok": True}
return [{"json": payload}]`.trim();
  }

  if (suffix === "cancel") {
    return `
row = first_json(items)
app_id = PARAMS.get("appId") or row.get("appId") or row.get("applicationId") or ${pyLiteral(appId)}
if not app_id:
    raise RuntimeError("spark.cancel needs appId")
cfg = ${connLookup}
base = spark_rest_base(cfg, str(cfg.get("master") or ""))
if not base:
    raise RuntimeError("Spark REST URL missing")
body = http_json(f"{base}/v1/submissions/kill/{app_id}", method="POST", body={})
return [{"json": {**(body if isinstance(body, dict) else {}), "appId": app_id, "op": "cancel", "ok": True}}]`.trim();
  }

  return `
print(f"[spark] {TYPE}")
return [{"json": {"ok": True, "op": ${pyLiteral(suffix)}}}]`.trim();
}

function airflowExecute(type: string, cfg: Record<string, unknown>): string {
  const suffix = type.split(".").pop() ?? type;
  const dagId = cfgStr(cfg, ["dagId", "resourceName"], "example_dag");
  const dagRunId = cfgStr(cfg, ["dagRunId"], "");
  const taskId = cfgStr(cfg, ["taskId"], "");
  const key = cfgStr(cfg, ["xcomKey", "key"], "return_value");

  const authPreamble = `
# n8n Airflow node: REST API (Airflow 2.x /api/v1, 3.x /api/v2) + one item per DAG / dagRun
import base64, os, urllib.parse
cfg = connector_config(ctx, PARAMS.get("connectorId") or CONNECTOR)
base = str(cfg.get("baseUrl") or cfg.get("apiUrl") or os.environ.get("AIRFLOW_API_URL") or "").rstrip("/")
if not base:
    raise RuntimeError("Airflow connector baseUrl missing (n8n Airflow credential)")
headers = {"Accept": "application/json", "Content-Type": "application/json"}
token = cfg.get("token") or os.environ.get("AIRFLOW_API_TOKEN")
user = cfg.get("username") or os.environ.get("AIRFLOW_USERNAME")
password = cfg.get("password") or os.environ.get("AIRFLOW_PASSWORD")
if not base.endswith(("/api/v1", "/api/v2")):
    api_version = str(cfg.get("apiVersion") or os.environ.get("AIRFLOW_API_VERSION") or "").strip()[:1]
    if not api_version:
        try:
            http_json(base + "/api/v2/version", headers=headers, timeout=15)
            api_version = "3"
        except Exception:
            api_version = "2"
    base = base + ("/api/v2" if api_version == "3" else "/api/v1")
if token:
    headers["Authorization"] = f"Bearer {token}"
elif user and base.endswith("/api/v2"):
    # Airflow 3 issues JWTs from POST /auth/token (no Basic auth on /api/v2)
    login = http_json(base[: -len("/api/v2")] + "/auth/token", "POST", headers, {"username": user, "password": password or ""})
    headers["Authorization"] = f"Bearer {login.get('access_token')}"
elif user:
    blob = base64.b64encode(f"{user}:{password or ''}".encode()).decode()
    headers["Authorization"] = f"Basic {blob}"`.trim();

  if (suffix === "listDags") {
    return `${authPreamble}
query = {
    "limit": int(PARAMS.get("limit") or 100),
    "offset": int(PARAMS.get("offset") or 0),
}
if PARAMS.get("onlyActive") is not None:
    query["only_active"] = str(bool(PARAMS.get("onlyActive"))).lower()
body = http_json(base + "/dags?" + urllib.parse.urlencode(query), headers=headers)
dags = body.get("dags") if isinstance(body, dict) else body
rows = dags if isinstance(dags, list) else []
print(f"[airflow.listDags] count={len(rows)}")
return items_from_rows(rows)`.trim();
  }

  if (suffix === "triggerDag") {
    return `${authPreamble}
dag_id = PARAMS.get("dagId") or first_json(items).get("dag_id") or first_json(items).get("dagId") or ${pyLiteral(dagId)}
if not dag_id:
    raise RuntimeError("airflow.triggerDag needs dagId (n8n resource=DAG, operation=Trigger)")
conf = PARAMS.get("conf") or {}
if isinstance(conf, str) and conf.strip():
    conf = json.loads(conf)
payload = {"conf": conf if isinstance(conf, dict) else {}}
run_id = PARAMS.get("dagRunId") or ${pyLiteral(dagRunId)}
if run_id:
    payload["dag_run_id"] = run_id
logical = PARAMS.get("logicalDate") or PARAMS.get("executionDate")
if logical:
    payload["logical_date"] = logical
if base.endswith("/api/v2"):
    payload.setdefault("logical_date", None)  # required field on Airflow 3
body = http_json(f"{base}/dags/{dag_id}/dagRuns", method="POST", headers=headers, body=payload)
print(f"[airflow.triggerDag] {dag_id} run={body.get('dag_run_id')}")
return [{"json": {**body, "dag_id": dag_id, "dagId": dag_id, "op": "triggerDag", "ok": True}}]`.trim();
  }

  if (suffix === "dagStatus") {
    return `${authPreamble}
row = first_json(items)
dag_id = PARAMS.get("dagId") or row.get("dag_id") or row.get("dagId") or ${pyLiteral(dagId)}
run_id = PARAMS.get("dagRunId") or row.get("dag_run_id") or row.get("dagRunId") or ${pyLiteral(dagRunId)}
if not dag_id or not run_id:
    raise RuntimeError("airflow.dagStatus needs dagId + dagRunId (bind from triggerDag $json.dag_run_id)")
body = http_json(f"{base}/dags/{dag_id}/dagRuns/{run_id}", headers=headers)
print(f"[airflow.dagStatus] {dag_id}/{run_id} state={body.get('state')}")
return [{"json": {**body, "dag_id": dag_id, "dagRunId": run_id, "op": "dagStatus", "ok": True}}]`.trim();
  }

  if (suffix === "pauseDag") {
    return `${authPreamble}
dag_id = PARAMS.get("dagId") or first_json(items).get("dag_id") or ${pyLiteral(dagId)}
is_paused = PARAMS.get("isPaused")
if is_paused is None:
    is_paused = True
paused = str(is_paused).lower() in ("1", "true", "yes", "on")
body = http_json(f"{base}/dags/{dag_id}", method="PATCH", headers=headers, body={"is_paused": paused})
return [{"json": {**body, "dag_id": dag_id, "is_paused": paused, "op": "pauseDag", "ok": True}}]`.trim();
  }

  if (suffix === "clearTask") {
    return `${authPreamble}
dag_id = PARAMS.get("dagId") or first_json(items).get("dag_id") or ${pyLiteral(dagId)}
task_id = PARAMS.get("taskId") or ${pyLiteral(taskId)}
payload = {
    "dry_run": bool(PARAMS.get("dryRun") or False),
    "only_failed": bool(PARAMS.get("onlyFailed") or False),
    "only_running": bool(PARAMS.get("onlyRunning") or False),
    "reset_dag_runs": bool(PARAMS.get("resetDagRuns") if PARAMS.get("resetDagRuns") is not None else True),
}
if task_id:
    payload["task_ids"] = [task_id]
body = http_json(f"{base}/dags/{dag_id}/clearTaskInstances", method="POST", headers=headers, body=payload)
return [{"json": {**body, "dag_id": dag_id, "taskId": task_id, "op": "clearTask", "ok": True}}]`.trim();
  }

  if (suffix === "xcomPull") {
    return `${authPreamble}
row = first_json(items)
dag_id = PARAMS.get("dagId") or row.get("dag_id") or ${pyLiteral(dagId)}
task_id = PARAMS.get("taskId") or row.get("task_id") or ${pyLiteral(taskId)}
run_id = PARAMS.get("dagRunId") or row.get("dag_run_id") or ${pyLiteral(dagRunId)}
key = PARAMS.get("xcomKey") or PARAMS.get("key") or ${pyLiteral(key)}
if not (dag_id and task_id and run_id):
    raise RuntimeError("airflow.xcomPull needs dagId, taskId, dagRunId")
url = f"{base}/dags/{dag_id}/dagRuns/{run_id}/taskInstances/{task_id}/xcomEntries/{key}"
if PARAMS.get("mapIndex") is not None:
    url += "?" + urllib.parse.urlencode({"map_index": int(PARAMS["mapIndex"])})
body = http_json(url, headers=headers)
value = body.get("value") if isinstance(body, dict) else body
print(f"[airflow.xcomPull] {dag_id}/{task_id}/{key}")
return [{"json": {**(body if isinstance(body, dict) else {"value": value}), "value": value, "xcomKey": key, "dag_id": dag_id, "op": "xcomPull", "ok": True}}]`.trim();
  }

  if (suffix === "xcomPush") {
    return `${authPreamble}
row = first_json(items)
dag_id = PARAMS.get("dagId") or row.get("dag_id") or ${pyLiteral(dagId)}
task_id = PARAMS.get("taskId") or row.get("task_id") or ${pyLiteral(taskId)}
run_id = PARAMS.get("dagRunId") or row.get("dag_run_id") or ${pyLiteral(dagRunId)}
key = PARAMS.get("xcomKey") or PARAMS.get("key") or ${pyLiteral(key)}
value = PARAMS.get("value")
if value is None:
    value = row.get("value", row)
body = http_json(
    f"{base}/dags/{dag_id}/dagRuns/{run_id}/taskInstances/{task_id}/xcomEntries",
    method="POST",
    headers=headers,
    body={"key": key, "value": value},
)
return [{"json": {**(body if isinstance(body, dict) else {}), "xcomKey": key, "dag_id": dag_id, "op": "xcomPush", "ok": True}}]`.trim();
  }

  if (suffix === "importVariables") {
    return `${authPreamble}
name = PARAMS.get("variableName") or PARAMS.get("name") or PARAMS.get("key") or PARAMS.get("resourceName")
if not name:
    raise RuntimeError("airflow.importVariables needs variableName")
patch_body = {"key": name, "value": PARAMS.get("value")}
if PARAMS.get("description") is not None:
    patch_body["description"] = PARAMS.get("description")
try:
    body = http_json(f"{base}/variables/{name}", method="PATCH", headers=headers, body=patch_body)
    action = "updated"
except RuntimeError as exc:
    if "HTTP 404" not in str(exc):
        raise
    body = http_json(f"{base}/variables", method="POST", headers=headers, body=patch_body)
    action = "created"
print(f"[airflow.importVariables] {action} {name}")
return [{"json": {**(body if isinstance(body, dict) else {"key": name}), "op": "importVariables", "action": action, "ok": True}}]`.trim();
  }

  return `${authPreamble}
print(f"[airflow] {TYPE}")
return [{"json": {"ok": True, "op": ${pyLiteral(suffix)}}}]`.trim();
}

function prefectExecute(type: string, cfg: Record<string, unknown>): string {
  const suffix = type.split(".").pop() ?? type;
  const deployment = cfgStr(cfg, ["deploymentName", "name"], "");
  const flowRunId = cfgStr(cfg, ["flowRunId", "flow_run_id"], "");

  const auth = `
# n8n / Flowise: Prefect REST → flat $json.flow_run_id for runStatus bind
import os
cfg = connector_config(ctx, PARAMS.get("connectorId") or CONNECTOR)
base = str(cfg.get("apiUrl") or cfg.get("baseUrl") or os.environ.get("PREFECT_API_URL") or "").rstrip("/")
if not base:
    raise RuntimeError("Prefect apiUrl / PREFECT_API_URL missing")
token = cfg.get("apiKey") or cfg.get("token") or os.environ.get("PREFECT_API_KEY") or ""
headers = {"Accept": "application/json", "Content-Type": "application/json"}
if token:
    headers["Authorization"] = f"Bearer {token}"`;

  if (suffix === "listDeployments") {
    return `${auth}
limit = int(PARAMS.get("limit") or 50)
body = http_json(f"{base}/deployments/filter", method="POST", headers=headers, body={"limit": limit})
rows = body if isinstance(body, list) else body.get("deployments") or []
print(f"[prefect.listDeployments] count={len(rows) if isinstance(rows, list) else 0}")
return items_from_rows(rows if isinstance(rows, list) else [])`.trim();
  }

  if (suffix === "triggerDeployment") {
    return `${auth}
row = first_json(items)
deployment_id = PARAMS.get("deploymentId") or row.get("id") or row.get("deploymentId")
name = PARAMS.get("deploymentName") or row.get("name") or ${pyLiteral(deployment)}
if not deployment_id and name:
    found = http_json(f"{base}/deployments/name/{name}", headers=headers)
    deployment_id = (found or {}).get("id") if isinstance(found, dict) else None
if not deployment_id:
    raise RuntimeError("prefect.triggerDeployment needs deploymentId or deploymentName")
params = PARAMS.get("parameters") or {}
if isinstance(params, str) and params.strip():
    params = json.loads(params)
body = http_json(
    f"{base}/deployments/{deployment_id}/create_flow_run",
    method="POST",
    headers=headers,
    body={"parameters": params if isinstance(params, dict) else {}, "state": {"type": "SCHEDULED"}},
)
fr_id = (body or {}).get("id") if isinstance(body, dict) else None
print(f"[prefect.triggerDeployment] {deployment_id} flow_run={fr_id}")
return [{"json": {**(body if isinstance(body, dict) else {}), "flow_run_id": fr_id, "flowRunId": fr_id, "id": fr_id, "deploymentId": deployment_id, "op": "triggerDeployment", "ok": True}}]`.trim();
  }

  if (suffix === "runStatus") {
    return `${auth}
row = first_json(items)
flow_run_id = PARAMS.get("flowRunId") or row.get("flow_run_id") or row.get("flowRunId") or row.get("id") or ${pyLiteral(flowRunId)}
if not flow_run_id:
    raise RuntimeError("prefect.runStatus needs flowRunId (bind from triggerDeployment $json.flow_run_id)")
body = http_json(f"{base}/flow_runs/{flow_run_id}", headers=headers)
state = (body or {}).get("state") if isinstance(body, dict) else None
state_type = state.get("type") if isinstance(state, dict) else state
print(f"[prefect.runStatus] {flow_run_id} state={state_type}")
return [{"json": {**(body if isinstance(body, dict) else {}), "flow_run_id": flow_run_id, "flowRunId": flow_run_id, "id": flow_run_id, "state": state_type, "op": "runStatus", "ok": True}}]`.trim();
  }

  if (suffix === "cancelRun") {
    return `${auth}
row = first_json(items)
flow_run_id = PARAMS.get("flowRunId") or row.get("flow_run_id") or row.get("flowRunId") or row.get("id")
if not flow_run_id:
    raise RuntimeError("prefect.cancelRun needs flowRunId")
http_json(
    f"{base}/flow_runs/{flow_run_id}/set_state",
    method="POST",
    headers=headers,
    body={"state": {"type": "CANCELLED"}, "force": True},
)
return [{"json": {"ok": True, "op": "cancelRun", "flow_run_id": flow_run_id, "flowRunId": flow_run_id, "state": "CANCELLED"}}]`.trim();
  }

  return `${auth}
print(f"[prefect] {TYPE}")
return [{"json": {"ok": True, "op": ${pyLiteral(suffix)}, "params": PARAMS}}]`.trim();
}

function executeBody(node: FlowNode, cfg: Record<string, unknown>): string {
  const family = familyOf(node.type);
  const t = node.type;
  const suffix = t.split(".").pop() ?? t;

  if (family === "trigger") {
    return `
items = items or [{"json": {}}]
row = dict(items[0].get("json") or {})
row.update({
    "trigger": ${pyLiteral(t)},
    "workspace_run": True,
    "payload": PARAMS.get("payloadExample") or PARAMS.get("payload") or {},
    "question": (ctx.get("run") or {}).get("chat", {}).get("question") if ${pyLiteral(t === "trigger.chat")} else row.get("question"),
})
return [{"json": row}]`.trim();
  }

  if (family === "mongodb") {
    const collection = cfgStr(cfg, ["collection", "target", "resourceName"], "documents");
    const database = cfgStr(cfg, ["database", "db"], "");
    if (suffix === "read" || suffix === "aggregate" || suffix === "schema" || suffix === "listCollections") {
      return `
filt = PARAMS.get("filter") if isinstance(PARAMS.get("filter"), dict) else {}
proj = PARAMS.get("projection") if isinstance(PARAMS.get("projection"), dict) else None
limit = PARAMS.get("limit")
try:
    from pymongo import MongoClient
    uri = (ctx.get("connector") or {}).get("uri") or ctx.get("mongo_uri")
    if not uri:
        raise RuntimeError("Set ctx['connector']['uri'] or MONGODB_URI")
    client = MongoClient(uri)
    db = client[${pyLiteral(database || "test")}] if ${pyLiteral(Boolean(database))} else client.get_default_database()
    coll = db[${pyLiteral(collection)}]
    cur = coll.find(filt, proj)
    if limit:
        cur = cur.limit(int(limit))
    rows = [{k: v for k, v in doc.items()} for doc in cur]
    for row in rows:
        if "_id" in row:
            row["_id"] = str(row["_id"])
    return items_from_rows(rows)
except Exception as exc:
    print(f"[reference] {TYPE} live Mongo skipped: {exc}")
    sample = {"collection": ${pyLiteral(collection)}, "filter": filt, "ok": True, "mode": "offline_sample"}
    return [{"json": sample}]`.trim();
    }
    return `
rows = rows_from_items(items)
try:
    from pymongo import MongoClient
    uri = (ctx.get("connector") or {}).get("uri") or ctx.get("mongo_uri")
    client = MongoClient(uri)
    db = client[${pyLiteral(database || "test")}] if ${pyLiteral(Boolean(database))} else client.get_default_database()
    coll = db[${pyLiteral(collection)}]
    op = ${pyLiteral(suffix)}
    if op in ("write", "insert"):
        result = coll.insert_many(rows) if rows else coll.insert_one(PARAMS)
        ack = {"inserted": getattr(result, "inserted_ids", None) or [getattr(result, "inserted_id", None)]}
    elif op == "update":
        ack = coll.update_many(PARAMS.get("filter") or {}, PARAMS.get("update") or {"$set": rows[0] if rows else {}})
        ack = {"matched": ack.matched_count, "modified": ack.modified_count}
    elif op == "delete":
        ack = coll.delete_many(PARAMS.get("filter") or {})
        ack = {"deleted": ack.deleted_count}
    else:
        ack = {"op": op, "rowCount": len(rows)}
    return [{"json": {**ack, "collection": ${pyLiteral(collection)}}}]
except Exception as exc:
    print(f"[reference] {TYPE} live Mongo skipped: {exc}")
    return [{"json": {"op": ${pyLiteral(suffix)}, "rowCount": len(rows), "mode": "offline_sample"}}]`.trim();
  }

  if (family === "sql") {
    const table = cfgStr(cfg, ["target", "table", "resourceName"], "events");
    const database = cfgStr(cfg, ["database", "schema", "dataset"], "");
    const sql = cfgStr(cfg, ["sql", "query", "statement"]);
    const isWrite = /insert|update|delete|execute|load|merge|copy|truncate|create/i.test(suffix);
    if (!isWrite) {
      return `
sql = PARAMS.get("sql") or PARAMS.get("query") or ${pyLiteral(sql || `SELECT * FROM ${database ? `${database}.` : ""}${table}`)}
try:
    import os
    dsn = (ctx.get("connector") or {}).get("dsn") or os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Set connector DSN or DATABASE_URL")
    # psycopg / pymysql / clickhouse-connect — pick based on TYPE
    rows = []
    try:
        import psycopg
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                cols = [c.name for c in cur.description] if cur.description else []
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception:
        import urllib.request, json
        # ClickHouse HTTP fallback
        req = urllib.request.Request(dsn, data=(sql + " FORMAT JSON").encode(), method="POST")
        payload = json.loads(urllib.request.urlopen(req).read())
        rows = payload.get("data") or []
    return items_from_rows(rows)
except Exception as exc:
    print(f"[reference] {TYPE} live SQL skipped: {exc}")
    return [{"json": {"sql": sql, "table": ${pyLiteral(table)}, "mode": "offline_sample"}}]`.trim();
    }
    return `
rows = rows_from_items(items)
sql = PARAMS.get("sql") or PARAMS.get("query")
table = ${pyLiteral(table)}
print(f"[reference] {TYPE} write table={table} rows={len(rows)} sql={sql!r}")
# Live path: INSERT/COPY using connector DSN. Offline: return n8n items echoing the write plan.
return [{"json": {"op": ${pyLiteral(suffix)}, "table": table, "rowCount": len(rows), "sql": sql, "ok": True}}]`.trim();
  }

  if (family === "llm") {
    const model = cfgStr(cfg, ["customModel", "model"], "gpt-4o-mini");
    const provider = cfgStr(cfg, ["provider"], "openai");
    return `
question = first_json(items).get("question") or first_json(items).get("text") or PARAMS.get("userPrompt") or "Summarize upstream items."
messages = [
    {"role": "system", "content": str(PARAMS.get("systemPrompt") or "You are a helpful workflow assistant.")},
    {"role": "user", "content": str(question)},
]
try:
    complete = ctx.get("llm_complete")
    if complete:
        raw = complete(messages, temperature=PARAMS.get("temperature"))
    else:
        import os, json, urllib.request
        key = ctx.get("api_key") or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("No llm_complete hook and no OPENAI_API_KEY")
        body = json.dumps({"model": ${pyLiteral(model)}, "messages": messages}).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=body,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        raw = json.loads(urllib.request.urlopen(req).read())["choices"][0]["message"]["content"]
    text = raw if isinstance(raw, str) else str(raw)
    return [{"json": {"content": text, "summary": text, "text": text, "model": ${pyLiteral(model)}, "provider": ${pyLiteral(provider)}}}]
except Exception as exc:
    print(f"[reference] LLM live call skipped: {exc}")
    text = f"(offline) would call ${provider}/${model}: {question}"
    return [{"json": {"content": text, "summary": text, "text": text, "mode": "offline_sample"}}]`.trim();
  }

  if (family === "agent") {
    return `
goal = PARAMS.get("systemPrompt") or PARAMS.get("intentText") or "Complete the task using tools when needed."
tools = PARAMS.get("tools") or []
try:
    step = ctx.get("agent_step")
    if not step:
        raise RuntimeError("Agent runtime hook ctx['agent_step'] not injected — running offline sample")
    result = step([{"role": "user", "content": str(goal)}], tools)
    text = result.get("content") if isinstance(result, dict) else str(result)
    return [{"json": {"content": text, "summary": text, "text": text, "vendor": PARAMS.get("agentVendor"), "tools": tools}}]
except Exception as exc:
    print(f"[reference] agent live loop skipped: {exc}")
    return [{"json": {"content": str(goal), "summary": str(goal), "tools": tools, "mode": "offline_sample"}}]`.trim();
  }

  if (family === "rag") {
    return `
query = PARAMS.get("query") or PARAMS.get("queryTemplate") or first_json(items).get("question") or ""
docs = rows_from_items(items)
# Cosine / keyword retrieve — Studio runtime uses embeddings when retrieveMode=vector
ranked = docs[: int(PARAMS.get("topK") or 5)]
context = "\\n\\n".join(str(d.get("pageContent") or d.get("text") or d) for d in ranked)
return [{"json": {"query": query, "context": context, "matches": ranked, "text": context}}]`.trim();
  }

  if (family === "embedding") {
    return `
texts = [str(r.get("text") or r.get("pageContent") or r) for r in rows_from_items(items)] or [str(PARAMS.get("text") or "")]
return [{"json": {"texts": texts, "provider": PARAMS.get("provider"), "model": PARAMS.get("model"), "dim": None, "mode": "reference"}}]`.trim();
  }

  if (family === "tool") {
    return `
name = str(PARAMS.get("tool") or PARAMS.get("name") or "lookup")
payload = first_json(items)
print(f"[reference] tool {name} payload={payload}")
return [{"json": {"tool": name, "ok": True, **payload}}]`.trim();
  }

  if (family === "objectstore") {
    const bucket = cfgStr(cfg, ["bucket", "container"], "lake");
    const key = cfgStr(cfg, ["key", "objectKey", "path", "prefix"], "");
    return `
bucket = ${pyLiteral(bucket)}
key = PARAMS.get("key") or PARAMS.get("path") or ${pyLiteral(key)}
rows = rows_from_items(items)
op = ${pyLiteral(suffix)}
print(f"[reference] {TYPE} {op} s3://{bucket}/{key} rows={len(rows)}")
# Live: boto3 / google.cloud.storage / azure.storage.blob using connector creds
return [{"json": {"op": op, "bucket": bucket, "key": key, "rowCount": len(rows), "ok": True}}]`.trim();
  }

  if (family === "spark") {
    return sparkExecute(t, cfg);
  }

  if (family === "airflow") {
    return airflowExecute(t, cfg);
  }

  if (family === "prefect") {
    return prefectExecute(t, cfg);
  }

  if (family === "orchestrator") {
    return `
# Dagster / Temporal / NiFi / dbt — list endpoints become one item per object
cfg = connector_config(ctx, PARAMS.get("connectorId"))
base = str(cfg.get("baseUrl") or cfg.get("apiUrl") or "").rstrip("/")
op = ${pyLiteral(suffix)}
name = PARAMS.get("deploymentName") or PARAMS.get("name") or PARAMS.get("jobName") or PARAMS.get("flowName")
if op in ("listDeployments", "list", "listJobs", "listFlows") and base:
    path = "/api/deployments/" if "prefect" in TYPE else "/graphql"
    body = http_json(base.rstrip("/") + path, headers={"Accept": "application/json"})
    rows = body if isinstance(body, list) else body.get("results") or body.get("deployments") or body.get("jobs") or []
    return items_from_rows(rows if isinstance(rows, list) else [body])
print(f"[reference] {TYPE} orchestrator op={op} name={name}")
return [{"json": {"ok": True, "op": TYPE, "name": name, "status": "reference"}}]`.trim();
  }

  if (family === "stream") {
    return `
topic = PARAMS.get("topic") or PARAMS.get("resourceName") or "events"
rows = rows_from_items(items)
print(f"[reference] {TYPE} topic={topic} records={len(rows)}")
return items_from_rows(rows or [{"topic": topic, "ok": True}])`.trim();
  }

  if (family === "cache") {
    return `
key = PARAMS.get("key") or PARAMS.get("resourceName") or "cache:key"
print(f"[reference] Redis {TYPE} key={key}")
return [{"json": {"key": key, "op": ${pyLiteral(suffix)}, "ok": True}}]`.trim();
  }

  if (family === "search") {
    return `
query = PARAMS.get("query") or PARAMS.get("q") or {"match_all": {}}
print(f"[reference] Elasticsearch {TYPE} query={query}")
# Live _search → flatten hits.hits._source into n8n items
return [{"json": {"op": ${pyLiteral(suffix)}, "query": query, "mode": "offline_sample"}}]`.trim();
  }

  if (family === "graph") {
    return `
cypher = PARAMS.get("cypher") or PARAMS.get("query") or "RETURN 1 AS ok"
print(f"[reference] Neo4j {TYPE} cypher={cypher}")
return [{"json": {"cypher": cypher, "ok": True}}]`.trim();
  }

  if (family === "rest") {
    const url = cfgStr(cfg, ["url", "endpoint"], "https://httpbin.org/get");
    const method = cfgStr(cfg, ["method"], "GET");
    return `
url = str(PARAMS.get("url") or ${pyLiteral(url)})
method = str(PARAMS.get("method") or ${pyLiteral(method)}).upper()
body = PARAMS.get("body")
if body is None and method in ("POST", "PUT", "PATCH"):
    body = rows_from_items(items)
try:
    import json, urllib.request
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json"})
    raw = urllib.request.urlopen(req).read()
    parsed = json.loads(raw)
    rows = parsed if isinstance(parsed, list) else (parsed.get("data") or parsed.get("items") or [parsed])
    if isinstance(rows, dict):
        rows = [rows]
    return items_from_rows(rows)
except Exception as exc:
    print(f"[reference] REST {method} {url} skipped: {exc}")
    return [{"json": {"url": url, "method": method, "ok": False, "error": str(exc)}}]`.trim();
  }

  if (family === "file") {
    return `
path = PARAMS.get("path") or PARAMS.get("file") or "data.csv"
fmt = str(PARAMS.get("format") or "csv").lower()
print(f"[reference] file {TYPE} path={path} format={fmt}")
return [{"json": {"path": path, "format": fmt, "ok": True}}]`.trim();
  }

  if (family === "transform") {
    return `
rows = rows_from_items(items)
ops = PARAMS.get("operations") or PARAMS.get("ops") or []
# Studio runtime applies expression DSL (filter / map / pick / rename). Offline: pass-through.
print(f"[reference] transform {len(rows)} rows ops={ops!r}")
return items_from_rows(rows)`.trim();
  }

  if (family === "code") {
    const script =
      cfgStr(cfg, ["script", "source", "code", "dynamicCode"]) ||
      "def run(stages, ctx):\n    rows = next(iter(stages.values()), [])\n    return rows\n";
    return `
stages = {k: rows_from_items(items) for k in (INPUTS or ["stage.in"])}
ns = {"stages": stages, "ctx": ctx, "items": items, "result": None, "__builtins__": __builtins__}
exec(${pyLiteral(script)}, ns, ns)
result = ns["run"](stages, ctx) if callable(ns.get("run")) else ns.get("result")
if result is None:
    result = rows_from_items(items)
if isinstance(result, list):
    return items_from_rows(result)
if isinstance(result, dict):
    return [{"json": result}]
return [{"json": {"value": result}}]`.trim();
  }

  if (family === "notebook") {
    return `
# Notebook nodes execute # %% cells in a shared namespace (see Studio runner).
source = PARAMS.get("source") or ""
print(f"[reference] notebook {TYPE} cells={source.count('# %%') or 1}")
return items or [{"json": {"ok": True, "op": "notebook"}}]`.trim();
  }

  if (family === "control") {
    if (t === "if") {
      return `
condition = str(PARAMS.get("condition") or PARAMS.get("expression") or "True")
rows = rows_from_items(items)
env = {"items": rows, "item": rows[0] if rows else {}, "row_count": len(rows)}
try:
    matched = bool(eval(condition, {"__builtins__": {}}, env))  # noqa: S307 — reference only
except Exception:
    matched = True
print(f"[reference] IF {condition!r} => {matched}")
# n8n: pass items through so the next node still sees upstream rows
return items_from_rows(rows or [{"matched": matched, "condition": condition}])`.trim();
    }
    if (t === "loop") {
      return `
rows = rows_from_items(items)
print(f"[reference] LOOP over {len(rows)} items")
return items_from_rows(rows)`.trim();
    }
    if (t === "chat.reply") {
      return `
field = str(PARAMS.get("replyField") or "summary")
row = first_json(items)
text = str(row.get(field) or row.get("summary") or row.get("content") or row.get("text") or "")
return [{"json": {"reply": text, "text": text, "summary": text, "role": "assistant"}}]`.trim();
    }
    return `
rows = rows_from_items(items)
print(f"[reference] control {TYPE} passing {len(rows)} items")
return items_from_rows(rows or [{"op": TYPE, "ok": True}])`.trim();
  }

  return `
rows = rows_from_items(items)
print(f"[reference] {TYPE} generic plugin op — rows={len(rows)} params={list(PARAMS)}")
return items_from_rows(rows or [{"op": TYPE, "ok": True, "mode": "offline_sample"}])`.trim();
}

function nodeDocstring(node: FlowNode, cfg: Record<string, unknown>): string {
  const title = node.label ?? node.id;
  const lines = [
    `${title} — ${node.type}`,
    "",
    "Tool contract: this node is a function. Call execute(items, ctx) or __call__.",
    "tool_spec() is the description a workspace agent binds.",
    "n8n contract: execute(items, ctx) -> list[{json, binary?}]",
    "Flowise contract: first item json + text/summary for chat / IF.",
    `Category: ${node.category} · Connector: ${node.connector ?? "none"}`,
    `Inputs: ${(node.inputs ?? []).join(", ") || "(none)"}`,
    `Outputs: ${(node.outputs ?? []).join(", ") || "(none)"}`,
  ];
  const hint = cfgStr(cfg, ["sql", "query", "collection", "url", "userPrompt", "intentText"]);
  if (hint) lines.push(`Hint: ${hint.slice(0, 180)}`);
  return lines.join("\n");
}

export function generateNodeClass(
  node: FlowNode,
  opts?: { overlay?: string },
): string {
  if (opts?.overlay?.trim()) return opts.overlay.trim();
  const cfg = flattenNodeConfig(node.config);
  const cls = pythonClassName(node);
  const params = { ...cfg };
  delete params.dynamicCode;
  const doc = nodeDocstring(node, cfg).replace(/\\/g, "\\\\").replace(/"""/g, "'''");
  const body = executeBody(node, cfg);
  return `class ${cls}:
    """${doc}"""

    TYPE = ${pyLiteral(node.type)}
    DISPLAY_NAME = ${pyLiteral(node.label ?? node.id)}
    GROUP = ${pyLiteral(node.category)}
    CONNECTOR = ${pyLiteral(node.connector ?? null)}
    INPUTS = ${pyLiteral(node.inputs ?? [])}
    OUTPUTS = ${pyLiteral(node.outputs ?? [])}
    PARAMS = ${pyLiteral(params)}
    DESCRIPTION = {
        "displayName": ${pyLiteral(node.label ?? node.id)},
        "name": ${pyLiteral(node.type)},
        "group": [${pyLiteral(node.category)}],
        "inputs": ${pyLiteral((node.inputs ?? []).length ? ["main"] : [])},
        "outputs": ["main"],
        "properties": ${pyLiteral(Object.keys(params))},
    }

    def execute(self, items, ctx):
        PARAMS, TYPE, INPUTS, CONNECTOR = self.PARAMS, self.TYPE, self.INPUTS, self.CONNECTOR
        items = items or []
${indent(body, 8)}

    def _run(self, **kwargs):
        """CrewAI BaseTool / Oracle structured-tool entry → n8n execute(items)."""
        ctx = kwargs.pop("ctx", None) or {}
        items = kwargs.pop("items", None)
        if items is None:
            items = items_from_rows([kwargs] if kwargs else [])
        return self.execute(items, ctx)

    def __call__(self, items=None, ctx=None, **kwargs):
        """Call this node like a function."""
        return self._run(items=items, ctx=ctx, **kwargs)

    def tool_spec(self):
        """Tool card the workspace agent can show or bind."""
        props = {key: {"type": "string", "description": key} for key in self.PARAMS}
        return {
            "type": "function",
            "function": {
                "name": str(self.TYPE).replace(".", "_"),
                "description": f"{self.DISPLAY_NAME} ({self.TYPE})",
                "parameters": {"type": "object", "properties": props},
            },
        }
`;
}

export const RUNTIME_PY = `from typing import Any


def items_from_rows(rows: list[Any] | None) -> list[dict]:
    """n8n items[] from plain dict rows."""
    out: list[dict] = []
    for row in rows or []:
        if isinstance(row, dict) and set(row) <= {"json", "binary", "pairedItem", "paired_item"}:
            out.append(row if "json" in row else {"json": row})
        elif isinstance(row, dict):
            out.append({"json": row})
        else:
            out.append({"json": {"value": row}})
    return out


def rows_from_items(items: list[Any] | None) -> list[dict]:
    """Unwrap n8n items or Flowise {json, text} / tabular rows."""
    if not items:
        return []
    if isinstance(items, dict):
        if isinstance(items.get("rows"), list):
            return [r for r in items["rows"] if isinstance(r, dict)]
        if isinstance(items.get("items"), list):
            return rows_from_items(items["items"])
        if isinstance(items.get("json"), dict):
            return [items["json"]]
        return [items]
    rows: list[dict] = []
    for it in items:
        if isinstance(it, dict) and isinstance(it.get("json"), dict):
            rows.append(it["json"])
        elif isinstance(it, dict):
            rows.append(it)
        else:
            rows.append({"value": it})
    return rows


def first_json(items: list[Any] | None) -> dict:
    rows = rows_from_items(items)
    return rows[0] if rows else {}


def topological_sort(node_ids: list[str], edges: list[dict]) -> list[str]:
    incoming = {i: 0 for i in node_ids}
    adj = {i: [] for i in node_ids}
    for e in edges:
        src, tgt = e.get("source"), e.get("target")
        if src in adj and tgt in incoming:
            adj[src].append(tgt)
            incoming[tgt] += 1
    queue = [i for i, n in incoming.items() if n == 0]
    order: list[str] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            incoming[nxt] -= 1
            if incoming[nxt] == 0:
                queue.append(nxt)
    for i in node_ids:
        if i not in order:
            order.append(i)
    return order


def connector_config(ctx: dict, connector_id: str | None = None) -> dict:
    """n8n credential / Oracle tool connection lookup."""
    connectors = ctx.get("connectors") or {}
    if connector_id and isinstance(connectors, dict) and connector_id in connectors:
        bundle = connectors[connector_id]
    elif isinstance(connectors, dict) and connectors:
        bundle = next(iter(connectors.values()))
    else:
        bundle = {}
    if not isinstance(bundle, dict):
        return {}
    cfg = dict(bundle.get("config") or {})
    secret = ctx.get("secrets") or {}
    ref = bundle.get("secretRef") or bundle.get("secret_ref")
    blob = secret.get(ref) if ref else None
    if isinstance(blob, str) and blob.startswith("{"):
        try:
            blob = json.loads(blob)
        except Exception:
            blob = None
    if isinstance(blob, dict):
        cfg = {**blob, **cfg}
    return cfg


def http_json(url: str, method: str = "GET", headers: dict | None = None, body: Any = None, timeout: float = 60):
    """Flowise/n8n HTTP helper used by Airflow / Spark REST nodes."""
    import urllib.error
    import urllib.request

    data = None if body is None else json.dumps(body).encode()
    hdrs = dict(headers or {"Accept": "application/json"})
    if body is not None and not any(k.lower() == "content-type" for k in hdrs):
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=data, method=method.upper(), headers=hdrs
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"HTTP {exc.code} {method} {url}: {detail}") from exc
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {"raw": raw.decode("utf-8", "replace")[:4000]}


def spark_rest_base(cfg: dict, master: str = "") -> str:
    """Standalone Spark REST (spark://host:7077 → http://host:6066) or explicit restUrl."""
    import os
    import re

    explicit = (
        (cfg or {}).get("restUrl")
        or (cfg or {}).get("sparkUrl")
        or os.environ.get("SPARK_REST_URL")
        or master
    )
    text = str(explicit or "").rstrip("/")
    if text.startswith("http://") or text.startswith("https://"):
        return text
    match = re.match(r"spark://([^:/]+)", text)
    if match:
        return f"http://{match.group(1)}:6066"
    return ""
`;

function connectorLiteral(connectors: ConnectorRef[]): string {
  return pyLiteral(
    connectors.map((c) => ({
      id: c.id,
      type: c.type,
      label: c.label ?? c.id,
      secretRef: c.secretRef ?? null,
      config: c.config ?? {},
    })),
  );
}

export function generateWorkflowPython(
  document: WorkspaceDocument,
  overlays?: Record<string, NodeCodeOverlay>,
): string {
  const nodes = document.flow.nodes;
  if (nodes.length === 0) {
    return `# Auto-generated by Agent Studio — empty canvas.
# Add nodes on the workflow canvas; this file updates automatically.
print("No nodes on the canvas yet.")
`;
  }

  const classes = nodes.map((node) => {
    const overlay = overlays?.[node.id];
    const use =
      overlay && overlay.fingerprint === nodeFingerprint(node)
        ? overlay.source
        : undefined;
    return generateNodeClass(node, { overlay: use });
  });

  const nodeMap = nodes
    .map((n) => `    ${pyLiteral(n.id)}: ${pythonClassName(n)},`)
    .join("\n");

  const edges = pyLiteral(
    document.flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  );

  const order = topoIds(nodes, document.flow.edges);
  const name = document.workspace.name;

  return `"""Agent Studio — downloadable workflow reference

Workspace: ${name}
Id: ${document.workspace.id}
Generated from the canvas (n8n execute + Flowise json/text).

How to reuse later
------------------
1. Download this file from the Python tab (or copy nodes/*.py sections).
2. Each class is one tool. Call \`node(items, ctx)\` or \`execute(items, ctx)\`.
   \`tool_spec()\` is the function description for an agent runtime.
3. Downstream nodes read \`items[0]["json"]\` (n8n \`$json\`) or Flowise
   \`text\` / \`summary\` on the first item.
4. Plug credentials into \`ctx["connectors"]\` / env vars — never commit secrets.
5. \`list_tools()\` shows every node. \`call_tool(node_id, items)\` runs one
   node when you ask. Nothing runs until you call it.
   Agent Studio Run still uses the materialized \`run_workflow.py\` executor.
"""
from __future__ import annotations

import json
${RUNTIME_PY}

WORKSPACE = ${pyLiteral(name)}
WORKSPACE_ID = ${pyLiteral(document.workspace.id)}
CONNECTORS = ${connectorLiteral(document.connectors)}
EDGES = ${edges}
GRAPH_ORDER = ${pyLiteral(order)}

${classes.join("\n\n")}

NODES = {
${nodeMap}
}


def list_tools():
    """Every node on this canvas, as a callable tool."""
    return [cls().tool_spec() for cls in NODES.values()]


def call_tool(node_id, items=None, ctx=None, **kwargs):
    """Run one node, only when the caller asks for that tool."""
    if node_id not in NODES:
        raise KeyError(f"No tool named {node_id!r}. Known: {', '.join(NODES)}")
    return NODES[node_id]()(items, ctx, **kwargs)


def run_agent(ctx=None, goal=None, node_ids=None):
    """List tools. Call a node only when node_ids names it. Otherwise call nothing."""
    ctx = dict(ctx or {})
    if goal:
        ctx["goal"] = goal
    called = {}
    for nid in node_ids or []:
        called[nid] = call_tool(nid, ctx=ctx)
    return {"tools": list_tools(), "called": called}


def run_workflow(ctx=None):
    ctx = dict(ctx or {})
    ctx.setdefault("connectors", {c["id"]: c for c in CONNECTORS})
    ctx.setdefault("runtime", "reference")
    order = topological_sort(list(NODES), EDGES)
    outputs = {}
    incoming = {nid: [] for nid in NODES}
    for edge in EDGES:
        incoming[edge["target"]].append(edge["source"])
    for nid in order:
        srcs = incoming.get(nid) or []
        items = []
        for sid in srcs:
            items.extend(outputs.get(sid) or [])
        node = NODES[nid]()
        print(f"→ {node.DISPLAY_NAME} ({node.TYPE})")
        outputs[nid] = node.execute(items, ctx)
    return outputs


if __name__ == "__main__":
    # Do not run the graph. The caller decides which tool to invoke.
    print("Tools ready. call_tool(node_id, items) runs one node when you choose.")
    print(json.dumps(list_tools(), default=str)[:2000])
`;
}

export function generateNodeModule(node: FlowNode, overlay?: string): string {
  return `"""Standalone n8n/Flowise-style node — ${node.label ?? node.id} (${node.type})."""
from __future__ import annotations

import json
${RUNTIME_PY}

${generateNodeClass(node, { overlay })}

if __name__ == "__main__":
    node = ${pythonClassName(node)}()
    print("Tool ready. Call node(items, ctx) when you want it to run.")
    print(json.dumps(node.tool_spec(), default=str, indent=2)[:2000])
`;
}

function cellsToIpynb(cells: NotebookCell[], title: string): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python", version: "3.11" },
      studio: { title, kind: "workflow-reference" },
    },
    cells: cells.map((c) => {
      const src = c.source.endsWith("\n") ? c.source : `${c.source}\n`;
      if (c.cell_type === "markdown") {
        return { cell_type: "markdown", metadata: {}, source: src.split(/(?<=\n)/) };
      }
      return {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: src.split(/(?<=\n)/),
      };
    }),
  };
  return `${JSON.stringify(nb, null, 2)}\n`;
}

export function generateWorkflowNotebook(
  document: WorkspaceDocument,
  overlays?: Record<string, NodeCodeOverlay>,
): NotebookCell[] {
  const nodes = document.flow.nodes;
  if (nodes.length === 0) return [];

  const cells: NotebookCell[] = [
    {
      id: "workflow-overview",
      cell_type: "markdown",
      status: "idle",
      source: `# ${document.workspace.name}

Auto-generated **reference notebook** from the canvas (Flowise + n8n style).

- Each node is a Python class with \`execute(items, ctx)\` → \`[{json: row}]\`.
- Edit the **canvas** to regenerate these cells. Download from the Notebook toolbar for later.
- Agent Studio **Run** still executes the materialized \`run_workflow.py\`.

\`\`\`mermaid
${mermaid(document)}
\`\`\`
`,
    },
    {
      id: "workflow-runtime",
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `# Shared runtime (n8n items + Flowise json/text helpers)
from __future__ import annotations
import json
${RUNTIME_PY}
CTX = {"runtime": "reference", "connectors": {c["id"]: c for c in ${connectorLiteral(document.connectors)}}}
print("runtime ready")
`,
    },
  ];

  for (const node of nodes) {
    const overlay = overlays?.[node.id];
    const use =
      overlay && overlay.fingerprint === nodeFingerprint(node)
        ? overlay.source
        : undefined;
    const cls = pythonClassName(node);
    cells.push({
      id: `${GENERATED_NOTEBOOK_MD_PREFIX}${node.id}`,
      cell_type: "markdown",
      status: "idle",
      source: `## ${node.label ?? node.id}

\`${node.type}\` · in: \`${(node.inputs ?? []).join(", ") || "—"}\` · out: \`${(node.outputs ?? []).join(", ") || "—"}\`

n8n: this cell defines the node class and runs \`execute\` on upstream \`items\`. Flowise: read \`result[0]["json"]\` (or \`.get("text")\`).
`,
    });
    cells.push({
      id: `${GENERATED_NOTEBOOK_CELL_PREFIX}${node.id}`,
      cell_type: "code",
      status: "idle",
      execution_count: null,
      source: `${generateNodeClass(node, { overlay: use })}
# Upstream items: replace [] with the previous cell's result
result = ${cls}().execute([], CTX)
result
`,
    });
  }

  cells.push({
    id: "workflow-runner",
    cell_type: "code",
    status: "idle",
    execution_count: null,
    source: `# Run every node in canvas order (same as the Python tab)
# Prefer Agent Studio Run on the canvas for live connectors + stage cache.
print("Node classes are defined in the cells above. Call Node_<id>().execute(items, CTX).")
`,
  });
  return cells;
}

export function generateWorkflowCodeLab(
  document: WorkspaceDocument,
  overlays?: Record<string, NodeCodeOverlay>,
) {
  return {
    pythonSource: generateWorkflowPython(document, overlays),
    notebookCells: generateWorkflowNotebook(document, overlays),
  };
}

export function generateWorkflowExportFiles(
  document: WorkspaceDocument,
  overlays?: Record<string, NodeCodeOverlay>,
): Array<{ path: string; content: string }> {
  const slug = (document.workspace.id || "workspace").replace(/[^A-Za-z0-9._-]+/g, "_");
  const files: Array<{ path: string; content: string }> = [
    {
      path: `${slug}/README.md`,
      content: `# ${document.workspace.name} — reference export

n8n-style \`execute(items)\` + Flowise \`json\`/\`text\` Python generated from the Agent Studio canvas.

- \`workflow.py\` — full graph, runnable offline
- \`nodes/<id>.py\` — one file per canvas node
- \`notebooks/workflow.ipynb\` — one cell per node

Do not commit secrets. Connector secret refs are names only.
`,
    },
    {
      path: `${slug}/workflow.py`,
      content: generateWorkflowPython(document, overlays),
    },
    {
      path: `${slug}/notebooks/workflow.ipynb`,
      content: cellsToIpynb(
        generateWorkflowNotebook(document, overlays),
        document.workspace.name,
      ),
    },
  ];
  for (const node of document.flow.nodes) {
    const overlay = overlays?.[node.id];
    const src =
      overlay && overlay.fingerprint === nodeFingerprint(node)
        ? overlay.source
        : undefined;
    files.push({
      path: `${slug}/nodes/${node.id}.py`,
      content: generateNodeModule(node, src),
    });
  }
  return files;
}

export function notebookToIpynb(
  cells: NotebookCell[],
  title = "workflow",
): string {
  return cellsToIpynb(cells, title);
}
