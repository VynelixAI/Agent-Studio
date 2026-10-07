/**
 * Structured database nodes — shared identity + inspector field helpers.
 * Row-producing DB reads must use optional limit (default: all matches),
 * filter + projection, and columnar stage outputs.
 */

import type { NodeFieldDef } from "@/core/nodeSchemas";

/** Explicit row-producing DB query / aggregate / schema-sample types */
export const STRUCTURED_DB_QUERY_TYPES = [
  "mongodb.read",
  "mongodb.aggregate",
  "mongodb.schema",
  "postgresql.query",
  "mysql.query",
  "snowflake.query",
  "bigquery.query",
  "redshift.query",
  "clickhouse.query",
  "databricks.sql",
  "duckdb.query",
  "trino.query",
  "cassandra.query",
  "neo4j.cypher",
  "elasticsearch.search",
] as const;

/** Inventory / schema browse that still returns tabular rows */
export const STRUCTURED_DB_LIST_TYPES = [
  "postgresql.listTables",
  "mysql.listTables",
  "snowflake.listObjects",
  "bigquery.listTables",
  "bigquery.schema",
  "redshift.listTables",
  "duckdb.listTables",
  "cassandra.listTables",
  "databricks.listCatalogs",
  "clickhouse.listTables",
] as const;

/** Write / admin nodes that still emit columnar status (+ optional preview rows) */
export const STRUCTURED_DB_WRITE_TYPES = [
  "clickhouse.insert",
  "clickhouse.execute",
  "clickhouse.createTable",
  "clickhouse.createDatabase",
  "clickhouse.truncate",
  "postgresql.insert",
  "postgresql.execute",
  "mysql.insert",
  "mysql.execute",
] as const;

const QUERY_SET = new Set<string>(STRUCTURED_DB_QUERY_TYPES);
const LIST_SET = new Set<string>(STRUCTURED_DB_LIST_TYPES);
const WRITE_SET = new Set<string>(STRUCTURED_DB_WRITE_TYPES);

const STRUCTURED_PREFIXES = [
  "mongodb.",
  "postgresql.",
  "mysql.",
  "snowflake.",
  "bigquery.",
  "redshift.",
  "clickhouse.",
  "databricks.",
  "duckdb.",
  "trino.",
  "cassandra.",
  "neo4j.",
  "elasticsearch.",
] as const;

/** Non-tabular “query” kinds that must NOT get SQL row semantics */
const NON_TABULAR_QUERY = [
  "s3.presign",
  "azure_blob.sas",
  "gcs.signedUrl",
  "redis.get",
  "redis.hash",
  "nifi.provenance",
  "trino.explain",
  "airflow.xcomPull",
  "prefect.readVariable",
  "dbt.compile",
  "temporal.query",
];

export function isStructuredDbFamily(type: string): boolean {
  return STRUCTURED_PREFIXES.some((p) => type.startsWith(p));
}

export function isStructuredDbQueryNode(type: string): boolean {
  if (NON_TABULAR_QUERY.includes(type)) return false;
  if (QUERY_SET.has(type) || LIST_SET.has(type)) return true;
  if (!isStructuredDbFamily(type)) return false;
  // Any *.query / *.sql / *.cypher / *.search / *.read on a DB family
  return (
    type.endsWith(".query") ||
    type.endsWith(".sql") ||
    type.endsWith(".cypher") ||
    type.endsWith(".search") ||
    type.endsWith(".read") ||
    type.endsWith(".aggregate") ||
    type.includes(".list") ||
    type.endsWith(".schema")
  );
}

export function isStructuredDbWriteNode(type: string): boolean {
  if (WRITE_SET.has(type)) return true;
  if (!isStructuredDbFamily(type)) return false;
  return (
    type.includes(".insert") ||
    type.includes(".execute") ||
    type.includes(".truncate") ||
    type.includes(".createTable") ||
    type.includes(".createDatabase") ||
    type.includes(".write") ||
    type.includes(".update") ||
    type.includes(".delete")
  );
}

