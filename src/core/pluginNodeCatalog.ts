/**
 * Loosely coupled plugin → node capabilities.
 * Installing a plugin unlocks these nodes in the palette and materializes
 * a local package (verify / templates / runners) under data/plugins/<id>.
 */

import type { NodeCategory } from "@/types/workspace";
import type { NodeTypeDef } from "@/core/nodeRegistry";

/** How the inspector schema is built for this node */
export type PluginNodeKind =
  | "query"
  | "write"
  | "admin"
  | "stream"
  | "list"
  | "job"
  | "status"
  | "sync"
  | "validate"
  | "message"
  | "file"
  | "index"
  | "schema";

export interface PluginNodeSpec {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  kind: PluginNodeKind;
  /** Default stage output key */
  outputStage?: string;
  requiresConnector?: boolean;
}

export interface PluginCapability {
  pluginId: string;
  nodes: PluginNodeSpec[];
}

function n(
  type: string,
  label: string,
  description: string,
  kind: PluginNodeKind,
  extra?: Partial<PluginNodeSpec>,
): PluginNodeSpec {
  return {
    type,
    label,
    description,
    category: "data",
    kind,
    requiresConnector: true,
    outputStage: `stage.${type.replace(/\./g, "_")}`,
    ...extra,
  };
}

function wf(
  type: string,
  label: string,
  description: string,
  kind: PluginNodeKind,
  extra?: Partial<PluginNodeSpec>,
): PluginNodeSpec {
  return n(type, label, description, kind, {
    category: "control",
    ...extra,
  });
}

