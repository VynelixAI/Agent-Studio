/** Agent Studio workspace YAML / domain types */

export type WorkspaceMode = "workflow" | "supervisor";

export type NodeCategory =
  | "ai"
  | "data"
  | "logic"
  | "control"
  | "communication"
  | "trigger";

export type ConnectorMode = "local" | "atlas" | "iaas";

export type ConnectorType =
  | "mongodb"
  | "postgresql"
  | "snowflake"
  | "bigquery"
  | "kafka"
  | "s3"
  | "databricks"
  | "clickhouse"
  | "redis"
  | "elasticsearch"
  | "mysql"
  | "redshift"
  | "azure_blob"
  | "gcs"
  | "neo4j"
  | "cassandra"
  | "duckdb"
  | "trino"
  | "airflow"
  | "prefect"
  | "dagster"
  | "dbt"
  | "spark"
  | "flink"
  | "airbyte"
  | "nifi"
  | "great_expectations"
  | "temporal"
  | "rest"
  | "file"
  | "mcp"
  | string;

export interface ConnectorRef {
  id: string;
  type: ConnectorType;
  mode?: ConnectorMode;
  label?: string;
  /** Secret store reference — never plaintext in YAML */
  secretRef?: string;
  config?: Record<string, unknown>;
  /** Plugin catalog id that created this connector */
  pluginId?: string;
}

export interface ToolDef {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface AgentDef {
  id: string;
  name: string;
  model?: string;
  systemPrompt?: string;
  tools?: string[];
}

export interface FlowTrigger {
  type: "manual" | "schedule" | "webhook" | "chat" | "error";
  config?: Record<string, unknown>;
}

export interface FlowNode {
  id: string;
  category: NodeCategory;
  type: string;
  label?: string;
  connector?: string;
  inputs?: string[];
  outputs?: string[];
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface ErrorHandler {
  id: string;
  on: string;
  action: "retry" | "skip" | "branch" | "abort";
  target?: string;
  config?: Record<string, unknown>;
}

export interface FlowDef {
  triggers: FlowTrigger[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  error_handlers?: ErrorHandler[];
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  version: string;
  mode: WorkspaceMode;
  description?: string;
  updatedAt?: string;
}

export interface WorkspaceDocument {
  workspace: WorkspaceMeta;
  connectors: ConnectorRef[];
  tools: ToolDef[];
  agents: AgentDef[];
  /** Named notebooks authored in the Notebook menu — selectable on Notebook nodes */
  notebooks?: SavedNotebook[];
  flow: FlowDef;
}

export interface SavedNotebookCell {
  id: string;
  cell_type: "code" | "markdown";
  source: string;
}

export interface SavedNotebook {
  id: string;
  name: string;
  description?: string;
  cells: SavedNotebookCell[];
  updatedAt: string;
}

export interface RunLogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  nodeId?: string;
  message: string;
  detail?: unknown;
}

export interface StageCacheEntry {
  key: string;
  nodeId: string;
  preview: unknown;
  rowCount?: number;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  severity: "error" | "warning";
  nodeId?: string;
  message: string;
  suggestion?: string;
}