/** True for any structured DB node that should default to YAML columnar outputs */
export function isStructuredDbNode(type: string): boolean {
  return (
    isStructuredDbQueryNode(type) ||
    isStructuredDbWriteNode(type) ||
    isStructuredDbFamily(type)
  );
}

/** Inspector fields for DB write / admin nodes (insert, execute, DDL) */
export function structuredDbWriteFields(opts?: {
  outputStage?: string;
  admin?: boolean;
  /** clickhouse.createTable | createDatabase | truncate | … */
  nodeType?: string;
}): NodeFieldDef[] {
  const t = opts?.nodeType ?? "";
  const isCreateDb = t.includes(".createDatabase");
  const isTruncate = t.includes(".truncate");
  const isCreateTable = t.includes(".createTable");
  const isInsert = t.includes(".insert");
  const repeatTestFields: NodeFieldDef[] = isInsert
    ? [
        {
          key: "truncateBeforeInsert",
          label: "Replace table data before insert",
          kind: "checkbox",
          section: "processing",
          defaultValue: false,
          help: "ClickHouse testing: TRUNCATE the target first so repeated runs do not create duplicates.",
        },
      ]
    : [];

  const resourceLabel = isCreateDb
    ? "Database name"
    : isTruncate || isCreateTable
      ? "Table"
      : opts?.admin
        ? "Resource / table"
        : "Table";

  return [
    {
      key: "__inputs",
      label: "Input stages",
      kind: "stage",
      section: "input",
      placeholder: "stage.upstream",
      help: "For insert — rows from these stages are written as JSONEachRow",
    },
    {
      key: "database",
      label: isCreateDb ? "Database (optional alias)" : "Database",
      kind: "text",
      section: "input",
      placeholder: "default",
      defaultValue: "default",
      help: isCreateDb
        ? "Used when Resource name is empty"
        : "Qualified as database.table when table has no dot",
    },
    {
      key: "target",
      label: resourceLabel,
      kind: "text",
      section: "input",
      placeholder: isCreateDb
        ? "analytics"
        : "crypto_price  or  default.crypto_price",
      required: isCreateTable || isTruncate || isCreateDb,
      help: isCreateDb
        ? "Name of the database to create (also accepts resourceName)"
        : "Table to create / truncate. Also accepts resourceName",
    },
    {
      key: "resourceName",
      label: isCreateDb ? "Database name (alias)" : "Resource name (alias)",
      kind: "text",
      section: "input",
      placeholder: isCreateDb ? "analytics" : "my_table",
      help: "Alias for target — either field is enough",
    },
    {
      key: "sql",
      label: "SQL / DDL",
      kind: "code",
      language: "sql",
      section: "processing",
      rows: 8,
      placeholder: isCreateDb
        ? "CREATE DATABASE IF NOT EXISTS analytics"
        : isTruncate
          ? "TRUNCATE TABLE IF EXISTS default.crypto_price"
          : isCreateTable
            ? "CREATE TABLE IF NOT EXISTS default.t (_id String) ENGINE = MergeTree ORDER BY _id"
            : "INSERT INTO t FORMAT JSONEachRow\\n{…}",
      help: "Leave empty to auto-build from target / Definition when possible",
    },
    {
      key: "definition",
      label: isCreateTable
        ? "Columns or full CREATE TABLE"
        : "Definition (DDL alias)",
      kind: "code",
      language: "sql",
      section: "processing",
      rows: 6,
      placeholder: isCreateTable
        ? "id UInt64,\\nname String\\n# or paste a full CREATE TABLE …"
        : "# Full CREATE / DDL …",
      help: isCreateTable
        ? "Column list is wrapped into MergeTree DDL automatically; or paste full CREATE TABLE"
        : "Optional alias for sql",
    },
    {
      key: "ifNotExists",
      label: "IF NOT EXISTS",
      kind: "checkbox",
      section: "processing",
      defaultValue: true,
    },
    ...repeatTestFields,
    stageOut(opts?.outputStage),
    outFormat("yaml"),
  ];
}

