/** Shared domain shapes stored in MongoDB */

export interface WorkspaceMeta {
  id: string;
  name: string;
  version: string;
  mode: "workflow" | "supervisor";
  description?: string;
  updatedAt?: string;
}

export interface ConnectorRef {
  id: string;
  type: string;
  mode?: string;
  label?: string;
  secretRef?: string;
  config?: Record<string, unknown>;
}

export interface WorkspaceDocument {
  workspace: WorkspaceMeta;
  connectors: ConnectorRef[];
  tools: unknown[];
  agents: unknown[];
  notebooks?: Array<{
    id: string;
    name: string;
    description?: string;
    cells: Array<{
      id: string;
      cell_type: "code" | "markdown";
      source: string;
    }>;
    updatedAt: string;
  }>;
  flow: {
    triggers: unknown[];
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
    error_handlers?: unknown[];
  };
}

export interface WorkspaceRecord {
  workspaceId: string;
  name: string;
  currentVersion: string;
  document: WorkspaceDocument;
  yaml: string;
  attachments: AttachmentMeta[];
  /** DPDP / US privacy metadata */
  privacy?: {
    purpose?: string;
    residency?: "US" | "IN" | "EU" | "GLOBAL";
    classification?: "public" | "internal" | "confidential" | "restricted";
    mayContainPersonalData?: boolean;
    retentionDays?: number;
  };
  /** Authored Python / Jupyter lab (peer to workflow) */
  codeLab?: {
    pythonSource?: string;
    notebookCells?: Array<{
      id: string;
      cell_type: "code" | "markdown";
      source: string;
    }>;
    updatedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceVersionRecord {
  workspaceId: string;
  version: string;
  document: WorkspaceDocument;
  yaml: string;
  attachments: AttachmentMeta[];
  createdAt: string;
  note?: string;
  source: "override" | "new_version" | "create";
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType?: string;
  size: number;
  /** Relative path under workspace attachments store */
  path: string;
  createdAt: string;
}

export interface SecretRecord {
  workspaceId: string;
  secretRef: string;
  ciphertext: string;
  iv: string;
  tag: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RunRuntime = "python" | "notebook";

export interface RunNodeOutput {
  runId: string;
  workspaceId: string;
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  path: string;
  generatedAt?: string;
  result?: unknown;
  summary?: unknown;
  model?: unknown;
  provider?: unknown;
  json?: unknown;
  text?: unknown;
  rowCount?: unknown;
  op?: unknown;
  live?: unknown;
  content: unknown;
  createdAt: string;
}

export interface RunRecord {
  runId: string;
  workspaceId: string;
  version: string;
  status: RunStatus;
  mode: "dry-run" | "execute";
  runtime: RunRuntime;
  localPath: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  nodeCount: number;
  logFiles: string[];
  artifacts?: {
    tasksYaml: string;
    secretsYaml: string;
    pythonRunner: string;
    notebook: string;
    outputsDir?: string;
    outputFiles?: string[];
    nodeOutputs?: Array<{
      nodeId: string;
      path: string;
      result?: unknown;
      summary?: unknown;
      model?: unknown;
      provider?: unknown;
      nodeType?: string;
    }>;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  runId?: string;
}

export interface ChatSession {
  sessionId: string;
  workspaceId: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
