/**
 * Inspector schemas generated from plugin node kinds (loosely coupled).
 */

import type { NodeFieldDef, NodeSchema } from "@/core/nodeSchemas";
import { getPlugin, loadCustomPlugins } from "@/core/pluginCatalog";
import type { PluginNodeKind, PluginNodeSpec } from "@/core/pluginNodeCatalog";
import {
  customPluginNodes,
  getPluginCapability,
  pluginIdForNodeType,
} from "@/core/pluginNodeCatalog";
import {
  defaultModeForDbType,
  isStructuredDbNode,
  isStructuredDbQueryNode,
  isStructuredDbWriteNode,
  structuredDbQueryFields,
  structuredDbWriteFields,
} from "@/core/structuredDbNodes";

const FORMAT_OPTIONS = [
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "text", label: "Text" },
  { value: "raw", label: "Raw / binary" },
];

function stageIn(
  key = "__inputs",
  label = "Upstream stages",
  help = "Multi-select canvas node labels; stored as stage keys in YAML",
): NodeFieldDef {
  return {
    key,
    label,
    kind: "stage",
    section: "input",
    placeholder: "Select upstream nodes…",
    help,
  };
}

function stageOut(defaultKey?: string): NodeFieldDef {
  return {
    key: "__outputs",
    label: "Output stage key",
    kind: "stage",
    section: "output",
    placeholder: defaultKey ?? "stage.result",
    help: "Written for downstream nodes",
  };
}

function outFormat(defaultValue = "json"): NodeFieldDef {
  return {
    key: "outputFormat",
    label: "Output format",
    kind: "format",
    section: "output",
    options: FORMAT_OPTIONS,
    defaultValue,
  };
}

