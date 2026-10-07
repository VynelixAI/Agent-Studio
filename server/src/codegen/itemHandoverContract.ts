/**
 * Shared n8n / Flowise / CrewAI / Oracle Agent Studio item handover contract.
 *
 * Live runner, Python-tab codegen, and downloadable reference files must agree:
 *   execute(items) → [{ json: row }]
 *   stage payload also exposes Flowise json + text/summary + handover: true
 *
 * Bindable ids live flat on $json (snake + camel). Nested REST envelopes are
 * never the sole handover — they are skipped when bind ids are present.
 */

/** Keys that mark a payload as already flattened for downstream bind. */
export const BIND_ID_KEYS = [
  "dag_id",
  "dagId",
  "dag_run_id",
  "dagRunId",
  "appId",
  "applicationId",
  "submissionId",
  "flow_run_id",
  "flowRunId",
] as const;

/** Dual aliases each family must emit on $json when the value is known. */
export const FAMILY_BIND_ALIASES = {
  airflow: {
    dag: ["dag_id", "dagId"],
    dagRun: ["dag_run_id", "dagRunId"],
    task: ["task_id", "taskId"],
  },
  spark: {
    app: ["appId", "applicationId"],
  },
  prefect: {
    flowRun: ["flow_run_id", "flowRunId", "id"],
    deployment: ["deploymentId", "deployment_id"],
  },
} as const;

/** Nested API bodies dropped from $json when bind ids are present. */
export const NESTED_ENVELOPE_KEYS = [
  "result",
  "body",
  "data",
  "flow_run",
  "dagRun",
  "output",
  "variable",
  "xcom",
  "submission",
  "application",
  "response",
  "cleared",
  "killed",
  "dags",
  "rows",
  "command",
  "cancel",
  "matched",
  "deployments",
  "work_pools",
] as const;

/** Meta / contract fields never copied into item rows as bind data. */
export const META_SKIP_KEYS = [
  "schema",
  "query",
  "previewRows",
  "dataRef",
  "storage",
  "kind",
  "items",
  "handover",
  "outputFiles",
  "json",
  "text",
  "summary",
] as const;

/** Collection fields expanded to one n8n item per element. */
export const ITEM_LIST_KEYS = [
  "rows",
  "items",
  "previewRows",
  "matched",
  "dags",
  "deployments",
  "jobs",
  "files",
  "records",
  "hits",
  "tables",
  "connections",
  "sources",
  "destinations",
  "workflows",
  "assets",
  "blobs",
  "objects",
  "documents",
  "events",
  "xcomEntries",
  "work_pools",
  "variables",
  "dag_runs",
  "flow_runs",
  "applications",
  "indices",
  "processors",
  "processGroups",
  "Contents",
] as const;

/** Nested unwrap keys tried after flat-bind preference. */
export const NESTED_UNWRAP_KEYS = [
  "result",
  "body",
  "data",
  "flow_run",
  "dagRun",
  "output",
  "variable",
  "value",
  "xcom",
] as const;

export const PAYLOAD_SHAPE_KEYS = [
  "items",
  "json",
  "text",
  "summary",
  "rows",
  "rowCount",
  "handover",
] as const;

export type BindIdKey = (typeof BIND_ID_KEYS)[number];

/** Format a Python tuple literal from string keys. */
export function pyStringTuple(keys: readonly string[]): string {
  if (keys.length === 0) return "()";
  if (keys.length === 1) return `(${JSON.stringify(keys[0])},)`;
  return `(${keys.map((k) => JSON.stringify(k)).join(", ")})`;
}

/** Format a Python set literal from string keys. */
export function pyStringSet(keys: readonly string[]): string {
  return `{${keys.map((k) => JSON.stringify(k)).join(", ")}}`;
}

/**
 * Python constants injected into run_workflow.py so `_flat_bind_row` /
 * `_ITEM_LIST_KEYS` stay aligned with this TypeScript contract.
 */
export function emitHandoverConstantsPy(): string {
  return `# n8n / Flowise / CrewAI item handover — generated from itemHandoverContract.ts
_ITEM_LIST_KEYS = ${pyStringTuple(ITEM_LIST_KEYS)}
_BIND_ID_KEYS = ${pyStringTuple(BIND_ID_KEYS)}
_NESTED_ENVELOPE_KEYS = ${pyStringSet([...META_SKIP_KEYS, ...NESTED_ENVELOPE_KEYS])}
_NESTED_UNWRAP_KEYS = ${pyStringTuple(NESTED_UNWRAP_KEYS)}
_META_SKIP_KEYS = ${pyStringSet(META_SKIP_KEYS)}
`;
}