/** Product-analyzed node sets (5–10 each) for every catalog plugin */
export const PLUGIN_CAPABILITIES: Record<string, PluginCapability> = {
  mongodb: {
    pluginId: "mongodb",
    nodes: [
      n("mongodb.read", "MongoDB Read", "Find / sample documents into stage", "query"),
      n("mongodb.write", "MongoDB Write", "Insert or upsert documents", "write"),
      n("mongodb.update", "MongoDB Update", "Update documents by filter", "write"),
      n("mongodb.delete", "MongoDB Delete", "Delete documents by filter", "write"),
      n("mongodb.aggregate", "MongoDB Aggregate", "Run aggregation pipeline", "query"),
      n("mongodb.changestream", "Change Stream", "CDC via change streams", "stream"),
      n("mongodb.schema", "Schema Introspect", "Sample collection schema", "schema"),
      n("mongodb.createCollection", "Create Collection", "Create collection + validators", "admin"),
      n("mongodb.createIndex", "Create Index", "Create single / compound indexes", "index"),
      n("mongodb.listCollections", "List Collections", "List DBs / collections", "list"),
    ],
  },

  postgresql: {
    pluginId: "postgresql",
    nodes: [
      n("postgresql.query", "Postgres Query", "SELECT / CTE into stage", "query"),
      n("postgresql.execute", "Postgres Execute", "DDL / DML statements", "write"),
      n("postgresql.insert", "Postgres Insert", "Bulk insert / COPY-friendly write", "write"),
      n("postgresql.update", "Postgres Update", "UPDATE … WHERE", "write"),
      n("postgresql.createTable", "Create Table", "CREATE TABLE / IF NOT EXISTS", "admin"),
      n("postgresql.createSchema", "Create Schema", "CREATE SCHEMA", "admin"),
      n("postgresql.createIndex", "Create Index", "B-tree / GIN / partial indexes", "index"),
      n("postgresql.listTables", "List Tables", "Information schema browse", "list"),
      n("postgresql.copy", "Postgres COPY", "COPY FROM/TO file or stage", "file"),
    ],
  },

  snowflake: {
    pluginId: "snowflake",
    nodes: [
      n("snowflake.query", "Snowflake Query", "Warehouse SQL SELECT", "query"),
      n("snowflake.execute", "Snowflake Execute", "DDL / DML / tasks", "write"),
      n("snowflake.load", "Snowflake Load", "COPY INTO table from stage", "write"),
      n("snowflake.unload", "Snowflake Unload", "COPY INTO stage/location", "file"),
      n("snowflake.createTable", "Create Table", "CREATE TABLE / transient", "admin"),
      n("snowflake.createStage", "Create Stage", "Internal / external stage", "admin"),
      n("snowflake.listObjects", "List Objects", "Show databases / schemas / tables", "list"),
      n("snowflake.merge", "Snowflake Merge", "MERGE INTO upsert pattern", "write"),
    ],
  },

  bigquery: {
    pluginId: "bigquery",
    nodes: [
      n("bigquery.query", "BigQuery Query", "Jobs query / dry-run", "query"),
      n("bigquery.load", "BigQuery Load", "Load job from GCS / local", "write"),
      n("bigquery.extract", "BigQuery Extract", "Extract table to GCS", "file"),
      n("bigquery.insert", "BigQuery Insert", "Streaming / batch insert rows", "write"),
      n("bigquery.createDataset", "Create Dataset", "datasets.create", "admin"),
      n("bigquery.createTable", "Create Table", "tables.create + schema", "admin"),
      n("bigquery.listTables", "List Tables", "Dataset table inventory", "list"),
      n("bigquery.schema", "Table Schema", "Fetch table schema JSON", "schema"),
    ],
  },

  kafka: {
    pluginId: "kafka",
    nodes: [
      n("kafka.consume", "Kafka Consume", "Poll topic → stage", "stream"),
      n("kafka.produce", "Kafka Produce", "Publish records from stage", "message"),
      n("kafka.createTopic", "Create Topic", "Admin createTopics", "admin"),
      n("kafka.listTopics", "List Topics", "Metadata list", "list"),
      n("kafka.describeConsumer", "Describe Consumer", "Group lag / members", "status"),
      n("kafka.deleteRecords", "Delete Records", "Delete before offset", "admin"),
      n("kafka.seek", "Seek Offsets", "Assign / seek partitions", "stream"),
    ],
  },

  s3: {
    pluginId: "s3",
    nodes: [
      n("s3.list", "S3 List", "List objects by prefix", "list"),
      n("s3.read", "S3 Read", "Get object → stage / bytes", "file"),
      n("s3.write", "S3 Write", "Put object from stage", "file"),
      n("s3.delete", "S3 Delete", "Delete key or prefix batch", "admin"),
      n("s3.copy", "S3 Copy", "Server-side copy / multipart", "file"),
      n("s3.createBucket", "Create Bucket", "Create bucket + region", "admin"),
      n("s3.presign", "Presign URL", "Generate GET/PUT URL", "query"),
      n("s3.head", "S3 Head", "Metadata / exists check", "status"),
    ],
  },

  databricks: {
    pluginId: "databricks",
    nodes: [
      n("databricks.sql", "Databricks SQL", "SQL warehouse query", "query"),
      n("databricks.execute", "SQL Execute", "DDL / INSERT via warehouse", "write"),
      n("databricks.notebook", "Run Notebook", "Jobs run-now notebook task", "job", {
        category: "control",
      }),
      n("databricks.jobStatus", "Job Status", "Poll run status", "status", {
        category: "control",
      }),
      n("databricks.volume", "Volume IO", "UC volume read/write", "file"),
      n("databricks.createTable", "Create Table", "Unity Catalog table", "admin"),
      n("databricks.listCatalogs", "List Catalogs", "UC catalogs / schemas", "list"),
      n("databricks.dbfs", "DBFS Ops", "Legacy DBFS get/put", "file"),
    ],
  },

  clickhouse: {
    pluginId: "clickhouse",
    nodes: [
      n("clickhouse.query", "ClickHouse Query", "SELECT via HTTP", "query"),
      n("clickhouse.insert", "ClickHouse Insert", "INSERT FORMAT JSONEachRow", "write"),
      n("clickhouse.execute", "ClickHouse Execute", "DDL / OPTIMIZE / ALTER", "write"),
      n("clickhouse.createTable", "Create Table", "MergeTree family DDL", "admin"),
      n("clickhouse.createDatabase", "Create Database", "CREATE DATABASE", "admin"),
      n("clickhouse.listTables", "List Tables", "system.tables browse", "list"),
      n("clickhouse.truncate", "Truncate Table", "TRUNCATE TABLE", "admin"),
    ],
  },

  redis: {
    pluginId: "redis",
    nodes: [
      n("redis.get", "Redis GET", "GET / MGET keys", "query"),
      n("redis.set", "Redis SET", "SET / MSET with TTL", "write"),
      n("redis.delete", "Redis Delete", "DEL / UNLINK", "write"),
      n("redis.streamRead", "Stream Read", "XREAD / XREADGROUP", "stream"),
      n("redis.streamAdd", "Stream Add", "XADD from stage", "message"),
      n("redis.hash", "Hash Ops", "HGETALL / HSET", "query"),
      n("redis.publish", "Pub/Sub Publish", "PUBLISH channel", "message"),
      n("redis.scan", "Key Scan", "SCAN by pattern", "list"),
    ],
  },

  elasticsearch: {
    pluginId: "elasticsearch",
    nodes: [
      n("elasticsearch.search", "ES Search", "Query DSL search", "query"),
      n("elasticsearch.index", "ES Index Doc", "Index / upsert document", "write"),
      n("elasticsearch.bulk", "ES Bulk", "Bulk index from stage", "write"),
      n("elasticsearch.delete", "ES Delete", "Delete by id / query", "write"),
      n("elasticsearch.createIndex", "Create Index", "Index + mappings", "admin"),
      n("elasticsearch.putMapping", "Put Mapping", "Update field mappings", "schema"),
      n("elasticsearch.listIndices", "List Indices", "Cat / indices API", "list"),
      n("elasticsearch.reindex", "Reindex", "Reindex API job", "job"),
    ],
  },

  mysql: {
    pluginId: "mysql",
    nodes: [
      n("mysql.query", "MySQL Query", "SELECT into stage", "query"),
      n("mysql.execute", "MySQL Execute", "DDL / DML", "write"),
      n("mysql.insert", "MySQL Insert", "Batch insert rows", "write"),
      n("mysql.update", "MySQL Update", "UPDATE by predicate", "write"),
      n("mysql.createDatabase", "Create Database", "CREATE DATABASE", "admin"),
      n("mysql.createTable", "Create Table", "CREATE TABLE", "admin"),
      n("mysql.listTables", "List Tables", "SHOW TABLES / information_schema", "list"),
      n("mysql.cdc", "MySQL CDC", "Binlog / Debezium-style stream hook", "stream"),
    ],
  },

  redshift: {
    pluginId: "redshift",
    nodes: [
      n("redshift.query", "Redshift Query", "SELECT via driver", "query"),
      n("redshift.execute", "Redshift Execute", "DDL / DML", "write"),
      n("redshift.copy", "Redshift COPY", "COPY from S3", "write"),
      n("redshift.unload", "Redshift UNLOAD", "UNLOAD to S3", "file"),
      n("redshift.createTable", "Create Table", "CREATE TABLE / LIKE", "admin"),
      n("redshift.createSchema", "Create Schema", "CREATE SCHEMA", "admin"),
      n("redshift.listTables", "List Tables", "SVV / information_schema", "list"),
      n("redshift.merge", "Redshift Merge", "MERGE upsert pattern", "write"),
    ],
  },

  azure_blob: {
    pluginId: "azure_blob",
    nodes: [
      n("azure_blob.list", "Blob List", "List container prefix", "list"),
      n("azure_blob.read", "Blob Read", "Download blob → stage", "file"),
      n("azure_blob.write", "Blob Write", "Upload from stage", "file"),
      n("azure_blob.delete", "Blob Delete", "Delete blob(s)", "admin"),
      n("azure_blob.copy", "Blob Copy", "Async copy blob", "file"),
      n("azure_blob.createContainer", "Create Container", "Create container", "admin"),
      n("azure_blob.sas", "Generate SAS", "Service SAS URL", "query"),
      n("azure_blob.properties", "Blob Properties", "Head / metadata", "status"),
    ],
  },

  gcs: {
    pluginId: "gcs",
    nodes: [
      n("gcs.list", "GCS List", "List bucket prefix", "list"),
      n("gcs.read", "GCS Read", "Download object", "file"),
      n("gcs.write", "GCS Write", "Upload object", "file"),
      n("gcs.delete", "GCS Delete", "Delete object(s)", "admin"),
      n("gcs.copy", "GCS Compose/Copy", "Copy / compose objects", "file"),
      n("gcs.createBucket", "Create Bucket", "Buckets insert", "admin"),
      n("gcs.signedUrl", "Signed URL", "V4 signed URL", "query"),
      n("gcs.metadata", "Object Metadata", "Patch / get metadata", "status"),
    ],
  },

  neo4j: {
    pluginId: "neo4j",
    nodes: [
      n("neo4j.cypher", "Cypher Query", "READ Cypher → stage", "query"),
      n("neo4j.write", "Cypher Write", "WRITE Cypher / MERGE", "write"),
      n("neo4j.createConstraint", "Create Constraint", "Uniqueness / existence", "admin"),
      n("neo4j.createIndex", "Create Index", "Range / fulltext index", "index"),
      n("neo4j.listLabels", "List Labels", "DB labels / rel types", "list"),
      n("neo4j.loadCsv", "LOAD CSV", "Periodic LOAD CSV pattern", "file"),
      n("neo4j.delete", "Detach Delete", "Matched delete pattern", "write"),
    ],
  },

  cassandra: {
    pluginId: "cassandra",
    nodes: [
      n("cassandra.query", "CQL Query", "SELECT into stage", "query"),
      n("cassandra.insert", "CQL Insert", "INSERT / batch", "write"),
      n("cassandra.execute", "CQL Execute", "DDL / UPDATES", "write"),
      n("cassandra.createKeyspace", "Create Keyspace", "WITH replication", "admin"),
      n("cassandra.createTable", "Create Table", "CREATE TABLE", "admin"),
      n("cassandra.listTables", "List Tables", "system_schema tables", "list"),
      n("cassandra.truncate", "Truncate Table", "TRUNCATE", "admin"),
    ],
  },

  duckdb: {
    pluginId: "duckdb",
    nodes: [
      n("duckdb.query", "DuckDB Query", "SQL SELECT", "query"),
      n("duckdb.execute", "DuckDB Execute", "DDL / DML", "write"),
      n("duckdb.import", "Import File", "read_csv / read_parquet", "file"),
      n("duckdb.export", "Export File", "COPY TO parquet/csv", "file"),
      n("duckdb.createTable", "Create Table", "CREATE TABLE AS", "admin"),
      n("duckdb.listTables", "List Tables", "information_schema", "list"),
      n("duckdb.attach", "Attach DB", "ATTACH database / MotherDuck", "admin"),
    ],
  },

  trino: {
    pluginId: "trino",
    nodes: [
      n("trino.query", "Trino Query", "Federated SELECT", "query"),
      n("trino.execute", "Trino Execute", "CREATE / INSERT / DELETE", "write"),
      n("trino.createTable", "Create Table", "CTAS / CREATE TABLE", "admin"),
      n("trino.listCatalogs", "List Catalogs", "SHOW CATALOGS / SCHEMAS", "list"),
      n("trino.explain", "Explain Plan", "EXPLAIN / ANALYZE", "query"),
      n("trino.view", "Create View", "CREATE OR REPLACE VIEW", "admin"),
      n("trino.insert", "Trino Insert", "INSERT INTO … SELECT", "write"),
    ],
  },

  airflow: {
    pluginId: "airflow",
    nodes: [
      wf("airflow.triggerDag", "Trigger DAG", "DAGRuns trigger", "job"),
      wf("airflow.dagStatus", "DAG Run Status", "Poll dag run / task", "status"),
      wf("airflow.xcomPull", "XCom Pull", "Read XCom value", "query", {
        category: "data",
      }),
      wf("airflow.xcomPush", "XCom Push", "Write XCom (via API where supported)", "write", {
        category: "data",
      }),
      wf("airflow.listDags", "List DAGs", "DAGs inventory", "list", { category: "data" }),
      wf("airflow.pauseDag", "Pause / Unpause", "Toggle DAG pause", "admin"),
      wf("airflow.clearTask", "Clear Task", "Clear task instances", "admin"),
      wf("airflow.importVariables", "Set Variable", "Variables API", "write", {
        category: "data",
      }),
    ],
  },

  prefect: {
    pluginId: "prefect",
    nodes: [
      wf("prefect.triggerDeployment", "Trigger Deployment", "Create flow run", "job"),
      wf("prefect.runStatus", "Flow Run Status", "Poll flow run", "status"),
      wf("prefect.cancelRun", "Cancel Run", "Cancel flow run", "admin"),
      wf("prefect.listDeployments", "List Deployments", "Deployments inventory", "list", {
        category: "data",
      }),
      wf("prefect.setVariable", "Set Variable", "Workspace variable", "write", {
        category: "data",
      }),
      wf("prefect.readVariable", "Read Variable", "Get variable value", "query", {
        category: "data",
      }),
      wf("prefect.workPoolStatus", "Work Pool Status", "Pool / worker health", "status"),
    ],
  },

  dagster: {
    pluginId: "dagster",
    nodes: [
      wf("dagster.launchRun", "Launch Run", "Launch job / pipeline", "job"),
      wf("dagster.materialize", "Materialize Assets", "Asset materialization", "job"),
      wf("dagster.runStatus", "Run Status", "Poll Dagster run", "status"),
      wf("dagster.listJobs", "List Jobs", "Repository jobs", "list", { category: "data" }),
      wf("dagster.listAssets", "List Assets", "Asset catalog", "list", { category: "data" }),
      wf("dagster.terminate", "Terminate Run", "Terminate in-flight run", "admin"),
      wf("dagster.sensorTick", "Sensor Tick", "Request sensor evaluation", "job"),
    ],
  },

  dbt: {
    pluginId: "dbt",
    nodes: [
      wf("dbt.run", "dbt Run", "dbt run / Cloud job", "job"),
      wf("dbt.test", "dbt Test", "dbt test", "validate"),
      wf("dbt.build", "dbt Build", "run+test+snapshot", "job"),
      wf("dbt.seed", "dbt Seed", "Load seed CSVs", "job"),
      wf("dbt.snapshot", "dbt Snapshot", "Snapshot models", "job"),
      wf("dbt.compile", "dbt Compile", "Compile SQL only", "query", { category: "data" }),
      wf("dbt.docs", "dbt Docs", "Generate docs artifact", "job"),
      wf("dbt.jobStatus", "Cloud Job Status", "Poll dbt Cloud run", "status"),
    ],
  },

  spark: {
    pluginId: "spark",
    nodes: [
      wf("spark.submit", "Spark Submit", "spark-submit job", "job"),
      n("spark.sql", "Spark SQL", "SQL on session / thrift", "query"),
      wf("spark.jobStatus", "Job Status", "App / job poll", "status"),
      n("spark.createTable", "Create Table", "Spark catalog CREATE", "admin"),
      n("spark.read", "Spark Read", "DataFrame read format", "file"),
      n("spark.write", "Spark Write", "DataFrame write", "file"),
      wf("spark.cancel", "Cancel App", "Kill application", "admin"),
    ],
  },

  flink: {
    pluginId: "flink",
    nodes: [
      wf("flink.submit", "Flink Submit", "Upload JAR / run job", "job"),
      wf("flink.jobStatus", "Job Status", "JobManager status", "status"),
      wf("flink.cancel", "Cancel Job", "Cancel Flink job", "admin"),
      wf("flink.savepoint", "Savepoint", "Trigger savepoint", "admin"),
      n("flink.listJobs", "List Jobs", "Overview jobs", "list"),
      n("flink.jarList", "List JARs", "Uploaded jars", "list"),
      wf("flink.rescale", "Rescale Job", "Change parallelism", "admin"),
    ],
  },

  airbyte: {
    pluginId: "airbyte",
    nodes: [
      wf("airbyte.triggerSync", "Trigger Sync", "Trigger connection sync", "sync"),
      wf("airbyte.syncStatus", "Sync Status", "Job / attempt status", "status"),
      wf("airbyte.cancelSync", "Cancel Sync", "Cancel running job", "admin"),
      n("airbyte.listConnections", "List Connections", "Workspace connections", "list"),
      n("airbyte.listSources", "List Sources", "Configured sources", "list"),
      n("airbyte.listDestinations", "List Destinations", "Configured destinations", "list"),
      wf("airbyte.reset", "Reset Connection", "Reset data for connection", "admin"),
    ],
  },

  nifi: {
    pluginId: "nifi",
    nodes: [
      wf("nifi.startProcessGroup", "Start Process Group", "Schedule PG running", "job"),
      wf("nifi.stopProcessGroup", "Stop Process Group", "Stop PG", "admin"),
      n("nifi.listProcessGroups", "List Process Groups", "Flow inventory", "list"),
      n("nifi.queueStatus", "Queue Status", "Connection queue depth", "status"),
      n("nifi.provenance", "Provenance Query", "Provenance search", "query"),
      wf("nifi.updateVariable", "Update Variables", "Variable registry", "write", {
        category: "data",
      }),
      wf("nifi.createProcessor", "Create Processor", "Add processor (advanced)", "admin"),
    ],
  },

  great_expectations: {
    pluginId: "great_expectations",
    nodes: [
      wf("great_expectations.validate", "GX Validate", "Validate suite vs batch", "validate"),
      wf("great_expectations.checkpoint", "Run Checkpoint", "Checkpoint run", "validate"),
      n("great_expectations.listSuites", "List Suites", "Expectation suites", "list"),
      n("great_expectations.listCheckpoints", "List Checkpoints", "Checkpoint inventory", "list"),
      wf("great_expectations.createSuite", "Create Suite", "New expectation suite", "admin"),
      n("great_expectations.docs", "Build Data Docs", "Generate data docs", "job", {
        category: "control",
      }),
      n("great_expectations.profile", "Profile Batch", "Onboarding / profiler", "schema"),
    ],
  },

  temporal: {
    pluginId: "temporal",
    nodes: [
      wf("temporal.startWorkflow", "Start Workflow", "StartWorkflowExecution", "job"),
      wf("temporal.signal", "Signal Workflow", "Signal running workflow", "message", {
        category: "data",
      }),
      wf("temporal.query", "Query Workflow", "Query handler", "query", {
        category: "data",
      }),
      wf("temporal.cancel", "Cancel Workflow", "Request cancel", "admin"),
      wf("temporal.terminate", "Terminate", "Terminate workflow", "admin"),
      n("temporal.describe", "Describe Workflow", "Execution describe", "status"),
      n("temporal.list", "List Workflows", "List open / closed", "list"),
    ],
  },
};

