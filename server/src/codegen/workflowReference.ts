/**
 * Materialize downloadable n8n / Flowise / CrewAI-style node files next to the runner.
 * Spark + Airflow use the same execute(items) → [{json}] contract as the Python tab.
 */
import type { WorkspaceDocument } from "../types.js";

function py(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => py(v)).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${py(v)}`)
      .join(", ")}}`;
  }
  return "None";
}

function className(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9]+/g, "_");
  return `Node_${/^[A-Za-z]/.test(safe) ? safe : `n_${safe}`}`;
}

function cfgGet(cfg: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = cfg[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return fallback;
}

/** Shared helpers embedded once per node module (n8n items + REST). */
const HELPERS = `
def items_from_rows(rows):
    out = []
    for row in rows or []:
        out.append({"json": row} if isinstance(row, dict) else {"json": {"value": row}})
    return out

def rows_from_items(items):
    rows = []
    for it in items or []:
        if isinstance(it, dict) and isinstance(it.get("json"), dict):
            rows.append(it["json"])
        elif isinstance(it, dict):
            rows.append(it)
    return rows

def first_json(items):
    rows = rows_from_items(items)
    return rows[0] if rows else {}

def _http_json(url, method="GET", headers=None, body=None):
    import urllib.error, urllib.request
    data = None if body is None else json.dumps(body).encode()
    hdrs = dict(headers or {"Accept": "application/json"})
    if body is not None and not any(k.lower() == "content-type" for k in hdrs):
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method.upper(), headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
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

def _spark_parse_app_id(text):
    app_id = ""
    for line in (text or "").splitlines():
        for tok in line.replace(",", " ").replace(":", " ").split():
            if tok.startswith("app-") or tok.startswith("driver-") or tok.startswith("application_"):
                app_id = tok.strip().strip('"').strip("'")
                break
        if app_id:
            break
    return app_id
`;

function pluginExecuteBody(type: string, cfg: Record<string, unknown>): string {
  const suffix = type.split(".").pop() ?? type;

  // ── Spark (n8n Data Table / Databricks Jobs style) ─────────
  if (type === "spark.sql") {
    const sql = cfgGet(cfg, ["sql", "query"], "SELECT 1 AS ok");
    return `        sql = self.PARAMS.get("sql") or self.PARAMS.get("query") or ${py(sql)}
        from pyspark.sql import SparkSession
        spark = SparkSession.builder.appName("agent-studio-spark").master("local[*]").getOrCreate()
        lim = self.PARAMS.get("limit")
        df = spark.sql(str(sql))
        collected = df.limit(int(lim)).collect() if lim not in (None, "") else df.collect()
        rows = [r.asDict(recursive=True) for r in collected]
        return items_from_rows(rows)`;
  }
  if (type === "spark.read") {
    const path = cfgGet(cfg, ["path", "uri"], "/data/input");
    const fmt = cfgGet(cfg, ["format"], "parquet");
    return `        path = self.PARAMS.get("path") or self.PARAMS.get("uri") or ${py(path)}
        fmt = str(self.PARAMS.get("format") or ${py(fmt)}).lower()
        from pyspark.sql import SparkSession
        spark = SparkSession.builder.appName("agent-studio-spark-read").master("local[*]").getOrCreate()
        reader = spark.read.format(fmt)
        if fmt in ("csv", "json"):
            reader = reader.option("header", "true").option("inferSchema", "true")
        rows = [r.asDict(recursive=True) for r in reader.load(str(path)).collect()]
        return items_from_rows(rows)`;
  }
  if (type === "spark.write") {
    return `        rows = rows_from_items(items)
        if not rows:
            raise RuntimeError("spark.write needs upstream n8n items[{json}]")
        path = self.PARAMS.get("path") or self.PARAMS.get("uri") or "/data/out"
        table = self.PARAMS.get("table") or self.PARAMS.get("target")
        fmt = str(self.PARAMS.get("format") or "parquet").lower()
        mode = str(self.PARAMS.get("mode") or self.PARAMS.get("saveMode") or "overwrite")
        from pyspark.sql import SparkSession
        spark = SparkSession.builder.appName("agent-studio-spark-write").master("local[*]").getOrCreate()
        df = spark.createDataFrame(rows)
        if table:
            df.write.format(fmt).mode(mode).saveAsTable(str(table))
            dest = f"table:{table}"
        else:
            df.write.format(fmt).mode(mode).save(str(path))
            dest = path
        return [{"json": {"ok": True, "op": "write", "written": len(rows), "destination": dest, "format": fmt}}]`;
  }
  if (type === "spark.createTable") {
    const table = cfgGet(cfg, ["target", "table"], "spark_table");
    return `        table = self.PARAMS.get("target") or self.PARAMS.get("table") or ${py(table)}
        sql = str(self.PARAMS.get("sql") or self.PARAMS.get("ddl") or "").strip()
        if not sql:
            cols = self.PARAMS.get("definition") or self.PARAMS.get("columns") or "id BIGINT, name STRING"
            using = self.PARAMS.get("using") or "PARQUET"
            col_sql = str(cols) if str(cols).startswith("(") else f"({cols})"
            sql = f"CREATE TABLE IF NOT EXISTS {table} {col_sql} USING {using}"
        from pyspark.sql import SparkSession
        spark = SparkSession.builder.appName("agent-studio-spark-ddl").master("local[*]").getOrCreate()
        spark.sql(sql)
        return [{"json": {"ok": True, "op": "createTable", "table": table, "sql": sql}}]`;
  }
  if (type === "spark.submit") {
    const resource = cfgGet(cfg, ["appResource", "jarOrPy", "jobPath"], "jobs/app.py");
    return `        import os, shlex, subprocess
        resource = self.PARAMS.get("appResource") or self.PARAMS.get("jarOrPy") or ${py(resource)}
        master = str(self.PARAMS.get("master") or os.environ.get("SPARK_MASTER") or "local[*]")
        spark_bin = str(self.PARAMS.get("sparkSubmit") or os.environ.get("SPARK_SUBMIT") or "spark-submit")
        cmd = [spark_bin, "--master", master, "--deploy-mode", "client", "--name", "agent-studio", str(resource)]
        extra = self.PARAMS.get("appArgs")
        if extra:
            cmd.extend(shlex.split(str(extra)))
        proc = subprocess.run(cmd, capture_output=True, text=True)
        app_id = _spark_parse_app_id((proc.stdout or "") + chr(10) + (proc.stderr or "")) or None
        if proc.returncode != 0 and not app_id:
            raise RuntimeError((proc.stderr or proc.stdout or "")[-2000:] or f"spark-submit exit {proc.returncode}")
        # n8n / Databricks: next node binds $json.appId
        return [{"json": {"ok": True, "op": "submit", "appId": app_id, "applicationId": app_id, "appResource": resource, "returncode": proc.returncode}}]`;
  }
  if (type === "spark.jobStatus" || (type.startsWith("spark.") && suffix === "status")) {
    return `        import os
        row = first_json(items)
        app_id = self.PARAMS.get("appId") or row.get("appId") or row.get("applicationId")
        if not app_id:
            raise RuntimeError("spark.jobStatus needs appId (bind from spark.submit $json.appId)")
        rest = str(self.PARAMS.get("restUrl") or os.environ.get("SPARK_REST_URL") or "").rstrip("/")
        if not rest:
            raise RuntimeError("Set restUrl / SPARK_REST_URL (http://host:6066)")
        body = _http_json(f"{rest}/v1/submissions/status/{app_id}")
        return [{"json": {**(body if isinstance(body, dict) else {}), "appId": app_id, "applicationId": app_id, "op": "jobStatus", "ok": True}}]`;
  }
  if (type === "spark.cancel") {
    return `        import os
        row = first_json(items)
        app_id = self.PARAMS.get("appId") or row.get("appId") or row.get("applicationId")
        if not app_id:
            raise RuntimeError("spark.cancel needs appId")
        rest = str(self.PARAMS.get("restUrl") or os.environ.get("SPARK_REST_URL") or "").rstrip("/")
        if not rest:
            raise RuntimeError("Set restUrl / SPARK_REST_URL")
        body = _http_json(f"{rest}/v1/submissions/kill/{app_id}", method="POST", body={})
        return [{"json": {**(body if isinstance(body, dict) else {}), "appId": app_id, "op": "cancel", "ok": True}}]`;
  }
  if (type.startsWith("spark.")) {
    return `        return [{"json": {"ok": True, "op": self.TYPE, "params": self.PARAMS}}]`;
  }

  // ── Airflow (n8n Airflow node: REST /api/v1) ───────────────
  const afAuth = `        import base64, os, urllib.parse
        base = str(self.PARAMS.get("baseUrl") or os.environ.get("AIRFLOW_API_URL") or "").rstrip("/")
        if not base:
            raise RuntimeError("Airflow baseUrl / AIRFLOW_API_URL missing")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        token = self.PARAMS.get("token") or os.environ.get("AIRFLOW_API_TOKEN")
        user = self.PARAMS.get("username") or os.environ.get("AIRFLOW_USERNAME")
        password = self.PARAMS.get("password") or os.environ.get("AIRFLOW_PASSWORD")
        if not base.endswith(("/api/v1", "/api/v2")):
            # Airflow 3.x serves /api/v2, Airflow 2.x /api/v1
            api_version = str(self.PARAMS.get("apiVersion") or os.environ.get("AIRFLOW_API_VERSION") or "").strip()[:1]
            if not api_version:
                try:
                    _http_json(base + "/api/v2/version", headers=headers)
                    api_version = "3"
                except Exception:
                    api_version = "2"
            base = base + ("/api/v2" if api_version == "3" else "/api/v1")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif user and base.endswith("/api/v2"):
            login = _http_json(base[: -len("/api/v2")] + "/auth/token", "POST", headers, {"username": user, "password": password or ""})
            headers["Authorization"] = f"Bearer {login.get('access_token')}"
        elif user:
            headers["Authorization"] = "Basic " + base64.b64encode(f"{user}:{password or ''}".encode()).decode()`;

  if (type === "airflow.listDags") {
    return `${afAuth}
        query = {"limit": int(self.PARAMS.get("limit") or 100), "offset": int(self.PARAMS.get("offset") or 0)}
        if self.PARAMS.get("onlyActive") is not None:
            query["only_active"] = str(bool(self.PARAMS.get("onlyActive"))).lower()
        body = _http_json(base + "/dags?" + urllib.parse.urlencode(query), headers=headers)
        dags = body.get("dags") if isinstance(body, dict) else body
        # One n8n item per DAG → downstream $json.dag_id
        return items_from_rows(dags if isinstance(dags, list) else [])`;
  }
  if (type === "airflow.triggerDag") {
    const dagId = cfgGet(cfg, ["dagId"], "example_dag");
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id") or row.get("dagId") or ${py(dagId)}
        conf = self.PARAMS.get("conf") or {}
        if isinstance(conf, str) and conf.strip():
            conf = json.loads(conf)
        payload = {"conf": conf if isinstance(conf, dict) else {}}
        if self.PARAMS.get("dagRunId"):
            payload["dag_run_id"] = self.PARAMS.get("dagRunId")
        logical_date = self.PARAMS.get("logicalDate") or self.PARAMS.get("logical_date")
        if logical_date:
            payload["logical_date"] = logical_date
        if base.endswith("/api/v2"):
            payload.setdefault("logical_date", None)  # required field on Airflow 3
        body = _http_json(f"{base}/dags/{dag_id}/dagRuns", method="POST", headers=headers, body=payload)
        # Flatten for n8n $json.dag_run_id (Flowise / CrewAI bind the same fields)
        return [{"json": {**(body if isinstance(body, dict) else {}), "dag_id": dag_id, "dagId": dag_id, "dag_run_id": (body or {}).get("dag_run_id"), "dagRunId": (body or {}).get("dag_run_id"), "op": "triggerDag", "ok": True}}]`;
  }
  if (type === "airflow.dagStatus") {
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id") or row.get("dagId")
        run_id = self.PARAMS.get("dagRunId") or row.get("dag_run_id") or row.get("dagRunId")
        if not dag_id or not run_id:
            raise RuntimeError("airflow.dagStatus needs dagId + dagRunId (bind from triggerDag)")
        body = _http_json(f"{base}/dags/{dag_id}/dagRuns/{run_id}", headers=headers)
        return [{"json": {**(body if isinstance(body, dict) else {}), "dag_id": dag_id, "dagId": dag_id, "dag_run_id": run_id, "dagRunId": run_id, "op": "dagStatus", "ok": True}}]`;
  }
  if (type === "airflow.pauseDag") {
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id") or row.get("dagId")
        paused = bool(self.PARAMS.get("isPaused") if self.PARAMS.get("isPaused") is not None else True)
        body = _http_json(f"{base}/dags/{dag_id}", method="PATCH", headers=headers, body={"is_paused": paused})
        return [{"json": {**(body if isinstance(body, dict) else {}), "dag_id": dag_id, "is_paused": paused, "op": "pauseDag", "ok": True}}]`;
  }
  if (type === "airflow.clearTask") {
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id") or row.get("dagId")
        task_id = self.PARAMS.get("taskId")
        payload = {
            "dry_run": bool(self.PARAMS.get("dryRun") or False),
            "only_failed": bool(self.PARAMS.get("onlyFailed") or False),
            "only_running": bool(self.PARAMS.get("onlyRunning") or False),
            "reset_dag_runs": bool(self.PARAMS.get("resetDagRuns") if self.PARAMS.get("resetDagRuns") is not None else True),
        }
        if task_id:
            payload["task_ids"] = [task_id]
        body = _http_json(f"{base}/dags/{dag_id}/clearTaskInstances", method="POST", headers=headers, body=payload)
        return [{"json": {**(body if isinstance(body, dict) else {}), "dag_id": dag_id, "taskId": task_id, "op": "clearTask", "ok": True}}]`;
  }
  if (type === "airflow.xcomPull") {
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id")
        task_id = self.PARAMS.get("taskId") or row.get("task_id")
        run_id = self.PARAMS.get("dagRunId") or row.get("dag_run_id")
        key = self.PARAMS.get("xcomKey") or self.PARAMS.get("key") or "return_value"
        body = _http_json(f"{base}/dags/{dag_id}/dagRuns/{run_id}/taskInstances/{task_id}/xcomEntries/{key}", headers=headers)
        value = body.get("value") if isinstance(body, dict) else body
        return [{"json": {**(body if isinstance(body, dict) else {"value": value}), "value": value, "xcomKey": key, "dag_id": dag_id, "op": "xcomPull", "ok": True}}]`;
  }
  if (type === "airflow.xcomPush") {
    return `${afAuth}
        row = first_json(items)
        dag_id = self.PARAMS.get("dagId") or row.get("dag_id")
        task_id = self.PARAMS.get("taskId") or row.get("task_id")
        run_id = self.PARAMS.get("dagRunId") or row.get("dag_run_id")
        key = self.PARAMS.get("xcomKey") or self.PARAMS.get("key") or "return_value"
        value = self.PARAMS.get("value")
        if value is None:
            value = row.get("value", row)
        body = _http_json(f"{base}/dags/{dag_id}/dagRuns/{run_id}/taskInstances/{task_id}/xcomEntries", method="POST", headers=headers, body={"key": key, "value": value})
        return [{"json": {**(body if isinstance(body, dict) else {}), "xcomKey": key, "dag_id": dag_id, "op": "xcomPush", "ok": True}}]`;
  }
  if (type === "airflow.importVariables") {
    return `${afAuth}
        name = self.PARAMS.get("variableName") or self.PARAMS.get("name") or self.PARAMS.get("key")
        if not name:
            raise RuntimeError("airflow.importVariables needs variableName")
        patch_body = {"key": name, "value": self.PARAMS.get("value")}
        try:
            body = _http_json(f"{base}/variables/{name}", method="PATCH", headers=headers, body=patch_body)
            action = "updated"
        except RuntimeError as exc:
            if "HTTP 404" not in str(exc):
                raise
            body = _http_json(f"{base}/variables", method="POST", headers=headers, body=patch_body)
            action = "created"
        return [{"json": {**(body if isinstance(body, dict) else {"key": name}), "op": "importVariables", "action": action, "ok": True}}]`;
  }
  if (type.startsWith("airflow.")) {
    return `        return [{"json": {"ok": True, "op": self.TYPE, "dagId": self.PARAMS.get("dagId")}}]`;
  }

  // ── Prefect (flat $json.flow_run_id like n8n / Airflow dag_run_id) ──
  const pfAuth = `        import os
        base = str(self.PARAMS.get("apiUrl") or os.environ.get("PREFECT_API_URL") or "").rstrip("/")
        if not base:
            raise RuntimeError("Prefect apiUrl / PREFECT_API_URL missing")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        token = self.PARAMS.get("apiKey") or os.environ.get("PREFECT_API_KEY")
        if token:
            headers["Authorization"] = f"Bearer {token}"`;

  if (type === "prefect.listDeployments") {
    return `${pfAuth}
        body = _http_json(base + "/deployments/filter", method="POST", headers=headers, body={"limit": int(self.PARAMS.get("limit") or 50)})
        rows = body if isinstance(body, list) else (body.get("deployments") if isinstance(body, dict) else [])
        return items_from_rows(rows if isinstance(rows, list) else [])`;
  }
  if (type === "prefect.triggerDeployment") {
    return `${pfAuth}
        row = first_json(items)
        deployment_id = self.PARAMS.get("deploymentId") or row.get("id") or row.get("deploymentId")
        body = _http_json(
            f"{base}/deployments/{deployment_id}/create_flow_run",
            method="POST",
            headers=headers,
            body={"parameters": self.PARAMS.get("parameters") or {}, "state": {"type": "SCHEDULED"}},
        )
        fr_id = (body or {}).get("id") if isinstance(body, dict) else None
        return [{"json": {**(body if isinstance(body, dict) else {}), "flow_run_id": fr_id, "flowRunId": fr_id, "id": fr_id, "deploymentId": deployment_id, "op": "triggerDeployment", "ok": True}}]`;
  }
  if (type === "prefect.runStatus") {
    return `${pfAuth}
        row = first_json(items)
        flow_run_id = self.PARAMS.get("flowRunId") or row.get("flow_run_id") or row.get("flowRunId") or row.get("id")
        if not flow_run_id:
            raise RuntimeError("prefect.runStatus needs flowRunId (bind from triggerDeployment)")
        body = _http_json(f"{base}/flow_runs/{flow_run_id}", headers=headers)
        return [{"json": {**(body if isinstance(body, dict) else {}), "flow_run_id": flow_run_id, "flowRunId": flow_run_id, "op": "runStatus", "ok": True}}]`;
  }
  if (type.startsWith("prefect.")) {
    return `        return [{"json": {"ok": True, "op": self.TYPE, "params": self.PARAMS}}]`;
  }
  return "";
}

export function buildReferenceNodePy(
  node: Record<string, unknown>,
): string {
  const id = String(node.id ?? "node");
  const type = String(node.type ?? "unknown");
  const label = String(node.label ?? id);
  const cls = className(id);
  const cfg = (node.config as Record<string, unknown> | undefined) ?? {};
  const specialized = pluginExecuteBody(type, cfg);
  const execute =
    specialized ||
    `        items = items or []
        rows = rows_from_items(items)
        print(f"[reference] {self.TYPE} in={len(rows)} params={list(self.PARAMS)}")
        if rows:
            return items_from_rows(rows)
        return [{"json": {"op": self.TYPE, "ok": True, "params": self.PARAMS, "mode": "offline_sample"}}]`;
  return `"""${label} — ${type}

Standards:
  n8n: execute(items, ctx) -> [{json: row}]  ($json field binding)
  Flowise: first item json + text/summary
  CrewAI / Oracle Agent: _run(**kwargs) → execute
"""
from __future__ import annotations
import json
${HELPERS}

class ${cls}:
    TYPE = ${py(type)}
    DISPLAY_NAME = ${py(label)}
    CONNECTOR = ${py(node.connector ?? null)}
    INPUTS = ${py(node.inputs ?? [])}
    OUTPUTS = ${py(node.outputs ?? [])}
    PARAMS = ${py(cfg)}

    def execute(self, items, ctx):
        items = items or []
${execute}

    def _run(self, **kwargs):
        """CrewAI Tool / Oracle Agent Studio entrypoint."""
        ctx = kwargs.pop("ctx", None) or {}
        items = kwargs.pop("items", None)
        if items is None:
            items = [{"json": kwargs}] if kwargs else []
        return self.execute(items, ctx)


if __name__ == "__main__":
    print(${cls}().execute([], {}))
`;
}

export function buildWorkflowReferencePy(document: WorkspaceDocument): string {
  const classes = document.flow.nodes.map((n) => buildReferenceNodePy(n)).join("\n\n");
  const map = document.flow.nodes
    .map((n) => `    ${py(n.id)}: ${className(String(n.id ?? "node"))},`)
    .join("\n");
  return `"""Canvas reference export for ${document.workspace.name}.

Spark + Airflow nodes use n8n execute(items) → [{json}] (same as Studio Python tab).
"""
from __future__ import annotations

${classes}

NODES = {
${map || "    "}
}

if __name__ == "__main__":
    for nid, cls in NODES.items():
        print(nid, cls().execute([], {}))
`;
}

export function buildWorkflowReferenceNotebook(document: WorkspaceDocument): string {
  const cells: Array<Record<string, unknown>> = [
    {
      cell_type: "markdown",
      metadata: {},
      source: `# ${document.workspace.name}\n\nReference notebook — n8n items / Flowise json / CrewAI _run. One cell per canvas node.\n`,
    },
  ];
  for (const node of document.flow.nodes) {
    const id = String(node.id ?? "node");
    cells.push({
      cell_type: "markdown",
      metadata: {},
      source: `## ${String(node.label ?? id)}\n\n\`${String(node.type)}\`\n`,
    });
    cells.push({
      cell_type: "code",
      execution_count: null,
      metadata: {},
      outputs: [],
      source: `${buildReferenceNodePy(node)}\nresult = ${className(id)}().execute([], {})\nresult\n`,
    });
  }
  return `${JSON.stringify(
    {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      },
      cells: cells.map((c) => {
        const src = String((c as { source: string }).source);
        const withNl = src.endsWith("\n") ? src : `${src}\n`;
        return { ...c, source: withNl.split(/(?<=\n)/) };
      }),
    },
    null,
    2,
  )}\n`;
}