function stageOut(defaultKey?: string): NodeFieldDef {
  return {
    key: "__outputs",
    label: "Output stage key",
    kind: "stage",
    section: "output",
    placeholder: defaultKey ?? "stage.result",
    help: "Columnar dataset for Notebook / Logic / Control",
  };
}

function outFormat(defaultValue = "yaml"): NodeFieldDef {
  return {
    key: "outputFormat",
    label: "Output format",
    kind: "format",
    section: "output",
    options: [
      { value: "yaml", label: "YAML" },
      { value: "json", label: "JSON" },
      { value: "text", label: "Text" },
      { value: "raw", label: "Raw / binary" },
    ],
    defaultValue,
  };
}

/** Inspector fields shared by all structured DB query nodes */
export function structuredDbQueryFields(opts?: {
  outputStage?: string;
  defaultMode?: "collection" | "table" | "sql" | "aggregation";
  sqlPrimary?: boolean;
}): NodeFieldDef[] {
  const defaultMode = opts?.defaultMode ?? (opts?.sqlPrimary ? "sql" : "collection");
  return [
    {
      key: "mode",
      label: "Query mode",
      kind: "select",
      section: "input",
      defaultValue: defaultMode,
      options: [
        { value: "collection", label: "Collection" },
        { value: "table", label: "Table" },
        { value: "sql", label: "SQL" },
        { value: "aggregation", label: "Aggregation / pipeline" },
      ],
      help: "Filter + projection apply on the driver when supported. Empty limit = all matches.",
    },
    {
      key: "database",
      label: "Database / dataset",
      kind: "text",
      section: "input",
      placeholder: "ops",
    },
    {
      key: "target",
      label: "Collection / table",
      kind: "text",
      section: "input",
      placeholder: "users  or  public.orders",
      help: "Also accepts config.collection / config.table",
    },
    {
      key: "sql",
      label: "SQL / statement",
      kind: "code",
      language: "sql",
      section: "processing",
      rows: 6,
      placeholder: "SELECT * FROM users WHERE status = 'active'",
      visibleWhen: { key: "mode", equals: "sql" },
    },
    {
      key: "query",
      label: "Query (SQL / DSL)",
      kind: "code",
      language: "sql",
      section: "processing",
      rows: 5,
      placeholder: "SELECT …  or engine-specific DSL",
      help: "Used when mode=sql, or as fallback statement for SQL engines.",
    },
    {
      key: "pipeline",
      label: "Pipeline / aggregation (JSON)",
      kind: "json",
      section: "processing",
      rows: 5,
      placeholder: '[{ "$match": { "status": "active" } }]',
      visibleWhen: { key: "mode", equals: "aggregation" },
    },
    {
      key: "filter",
      label: "Filter (JSON)",
      kind: "json",
      section: "processing",
      rows: 4,
      placeholder: '{\n  "status": "active"\n}',
      help: "Applied first (WHERE / $match / driver filter). Leave empty for all rows.",
    },
    {
      key: "projection",
      label: "Projection (JSON or columns)",
      kind: "json",
      section: "processing",
      rows: 3,
      placeholder: '{ "email": 1, "status": 1 }',
      help: "Applied after filter. Object map or column name list.",
    },
    {
      key: "sort",
      label: "Sort (JSON)",
      kind: "json",
      section: "processing",
      rows: 2,
      placeholder: '{ "updatedAt": -1 }',
    },
    {
      key: "limit",
      label: "Limit",
      kind: "number",
      section: "processing",
      placeholder: "Optional — leave empty to read all matching rows",
      help: "Use Filter and Projection to narrow columns/rows. Empty limit = all matches.",
    },
    stageOut(opts?.outputStage),
    outFormat("yaml"),
  ];
}

export function defaultModeForDbType(type: string): "collection" | "table" | "sql" | "aggregation" {
  if (type.startsWith("mongodb.")) {
    if (type.includes("aggregate")) return "aggregation";
    return "collection";
  }
  if (type.includes("elasticsearch")) return "collection";
  if (type.includes("cassandra") || type.includes("neo4j")) return "sql";
  return "sql";
}