export function getPluginCapability(pluginId: string): PluginCapability | undefined {
  return PLUGIN_CAPABILITIES[pluginId];
}

export function pluginNodesToTypeDefs(pluginId: string): NodeTypeDef[] {
  const cap = PLUGIN_CAPABILITIES[pluginId];
  if (!cap) return [];
  return cap.nodes.map((node) => ({
    type: node.type,
    category: node.category,
    label: node.label,
    description: node.description,
    requiresConnector: node.requiresConnector !== false,
    defaultOutputs: node.outputStage ? [node.outputStage] : undefined,
    color: categoryColor(node.category),
    pluginId,
  }));
}

function categoryColor(cat: NodeCategory): string {
  switch (cat) {
    case "data":
      return "#06b6d4";
    case "control":
      return "#F472B6";
    case "ai":
      return "#22D3EE";
    case "logic":
      return "#A78BFA";
    case "communication":
      return "#34D399";
    case "trigger":
      return "#F59E0B";
    default:
      return "#06b6d4";
  }
}

export function allPluginNodeTypes(): string[] {
  return Object.values(PLUGIN_CAPABILITIES).flatMap((c) =>
    c.nodes.map((n) => n.type),
  );
}

export function pluginIdForNodeType(type: string): string | undefined {
  for (const cap of Object.values(PLUGIN_CAPABILITIES)) {
    if (cap.nodes.some((n) => n.type === type)) return cap.pluginId;
  }
  return undefined;
}

/** Custom plugins get a generic 6-node pack keyed by connector type id */
export function customPluginNodes(
  pluginId: string,
  connectorType: string,
): PluginNodeSpec[] {
  const p = connectorType || pluginId;
  return [
    n(`${p}.query`, "Query / Read", "Read data via custom connector", "query"),
    n(`${p}.write`, "Write", "Write / upsert data", "write"),
    n(`${p}.execute`, "Execute", "Run command / statement", "write"),
    n(`${p}.list`, "List Objects", "List databases / topics / paths", "list"),
    n(`${p}.admin`, "Admin / Provision", "Create resources", "admin"),
    n(`${p}.health`, "Health Check", "Verify connectivity", "status"),
  ];
}
