const API_URL_STORAGE = "vynelix-api-url";
const API_KEY_STORAGE = "vynelix-api-key";

/**
 * Resolve API base URL for this browser session.
 * Priority: localStorage override → VITE_API_URL → same-host:8787 (remote) → localhost.
 */
export function getApiBase(): string {
  try {
    const stored = localStorage.getItem(API_URL_STORAGE)?.trim();
    if (stored) return stored.replace(/\/$/, "");
  } catch {
    /* ignore */
  }

  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    // Opened via LAN / remote IP / hostname — talk to API on same host
    if (
      hostname &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "[::1]"
    ) {
      return `${protocol}//${hostname}:8787`;
    }
  }

  return "http://localhost:8787";
}

export function setApiBase(url: string): void {
  try {
    const cleaned = url.trim().replace(/\/$/, "");
    if (cleaned) localStorage.setItem(API_URL_STORAGE, cleaned);
    else localStorage.removeItem(API_URL_STORAGE);
  } catch {
    /* ignore */
  }
}

export function clearApiBaseOverride(): void {
  try {
    localStorage.removeItem(API_URL_STORAGE);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = getStoredApiKey();
  const base = getApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // Fastify rejects bodyless DELETE requests that claim to contain JSON.
        ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error
        ? `Cannot reach API at ${base} (${err.message})`
        : `Cannot reach API at ${base}`,
      0,
      "NETWORK",
    );
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      String(data.error ?? res.statusText),
      res.status,
      data.code as string | undefined,
    );
  }
  return data as T;
}

export interface BackendWorkspaceSummary {
  workspaceId: string;
  name: string;
  currentVersion: string;
  updatedAt: string;
}

export interface BackendWorkspace {
  workspaceId: string;
  name: string;
  currentVersion: string;
  document: import("@/types/workspace").WorkspaceDocument;
  yaml: string;
  attachments: unknown[];
  privacy?: {
    purpose?: string;
    residency?: string;
    classification?: string;
    mayContainPersonalData?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BackendRun {
  runId: string;
  workspaceId: string;
  version: string;
  status: string;
  mode: string;
  runtime?: "python" | "notebook";
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
  };
}

export interface SecurityPolicy {
  authRequired: boolean;
  dataResidencyDefault: string;
  auditRetentionDays: number;
  runRetentionDays: number;
  encryptionAtRest: string;
  secretsInYaml: string;
  authConfigured: boolean;
  warnings: string[];
  disclaimer: string;
  contacts: { privacy: string; security: string };
  frameworks: Array<{
    id: string;
    region: string;
    title: string;
    controlsImplemented: string[];
  }>;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      authRequired?: boolean;
      residencyDefault?: string;
    }>("/health"),

  securityPolicy: () => request<SecurityPolicy>("/security/policy"),

  listWorkspaces: () =>
    request<{ items: BackendWorkspaceSummary[] }>("/workspaces"),

  getWorkspace: (id: string) => request<BackendWorkspace>(`/workspaces/${id}`),

  deleteWorkspace: (id: string) =>
    request<{
      ok: true;
      deleted: {
        workspace: number;
        versions: number;
        secrets: number;
        runs: number;
      };
    }>(`/workspaces/${id}`, { method: "DELETE" }),

  listVersions: (id: string) =>
    request<{
      items: Array<{
        version: string;
        createdAt: string;
        source: string;
        note?: string;
      }>;
    }>(`/workspaces/${id}/versions`),