function fieldsForKind(
  kind: PluginNodeKind,
  spec: PluginNodeSpec,
): NodeFieldDef[] {
  const targetLabel = "Target (db / table / topic / path)";

  // All structured DB row producers share filter / projection / optional limit
  if (
    isStructuredDbQueryNode(spec.type) &&
    (kind === "query" || kind === "list" || kind === "schema" || kind === "stream")
  ) {
    return structuredDbQueryFields({
      outputStage: spec.outputStage,
      defaultMode: defaultModeForDbType(spec.type),
      sqlPrimary: !spec.type.startsWith("mongodb.") && !spec.type.startsWith("elasticsearch."),
    });
  }

  // ClickHouse / SQL write + admin → columnar YAML outputs (same contract as list/query)
  if (
    isStructuredDbWriteNode(spec.type) &&
    (kind === "write" || kind === "admin")
  ) {
    return structuredDbWriteFields({
      outputStage: spec.outputStage,
      admin: kind === "admin",
      nodeType: spec.type,
    });
  }

  switch (kind) {
    case "query":
      return [
        {
          key: "target",
          label: targetLabel,
          kind: "text",
          section: "input",
          required: true,
          placeholder: "database.table or collection",
        },
        {
          key: "query",
          label: "Query / filter",
          kind: "code",
          section: "processing",
          language: "sql",
          rows: 8,
          required: true,
          placeholder: "SELECT * FROM … WHERE …\n# or JSON filter / DSL",
        },
        {
          key: "limit",
          label: "Limit",
          kind: "number",
          section: "processing",
          placeholder: "Optional — leave empty to read all matching rows",
          help: "Use Filter and Projection to narrow columns/rows. Empty limit = all matches.",
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "write":
      return [
        stageIn(),
        {
          key: "target",
          label: targetLabel,
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "mode",
          label: "Write mode",
          kind: "select",
          section: "processing",
          options: [
            { value: "insert", label: "Insert" },
            { value: "upsert", label: "Upsert / merge" },
            { value: "replace", label: "Replace" },
            { value: "delete", label: "Delete" },
          ],
          defaultValue: "insert",
        },
        {
          key: "mapping",
          label: "Field mapping (YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 6,
          placeholder: "id: \"{{ row.id }}\"\n",
        },
        {
          key: "statement",
          label: "Statement / filter (optional)",
          kind: "code",
          section: "processing",
          language: "sql",
          rows: 4,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "admin":
      return [
        {
          key: "resourceName",
          label: "Resource name",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "my_collection / my_schema",
        },
        {
          key: "definition",
          label: "Definition (SQL / JSON / YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 10,
          required: true,
          placeholder: "# DDL or resource spec\n",
        },
        {
          key: "ifNotExists",
          label: "IF NOT EXISTS",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "stream":
      return [
        {
          key: "source",
          label: "Source (collection / topic)",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "filter",
          label: "Filter / pipeline",
          kind: "json",
          section: "processing",
          rows: 5,
        },
        {
          key: "batchSize",
          label: "Batch size",
          kind: "number",
          section: "processing",
          defaultValue: 100,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "list":
      return [
        {
          key: "scope",
          label: "Scope / parent",
          kind: "text",
          section: "input",
          placeholder: "database / bucket / workspace",
        },
        {
          key: "pattern",
          label: "Name pattern",
          kind: "text",
          section: "processing",
          placeholder: "*",
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "job":
    case "sync":
      return [
        stageIn(),
        {
          key: "jobId",
          label: "Job / DAG / deployment id",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "parameters",
          label: "Parameters (JSON / YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 6,
        },
        {
          key: "wait",
          label: "Wait for completion",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "status":
      return [
        {
          key: "runId",
          label: "Run / job id",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "{{ stage.trigger.run_id }}",
        },
        {
          key: "pollSeconds",
          label: "Poll interval (sec)",
          kind: "number",
          section: "processing",
          defaultValue: 10,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "validate":
      return [
        stageIn(),
        {
          key: "suite",
          label: "Suite / checkpoint / select",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "failOnError",
          label: "Fail workflow on validation error",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "message":
      return [
        stageIn(),
        {
          key: "destination",
          label: "Topic / channel / workflow id",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "payloadTemplate",
          label: "Payload template",
          kind: "template",
          section: "processing",
          language: "json",
          rows: 8,
          required: true,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "file":
      return [
        stageIn(),
        {
          key: "path",
          label: "Path / URI",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "s3://bucket/path or /data/file.parquet",
        },
        {
          key: "format",
          label: "Format",
          kind: "select",
          section: "processing",
          options: [
            { value: "parquet", label: "Parquet" },
            { value: "csv", label: "CSV" },
            { value: "json", label: "JSON" },
            { value: "jsonl", label: "JSONL" },
            { value: "raw", label: "Raw" },
          ],
          defaultValue: "parquet",
        },
        {
          key: "options",
          label: "Options (YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 4,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "index":
      return [
        {
          key: "target",
          label: "Collection / table",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "keys",
          label: "Index keys (JSON / YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 5,
          required: true,
          placeholder: "email: 1\nstatus: 1\n",
        },
        {
          key: "unique",
          label: "Unique",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        stageOut(spec.outputStage),
        outFormat("json"),
      ];
    case "schema":
      return [
        {
          key: "target",
          label: "Collection / table",
          kind: "text",
          section: "input",
          required: true,
        },
        {
          key: "sampleSize",
          label: "Sample size",
          kind: "number",
          section: "processing",
          defaultValue: 50,
        },
        stageOut(spec.outputStage),
        outFormat("yaml"),
      ];
    default:
      return [stageIn(), stageOut(spec.outputStage), outFormat("json")];
  }
}

function prefectFields(spec: PluginNodeSpec): NodeFieldDef[] | null {
  switch (spec.type) {
    case "prefect.triggerDeployment":
      return [
        stageIn(
          "__inputs",
          "Upstream List Deployments",
          "Wire List Deployments here — matched list is used to resolve the deployment",
        ),
        {
          key: "deploymentName",
          label: "Deployment name to trigger",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "my-first-managed-deployment",
          help: "Must match a name in the filtered upstream list, or fail",
        },
        {
          key: "deploymentId",
          label: "Deployment ID (override)",
          kind: "text",
          section: "input",
          placeholder: "optional UUID — skips name match when set",
          help: "If set, used directly. Otherwise resolve from upstream by deploymentName.",
        },
        {
          key: "parameters",
          label: "Flow run parameters (JSON / YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 6,
          placeholder: "{}\n",
        },
        {
          key: "wait",
          label: "Wait for completion",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        stageOut(spec.outputStage ?? "stage.prefect_triggerDeployment"),
        outFormat("yaml"),
      ];
    case "prefect.runStatus":
    case "prefect.cancelRun":
      return [
        stageIn(),
        {
          key: "flowRunId",
          label: "Flow run ID",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "uuid from Trigger Deployment output",
        },
        stageOut(spec.outputStage),
        outFormat("yaml"),
      ];
    case "prefect.listDeployments":
      return [
        {
          key: "nameFilter",
          label: "Filter by deployment name",
          kind: "text",
          section: "input",
          placeholder: "my-first-managed-deployment",
          help: "Keep only matching names in the output list. Leave empty to return all.",
        },
        {
          key: "matchMode",
          label: "Name match mode",
          kind: "select",
          section: "processing",
          options: [
            { value: "exact", label: "Exact match" },
            { value: "contains", label: "Contains (case-insensitive)" },
          ],
          defaultValue: "exact",
        },
        {
          key: "failIfEmpty",
          label: "Fail if no name match",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
          help: "When name filter is set and nothing matches → fail the node",
        },
        {
          key: "limit",
          label: "Limit (before filter)",
          kind: "number",
          section: "processing",
          defaultValue: 200,
        },
        stageOut(spec.outputStage ?? "stage.prefect_listDeployments"),
        outFormat("yaml"),
      ];
    default:
      return null;
  }
}

function airflowFields(spec: PluginNodeSpec): NodeFieldDef[] | null {
  const dagId: NodeFieldDef = {
    key: "dagId",
    label: "DAG ID",
    kind: "text",
    section: "input",
    required: true,
    placeholder: "etl_daily",
    help: "Uses the connector default DAG ID when left empty.",
  };
  const dagRunId: NodeFieldDef = {
    key: "dagRunId",
    label: "DAG run ID",
    kind: "text",
    section: "input",
    required: true,
    placeholder: "manual__2026-09-09T12:00:00+00:00",
  };
  const taskId: NodeFieldDef = {
    key: "taskId",
    label: "Task ID",
    kind: "text",
    section: "input",
    required: true,
    placeholder: "transform_data",
  };
  const xcomKey: NodeFieldDef = {
    key: "xcomKey",
    label: "XCom key",
    kind: "text",
    section: "input",
    required: true,
    placeholder: "return_value",
  };
  const mapIndex: NodeFieldDef = {
    key: "mapIndex",
    label: "Map index (optional)",
    kind: "number",
    section: "processing",
    placeholder: "-1",
  };

  switch (spec.type) {
    case "airflow.xcomPull":
      return [
        dagId,
        dagRunId,
        taskId,
        xcomKey,
        mapIndex,
        stageOut(spec.outputStage ?? "stage.airflow_xcom"),
        outFormat("yaml"),
      ];
    case "airflow.xcomPush":
      return [
        stageIn(
          "__inputs",
          "Value from upstream stage",
          "When Value is empty, the first upstream stage is pushed.",
        ),
        dagId,
        dagRunId,
        taskId,
        xcomKey,
        {
          key: "value",
          label: "Value (JSON / YAML)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 5,
          placeholder: '{ "status": "ready" }',
        },
        mapIndex,
        stageOut(spec.outputStage ?? "stage.airflow_xcom_push"),
        outFormat("yaml"),
      ];
    case "airflow.listDags":
      return [
        {
          key: "limit",
          label: "Limit",
          kind: "number",
          section: "processing",
          defaultValue: 100,
        },
        {
          key: "offset",
          label: "Offset",
          kind: "number",
          section: "processing",
          defaultValue: 0,
        },
        {
          key: "onlyActive",
          label: "Only active DAGs",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
        },
        stageOut(spec.outputStage ?? "stage.airflow_dags"),
        outFormat("yaml"),
      ];
    case "airflow.importVariables":
      return [
        {
          key: "variableName",
          label: "Variable name",
          kind: "text",
          section: "input",
          required: true,
          placeholder: "environment",
        },
        {
          key: "value",
          label: "Variable value",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 5,
          required: true,
          placeholder: "production",
        },
        {
          key: "description",
          label: "Description (optional)",
          kind: "text",
          section: "processing",
        },
        stageOut(spec.outputStage ?? "stage.airflow_variable"),
        outFormat("yaml"),
      ];
    case "airflow.triggerDag":
      return [
        dagId,
        {
          key: "conf",
          label: "DAG conf (JSON)",
          kind: "code",
          section: "processing",
          language: "yaml",
          rows: 6,
          placeholder: '{ "date": "2026-09-18" }',
          help: "Posted as {conf} to POST /api/v1/dags/{dag_id}/dagRuns (n8n Trigger).",
        },
        {
          ...dagRunId,
          required: false,
          label: "DAG run ID (optional)",
          help: "Leave empty for Airflow to assign a run id. Downstream $json.dag_run_id.",
        },
        {
          key: "logicalDate",
          label: "Logical date (optional)",
          kind: "text",
          section: "processing",
          placeholder: "2026-09-18T00:00:00Z",
        },
        stageOut(spec.outputStage ?? "stage.airflow_dagrun"),
        outFormat("yaml"),
      ];
    case "airflow.dagStatus":
      return [
        dagId,
        {
          ...dagRunId,
          help: "Or bind from upstream triggerDag $json.dag_run_id / $json.dagRunId.",
        },
        stageOut(spec.outputStage ?? "stage.airflow_status"),
        outFormat("yaml"),
      ];
    case "airflow.pauseDag":
      return [
        dagId,
        {
          key: "isPaused",
          label: "Paused",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
          help: "PATCH /api/v1/dags/{dag_id} with {is_paused}. Uncheck to unpause.",
        },
        stageOut(spec.outputStage ?? "stage.airflow_pause"),
        outFormat("yaml"),
      ];
    case "airflow.clearTask":
      return [
        dagId,
        {
          ...taskId,
          required: false,
          help: "Optional. Empty clears matching instances for the DAG.",
        },
        {
          key: "dryRun",
          label: "Dry run",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        {
          key: "onlyFailed",
          label: "Only failed",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        {
          key: "onlyRunning",
          label: "Only running",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
        },
        {
          key: "resetDagRuns",
          label: "Reset DAG runs",
          kind: "checkbox",
          section: "processing",
          defaultValue: true,
        },
        stageOut(spec.outputStage ?? "stage.airflow_clear"),
        outFormat("yaml"),
      ];
    default:
      return null;
  }
}

function s3Fields(spec: PluginNodeSpec): NodeFieldDef[] | null {
  if (!spec.type.startsWith("s3.")) return null;
  const t = spec.type;
  const bucket: NodeFieldDef = {
    key: "bucket",
    label: "Bucket",
    kind: "text",
    section: "input",
    required: !t.endsWith(".list"),
    help: "Overrides connector default bucket when set",
  };
  const key: NodeFieldDef = {
    key: "key",
    label: "Object key",
    kind: "text",
    section: "input",
    required: true,
    placeholder: "path/to/object.json",
  };
  const prefix: NodeFieldDef = {
    key: "prefix",
    label: "Prefix",
    kind: "text",
    section: "input",
    placeholder: "orders/",
  };
  const commonOut = [
    stageOut(spec.outputStage ?? "stage.s3"),
    outFormat("yaml"),
  ];

  if (t === "s3.list") {
    return [
      bucket,
      prefix,
      {
        key: "limit",
        label: "Max keys",
        kind: "number",
        section: "processing",
        defaultValue: 1000,
      },
      ...commonOut,
    ];
  }
  if (t === "s3.read" || t === "s3.head" || t === "s3.presign") {
    const fields: NodeFieldDef[] = [bucket, key];
    if (t === "s3.presign") {
      fields.push(
        {
          key: "method",
          label: "HTTP method",
          kind: "select",
          section: "processing",
          options: [
            { value: "get", label: "GET" },
            { value: "put", label: "PUT" },
          ],
          defaultValue: "get",
        },
        {
          key: "expiresIn",
          label: "Expires (seconds)",
          kind: "number",
          section: "processing",
          defaultValue: 3600,
        },
      );
    }
    return [...fields, ...commonOut];
  }
  if (t === "s3.write") {
    return [
      stageIn(),
      bucket,
      key,
      {
        key: "contentType",
        label: "Content-Type",
        kind: "text",
        section: "processing",
        defaultValue: "application/json",
      },
      ...commonOut,
    ];
  }
  if (t === "s3.delete") {
    return [
      bucket,
      {
        ...key,
        required: false,
        help: "Single object key — or use Prefix for batch",
      },
      prefix,
      ...commonOut,
    ];
  }
  if (t === "s3.copy") {
    return [
      {
        key: "sourceBucket",
        label: "Source bucket",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "sourceKey",
        label: "Source key",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "destBucket",
        label: "Dest bucket",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "destKey",
        label: "Dest key",
        kind: "text",
        section: "input",
        required: true,
      },
      ...commonOut,
    ];
  }
  if (t === "s3.createBucket") {
    return [bucket, ...commonOut];
  }
  return [bucket, key, ...commonOut];
}

function sparkFields(spec: PluginNodeSpec): NodeFieldDef[] | null {
  if (!spec.type.startsWith("spark.")) return null;
  const t = spec.type;
  const commonOut = [
    stageOut(spec.outputStage ?? "stage.spark"),
    outFormat("yaml"),
  ];

  if (t === "spark.sql") {
    return [
      {
        key: "sql",
        label: "Spark SQL",
        kind: "code",
        language: "sql",
        section: "processing",
        rows: 8,
        required: true,
        placeholder: "SELECT * FROM parquet.`/data/orders` LIMIT 100",
      },
      {
        key: "limit",
        label: "Collect limit",
        kind: "number",
        section: "processing",
        defaultValue: 1000,
        help: "Max rows collected into the stage (Spark still runs full SQL)",
      },
      ...commonOut,
    ];
  }
  if (t === "spark.createTable") {
    return [
      {
        key: "target",
        label: "Table name",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "default.orders",
      },
      {
        key: "sql",
        label: "CREATE TABLE DDL (optional)",
        kind: "code",
        language: "sql",
        section: "processing",
        rows: 6,
        placeholder: "CREATE TABLE IF NOT EXISTS default.orders (id BIGINT) USING PARQUET",
      },
      {
        key: "definition",
        label: "Columns (if DDL empty)",
        kind: "code",
        language: "sql",
        section: "processing",
        rows: 4,
        placeholder: "id BIGINT, name STRING",
      },
      {
        key: "using",
        label: "USING format",
        kind: "select",
        section: "processing",
        options: [
          { value: "PARQUET", label: "Parquet" },
          { value: "DELTA", label: "Delta" },
          { value: "ORC", label: "ORC" },
          { value: "CSV", label: "CSV" },
          { value: "JSON", label: "JSON" },
        ],
        defaultValue: "PARQUET",
      },
      {
        key: "location",
        label: "LOCATION (optional)",
        kind: "text",
        section: "processing",
        placeholder: "s3a://bucket/path",
      },
      {
        key: "ifNotExists",
        label: "IF NOT EXISTS",
        kind: "checkbox",
        section: "processing",
        defaultValue: true,
      },
      ...commonOut,
    ];
  }
  if (t === "spark.read") {
    return [
      {
        key: "path",
        label: "Path / URI",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "/data/orders.parquet or s3a://bucket/path",
      },
      {
        key: "format",
        label: "Format",
        kind: "select",
        section: "processing",
        options: [
          { value: "parquet", label: "Parquet" },
          { value: "csv", label: "CSV" },
          { value: "json", label: "JSON" },
          { value: "orc", label: "ORC" },
          { value: "delta", label: "Delta" },
          { value: "text", label: "Text" },
        ],
        defaultValue: "parquet",
      },
      {
        key: "options",
        label: "Reader options (YAML/JSON)",
        kind: "code",
        language: "yaml",
        section: "processing",
        rows: 4,
        placeholder: "header: true\\ninferSchema: true",
      },
      {
        key: "limit",
        label: "Collect limit",
        kind: "number",
        section: "processing",
        defaultValue: 1000,
      },
      ...commonOut,
    ];
  }
  if (t === "spark.write") {
    return [
      stageIn(),
      {
        key: "path",
        label: "Output path",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "/data/out or s3a://bucket/out",
      },
      {
        key: "format",
        label: "Format",
        kind: "select",
        section: "processing",
        options: [
          { value: "parquet", label: "Parquet" },
          { value: "csv", label: "CSV" },
          { value: "json", label: "JSON" },
          { value: "orc", label: "ORC" },
          { value: "delta", label: "Delta" },
        ],
        defaultValue: "parquet",
      },
      {
        key: "mode",
        label: "Save mode",
        kind: "select",
        section: "processing",
        options: [
          { value: "overwrite", label: "Overwrite" },
          { value: "append", label: "Append" },
          { value: "ignore", label: "Ignore" },
          { value: "errorifexists", label: "Error if exists" },
        ],
        defaultValue: "overwrite",
      },
      {
        key: "table",
        label: "Save as table (optional)",
        kind: "text",
        section: "processing",
        placeholder: "default.orders_out",
      },
      ...commonOut,
    ];
  }
  if (t === "spark.submit") {
    return [
      {
        key: "appResource",
        label: "App (JAR / .py)",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "s3://bucket/jobs/etl.py",
        help: "Overrides connector jarOrPy when set",
      },
      {
        key: "mainClass",
        label: "Main class (JVM)",
        kind: "text",
        section: "processing",
      },
      {
        key: "appArgs",
        label: "App args",
        kind: "text",
        section: "processing",
        placeholder: "--date 2024-01-01",
      },
      {
        key: "conf",
        label: "Spark conf (YAML)",
        kind: "code",
        language: "yaml",
        section: "processing",
        rows: 4,
        placeholder: "spark.executor.memory: 2g",
      },
      {
        key: "wait",
        label: "Wait for finish",
        kind: "checkbox",
        section: "processing",
        defaultValue: false,
      },
      ...commonOut,
    ];
  }
  if (t === "spark.jobStatus") {
    return [
      {
        key: "appId",
        label: "Application / submission id",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "app-… or driver-…",
        help: "Or pass upstream spark.submit stage",
      },
      ...commonOut,
    ];
  }
  if (t === "spark.cancel") {
    return [
      {
        key: "appId",
        label: "Application / submission id",
        kind: "text",
        section: "input",
        required: true,
      },
      ...commonOut,
    ];
  }
  return commonOut;
}

export function schemaFromPluginSpec(
  spec: PluginNodeSpec,
  connectorType?: string,
): NodeSchema {
  const prefect = spec.type.startsWith("prefect.")
    ? prefectFields(spec)
    : null;
  const airflow = spec.type.startsWith("airflow.")
    ? airflowFields(spec)
    : null;
  const s3 = s3Fields(spec);
  const spark = sparkFields(spec);
  return {
    type: spec.type,
    summary: spec.description,
    acceptsStageInputs: ["write", "job", "sync", "message", "file", "validate"].includes(
      spec.kind,
    ),
    producesStageOutputs: true,
    requiresConnector: spec.requiresConnector !== false,
    connectorTypes: connectorType ? [connectorType] : undefined,
    defaultOutputs: spec.outputStage ? [spec.outputStage] : undefined,
    defaultConfig: {
      outputFormat: prefect || airflow || s3 || spark
        ? "yaml"
        : isStructuredDbNode(spec.type)
          ? "yaml"
          : "json",
      ...(isStructuredDbQueryNode(spec.type)
        ? { mode: defaultModeForDbType(spec.type) }
        : {}),
      ...(isStructuredDbWriteNode(spec.type)
        ? { ifNotExists: true, database: "default" }
        : {}),
      ...(spec.type === "prefect.triggerDeployment" ? { wait: false } : {}),
      ...(spec.type === "prefect.listDeployments"
        ? { matchMode: "exact", failIfEmpty: true, limit: 200 }
        : {}),
      ...(spec.type === "airflow.listDags"
        ? { limit: 100, offset: 0, onlyActive: true }
        : {}),
      ...(spec.type === "airflow.pauseDag" ? { isPaused: true } : {}),
      ...(spec.type === "airflow.clearTask" ? { resetDagRuns: true, dryRun: false } : {}),
      ...(spec.type === "spark.write" ? { mode: "overwrite", format: "parquet" } : {}),
      ...(spec.type === "spark.read" ? { format: "parquet", limit: 1000 } : {}),
      ...(spec.type === "spark.createTable"
        ? { ifNotExists: true, using: "PARQUET" }
        : {}),
    },
    fields: prefect ?? airflow ?? s3 ?? spark ?? fieldsForKind(spec.kind, spec),
  };
}

export function findPluginNodeSpec(type: string): PluginNodeSpec | undefined {
  const pid = pluginIdForNodeType(type);
  if (pid) {
    return getPluginCapability(pid)?.nodes.find((n) => n.type === type);
  }
  // custom plugins
  try {
    for (const p of loadCustomPlugins()) {
      const nodes = customPluginNodes(p.id, p.connectorType);
      const hit = nodes.find((n) => n.type === type);
      if (hit) return hit;
    }
  } catch {
    /* SSR / no localStorage */
  }
  return undefined;
}

export function getPluginDrivenSchema(type: string): NodeSchema | undefined {
  const spec = findPluginNodeSpec(type);
  if (!spec) return undefined;
  const pid = pluginIdForNodeType(type);
  const fromCustom = loadCustomPlugins().find((p) =>
    customPluginNodes(p.id, p.connectorType).some((n) => n.type === type),
  );
  const connectorType =
    (pid ? getPlugin(pid)?.connectorType : undefined) ??
    fromCustom?.connectorType ??
    pid;
  return schemaFromPluginSpec(spec, connectorType);
}