  createWorkspace: (body: {
    document: import("@/types/workspace").WorkspaceDocument;
    yaml: string;
    secrets?: Array<{ secretRef: string; value: string; label?: string }>;
  }) =>
    request<BackendWorkspace>("/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  applyWorkspace: (
    id: string,
    body: {
      mode: "override" | "new_version";
      document: import("@/types/workspace").WorkspaceDocument;
      yaml: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
      note?: string;
    },
  ) =>
    request<{
      workspace: BackendWorkspace;
      previousVersion: string | null;
      appliedMode: string;
    }>(`/workspaces/${id}/apply`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  putSecret: (
    id: string,
    body: { secretRef: string; value: string; label?: string },
  ) =>
    request<{ ok: boolean }>(`/workspaces/${id}/secrets`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  startRun: (
    id: string,
    opts: {
      mode?: "dry-run" | "execute";
      runtime?: "python" | "notebook";
      document?: import("@/types/workspace").WorkspaceDocument;
      yaml?: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
    } = {},
  ) =>
    request<BackendRun>(`/workspaces/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        mode: opts.mode ?? "execute",
        runtime: opts.runtime ?? "python",
        // Always include canvas so Run never depends on a prior Apply
        document: opts.document,
        yaml: opts.yaml,
        ...(opts.secrets?.length ? { secrets: opts.secrets } : {}),
      }),
    }),

  listRuns: (id: string) =>
    request<{ items: BackendRun[] }>(`/workspaces/${id}/runs`),

  sendChat: (
    id: string,
    body: {
      message: string;
      sessionId?: string;
      document?: import("@/types/workspace").WorkspaceDocument;
      yaml?: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
    },
  ) =>
    request<{
      sessionId: string;
      reply: string;
      runId: string;
      status: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string; ts: string; runId?: string }>;
    }>(`/workspaces/${id}/chat`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listChatSessions: (id: string) =>
    request<{
      items: Array<{
        sessionId: string;
        title?: string;
        messages: Array<{ role: string; content: string; ts: string }>;
        updatedAt: string;
      }>;
    }>(`/workspaces/${id}/chat/sessions`),

  getChatSession: (id: string, sessionId: string) =>
    request<{
      sessionId: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string; ts: string; runId?: string }>;
    }>(`/workspaces/${id}/chat/sessions/${sessionId}`),

  deleteChatSession: (id: string, sessionId: string) =>
    request<{ ok: boolean }>(`/workspaces/${id}/chat/sessions/${sessionId}`, {
      method: "DELETE",
    }),

  getRunLogs: (runId: string) =>
    request<{
      runId: string;
      scrubbed?: boolean;
      files: Array<{ path: string; content: string }>;
    }>(`/runs/${runId}/logs`),

  getRunOutputs: (runId: string) =>
    request<{
      runId: string;
      scrubbed?: boolean;
      files: Array<{ path: string; content: string }>;
    }>(`/runs/${runId}/outputs`),

  getCodeLab: (id: string) =>
    request<{
      workspaceId: string;
      codeLab: {
        pythonSource?: string;
        notebookCells?: Array<{
          id: string;
          cell_type: "code" | "markdown";
          source: string;
        }>;
      };
    }>(`/workspaces/${id}/code`),

  saveCodeLab: (
    id: string,
    body: {
      pythonSource?: string;
      notebookCells?: Array<{
        id: string;
        cell_type: "code" | "markdown";
        source: string;
      }>;
    },
  ) =>
    request<{ ok: boolean }>(`/workspaces/${id}/code`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  executeCodeLab: (
    id: string,
    body: {
      mode: "python" | "notebook";
      pythonSource?: string;
      notebookCells?: Array<{
        id: string;
        cell_type: "code" | "markdown";
        source: string;
      }>;
      cellId?: string;
      document?: import("@/types/workspace").WorkspaceDocument;
      secrets?: Array<{ secretRef: string; value: string }>;
    },
  ) =>
    request<{
      runId: string;
      mode: string;
      status: string;
      localPath: string;
      logPath: string;
      stdout: string;
      stderr: string;
      exitCode: number | null;
    }>(`/workspaces/${id}/code/execute`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  enhanceWorkflowCode: (body: {
    workspaceId: string;
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      fingerprint: string;
      source: string;
    }>;
  }) =>
    request<{
      nodes: Array<{ id: string; source: string }>;
    }>(`/workspaces/${body.workspaceId}/codegen`, {
      method: "POST",
      body: JSON.stringify({
        provider: body.provider,
        model: body.model,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        nodes: body.nodes,
      }),
    }),

  listPlugins: () =>
    request<{
      items: Array<{
        pluginId: string;
        localPath: string;
        manifest?: Record<string, unknown>;
      }>;
    }>("/plugins"),

  installPlugin: (body: {
    pluginId: string;
    name: string;
    vendor?: string;
    category?: string;
    connectorType: string;
    accent?: string;
    badge?: string;
    description?: string;
    nodes: Array<{
      type: string;
      label: string;
      description: string;
      kind?: string;
    }>;
    configKeys?: string[];
  }) =>
    request<{
      pluginId: string;
      localPath: string;
      files: string[];
      nodesUnlocked: string[];
    }>("/plugins/install", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  uninstallPlugin: (id: string) =>
    request<{ ok: boolean; pluginId: string }>(`/plugins/${id}`, {
      method: "DELETE",
    }),

  getStudioSetup: () =>
    request<{
      configured: boolean;
      workspacePath: string;
      configPath: string;
      agentMdPath: string;
      llm: { kind: "opensource" | "licensed"; provider: string; model: string; baseUrl: string; apiKeySet: boolean };
      database: { mode: "local" | "remote"; name: string; uri: string };
    }>("/studio/setup"),

  saveStudioSetup: (body: {
    workspacePath: string;
    llmKind: "opensource" | "licensed";
    provider: string;
    model: string;
    baseUrl: string;
    apiKey?: string;
    mongoMode: "local" | "remote";
    databaseName: string;
    databaseUri: string;
  }) =>
    request<{ configured: boolean; agentMdPath: string; configPath: string }>("/studio/setup", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  listBrainProviders: () =>
    request<{
      items: Array<{
        id: string;
        label: string;
        baseUrl: string;
        model: string;
        needsKey: boolean;
      }>;
    }>("/agent/providers"),

  getAgentMemory: (id: string) =>
    request<{
      workspaceId: string;
      updatedAt: string;
      nodes: Record<
        string,
        {
          nodeId: string;
          label?: string;
          nodeType?: string;
          status: "success" | "failed" | "running" | "skipped";
          updatedAt: string;
          durationMs?: number;
          input?: unknown;
          output?: unknown;
          error?: string;
        }
      >;
    }>(`/workspaces/${id}/agent/memory`),

  listAgentExecutions: (id: string) =>
    request<{
      items: Array<{
        executionId: string;
        runId: string;
        status: "succeeded" | "failed";
        startedAt: string;
        finishedAt: string;
        nodeCount: number;
        error?: string;
      }>;
    }>(`/workspaces/${id}/agent/executions`),

  getAgentExecution: (id: string, executionId: string) =>
    request<{
      executionId: string;
      runId: string;
      status: "succeeded" | "failed";
      startedAt: string;
      finishedAt: string;
      error?: string;
      graph: { name?: string; nodes: unknown[]; edges: unknown[] };
      nodeIo: Array<{
        nodeId: string;
        label?: string;
        nodeType?: string;
        status: string;
        input?: unknown;
        output?: unknown;
        error?: string;
      }>;
      logs: { excerpt: string };
    }>(`/workspaces/${id}/agent/executions/${executionId}`),

  getAgentLogs: (id: string, kind: "success" | "failure", q?: string) =>
    request<{ kind: string; lines: string[] }>(
      `/workspaces/${id}/agent/logs?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    ),

  getBrain: (id: string) =>
    request<{
      brain: { provider: string; model: string; baseUrl: string; apiKeySet: boolean };
      turns: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
    }>(`/workspaces/${id}/agent/brain`),

  saveBrain: (
    id: string,
    body: { provider?: string; model?: string; baseUrl?: string; apiKey?: string },
  ) =>
    request<{ brain: { provider: string; model: string; baseUrl: string; apiKeySet: boolean } }>(
      `/workspaces/${id}/agent/brain`,
      { method: "PUT", body: JSON.stringify(body) },
    ),

  askBrain: (id: string, body: { message: string; graphSummary?: string }) =>
    request<{
      reply: string;
      provider: string;
      model: string;
      turns: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
    }>(`/workspaces/${id}/agent/chat`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
