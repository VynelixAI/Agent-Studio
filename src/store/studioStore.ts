import {
  removeConnectorFromLibrary,
  upsertConnectorLibrary,
} from "@/core/connectorLibrary";
import { create } from "zustand";
import { getNodeDef } from "@/core/nodeRegistry";
import { defaultConfigForType, getNodeSchema } from "@/core/nodeSchemas";
import { getPluginDrivenSchema } from "@/core/pluginNodeSchemas";
import {
  createEmptyWorkspace,
  enrichmentTemplate,
  mongoCdcTemplate,
  mongoNotebookS3Template,
  ragIngestTemplate,
} from "@/core/templates";
import {
  applyEdgeStageInputs,
  ensureUniqueStageOutputs,
  syncTriggersFromNodes,
  uniqueStageKey,
} from "@/core/stageWiring";
import { assessFlow } from "@/core/flowReadiness";
import { validateWorkspace } from "@/core/validate";
import { workspaceToYaml, yamlToWorkspace } from "@/core/yamlCodec";
import { ApiError, api } from "@/lib/api";
import { saveWorkspaceCache } from "@/lib/cacheDb";
import { isWorkspaceCacheSkipped } from "@/lib/workspaceCacheGate";
import {
  newSavedNotebookId,
  slimNotebookCells,
  upsertSavedNotebook,
} from "@/core/notebookLibrary";
import {
  customRecordsToTemplates,
  saveCustomTemplate,
} from "@/core/customTemplateLibrary";
import { getStandardTemplate } from "@/core/standardTemplates";
import {
  type NotebookCell,
} from "@/core/codeLabDefaults";
import { loadCodegenSettings } from "@/core/codegenSettings";
import {
  generateNodeClass,
  generateWorkflowCodeLab,
  nodeFingerprint,
  type NodeCodeOverlay,
} from "@/core/workflowCodegen";
import {
  loadStandaloneNotebookDraft,
  loadStandaloneNotebooks,
  loadStandalonePython,
  saveStandaloneNotebookDraft,
  saveStandaloneNotebooks,
  saveStandalonePython,
} from "@/core/standaloneCodeLab";
import type {
  ConnectorRef,
  FlowEdge,
  FlowNode,
  RunLogEntry,
  SavedNotebook,
  StageCacheEntry,
  ValidationIssue,
  WorkspaceDocument,
} from "@/types/workspace";

type PendingSecret = { secretRef: string; value: string; label?: string };

const PENDING_SECRETS_KEY = "vynelix-pending-secrets";

function readPendingSecrets(): PendingSecret[] {
  try {
    const raw = sessionStorage.getItem(PENDING_SECRETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingSecret[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Merge in-memory queue + sessionStorage so connector password edits always reach Run. */
function mergePendingSecrets(live: PendingSecret[]): PendingSecret[] {
  const byRef = new Map<string, PendingSecret>();
  for (const s of readPendingSecrets()) byRef.set(s.secretRef, s);
  for (const s of live) byRef.set(s.secretRef, s);
  return [...byRef.values()];
}

function writePendingSecrets(secrets: PendingSecret[]) {
  try {
    if (!secrets.length) sessionStorage.removeItem(PENDING_SECRETS_KEY);
    else sessionStorage.setItem(PENDING_SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    /* ignore quota */
  }
}
export type StudioView = "canvas" | "yaml" | "split" | "python" | "notebook";
export type LeftTab =
  | "workspaces"
  | "palette"
  | "templates"
  | "plugins"
  | "connectors";
export type BottomTab = "console" | "errors" | "stage" | "outputs" | "runs";
export type ApplyMode = "override" | "new_version";
export type RunRuntime = "python" | "notebook" | "workflow";
export type CodeLabContext = "workflow" | "standalone";

interface StudioState {
  document: WorkspaceDocument;
  yamlText: string;
  yamlError: string | null;
  selectedNodeId: string | null;
  view: StudioView;
  leftTab: LeftTab;
  /** Which Templates panel sub-tab to show */
  templatesSubTab: "standard" | "featured" | "custom";
  bottomTab: BottomTab;
  bottomOpen: boolean;
  issues: ValidationIssue[];
  logs: RunLogEntry[];
  stages: StageCacheEntry[];
  runOutputs: Array<{ path: string; content: string }>;
  /** Connector API keys waiting to encrypt on Create / Apply */
  pendingSecrets: PendingSecret[];
  isDirty: boolean;
  syncingFrom: "canvas" | "yaml" | null;

  backendExists: boolean;
  backendSynced: boolean;
  applyConfirmOpen: boolean;
  applying: boolean;
  running: boolean;
  runRuntime: RunRuntime;
  codeLabContext: CodeLabContext;
  lastRunId: string | null;
  /** Shown after a test so the user can save to MongoDB or make a template. */
  postRunOffer: { runId: string; status: string } | null;
  /** Pre-run / dry-run readiness. Null when the sheet is closed. */
  flight: import("@/core/flowReadiness").FlowReadiness | null;
  flightIntent: "dry-run" | "run";
  apiStatus: "unknown" | "ok" | "down";

  pythonSource: string;
  notebookCells: NotebookCell[];
  nodeCodeOverlays: Record<string, NodeCodeOverlay>;
  enhancingCode: boolean;
  standalonePythonSource: string;
  standaloneNotebookCells: NotebookCell[];
  standaloneNotebooks: SavedNotebook[];
  activeNotebookId: string | null;
  activeNotebookName: string;

  setView: (view: StudioView) => void;
  openWorkflowCodeView: (view: "python" | "notebook") => void;
  openStandaloneCodeLab: (view: "python" | "notebook") => void;
  setLeftTab: (tab: LeftTab) => void;
  setTemplatesSubTab: (tab: "standard" | "featured" | "custom") => void;
  setBottomTab: (tab: BottomTab) => void;
  setBottomOpen: (open: boolean) => void;
  selectNode: (id: string | null) => void;

  loadDocument: (doc: WorkspaceDocument, opts?: { fromBackend?: boolean }) => void;
  newWorkspace: () => void;
  /** Instantiate a template as an editable local workflow (not saved until Apply). */
  loadTemplate: (id: string) => void;
  loadFromBackend: (workspaceId: string) => Promise<void>;
  checkApi: () => Promise<void>;

  updateMeta: (patch: Partial<WorkspaceDocument["workspace"]>) => void;
  setNodes: (nodes: FlowNode[]) => void;
  setEdges: (edges: FlowEdge[]) => void;
  addNode: (type: string, position: { x: number; y: number }) => void;
  updateNode: (id: string, patch: Partial<FlowNode>) => void;
  removeNode: (id: string) => void;
  upsertPluginConnector: (connector: import("@/types/workspace").ConnectorRef) => void;
  removePluginConnector: (connectorId: string) => void;
  queuePendingSecret: (secret: PendingSecret) => void;
  clearPendingSecrets: () => void;

  setYamlText: (text: string) => void;
  /** Parse YAML into canvas only (local). */
  applyYamlLocal: () => boolean;
  /** Open confirm dialog to persist to MongoDB. */
  requestApplyToBackend: () => void;
  closeApplyConfirm: () => void;
  confirmApplyToBackend: (mode: ApplyMode) => Promise<void>;
  syncYamlFromCanvas: () => void;

  revalidate: () => void;
  dryRun: () => void;
  closeFlight: () => void;
  applyFlightFix: (nodeId: string, config: Record<string, unknown>) => void;
  setRunRuntime: (runtime: RunRuntime) => void;
  /** Persist must exist; materialize locally on API host and execute. */
  executeRun: (opts?: { skipFlight?: boolean }) => Promise<void>;

  setPythonSource: (source: string) => void;
  setNotebookCells: (cells: NotebookCell[]) => void;
  updateNotebookCell: (id: string, patch: Partial<NotebookCell>) => void;
  addNotebookCell: (type: NotebookCell["cell_type"], afterId?: string) => void;
  removeNotebookCell: (id: string) => void;
  insertNotebookCellAfter: (
    afterId: string | null,
    type: NotebookCell["cell_type"],
  ) => void;
  setActiveNotebookName: (name: string) => void;
  /** Save current cells into workspace.notebooks library (selectable on nodes) */
  saveNotebookToLibrary: (name?: string, options?: { asNew?: boolean }) => void;
  openSavedNotebook: (id: string) => void;
  deleteSavedNotebook: (id: string) => void;
  newUntitledNotebook: () => void;
  saveCodeLab: () => Promise<void>;
  executeCodeLab: (mode: "python" | "notebook", cellId?: string) => Promise<void>;
  enhanceWorkflowCode: () => Promise<void>;
  loadCodeLabFromBackend: (workspaceId: string) => Promise<void>;
  convertCurrentToTemplate: (opts: {
    name: string;
    description: string;
  }) => { id: string } | null;

  clearLogs: () => void;
  dismissPostRunOffer: () => void;
  pushLog: (entry: Omit<RunLogEntry, "id" | "ts"> & { id?: string; ts?: string }) => void;
}

function withYaml(doc: WorkspaceDocument) {
  const stamped = {
    ...doc,
    workspace: { ...doc.workspace, updatedAt: new Date().toISOString() },
  };
  return { document: stamped, yamlText: workspaceToYaml(stamped) };
}

export { skipWorkspaceCache } from "@/lib/workspaceCacheGate";

function withGraphDefaults(doc: WorkspaceDocument): WorkspaceDocument {
  const unique = ensureUniqueStageOutputs(doc.flow.nodes);
  const nodes = applyEdgeStageInputs(unique, doc.flow.edges);
  return {
    ...doc,
    flow: {
      ...doc.flow,
      nodes,
      triggers: syncTriggersFromNodes(nodes, doc.flow.triggers),
    },
  };
}

/** Commit document changes originating from the canvas (keeps YAML in sync; guards Monaco). */
function commitCanvasDocument(
  set: (partial: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)) => void,
  get: () => StudioState,
  doc: WorkspaceDocument,
  extra?: Partial<StudioState>,
) {
  const next = withYaml(withGraphDefaults(doc));
  const generatedCodeLab = workflowCodeLab(get, next.document);
  persist(next.document, next.yamlText);
  set({
    ...next,
    ...(get().codeLabContext === "workflow" ? generatedCodeLab : {}),
    isDirty: true,
    backendSynced: false,
    syncingFrom: "canvas",
    issues: validateWorkspace(next.document),
    ...extra,
  });
  // Hold the guard long enough that Monaco's delayed onChange cannot overwrite with stale YAML
  window.setTimeout(() => {
    if (get().syncingFrom === "canvas") set({ syncingFrom: null });
  }, 350);
}

function persist(doc: WorkspaceDocument, yaml: string) {
  if (isWorkspaceCacheSkipped(doc.workspace.id)) return;
  void saveWorkspaceCache(doc, yaml);
}

function workflowCodeLab(get: () => StudioState, doc?: WorkspaceDocument) {
  return generateWorkflowCodeLab(
    doc ?? get().document,
    get().nodeCodeOverlays,
  );
}

function logEntry(
  partial: Omit<RunLogEntry, "id" | "ts"> & { id?: string; ts?: string },
): RunLogEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    ts: partial.ts ?? new Date().toISOString(),
    level: partial.level,
    nodeId: partial.nodeId,
    message: partial.message,
    detail: partial.detail,
  };
}

let nodeCounter = 0;

export const useStudioStore = create<StudioState>((set, get) => {
  const initial = mongoCdcTemplate();
  const { document, yamlText } = withYaml(initial);
  const initialCodeLab = generateWorkflowCodeLab(document);
  const standalonePythonSource = loadStandalonePython();
  const standaloneNotebookCells = loadStandaloneNotebookDraft();
  const standaloneNotebooks = loadStandaloneNotebooks();

  const persistStandaloneCells = (notebookCells: NotebookCell[]) => {
    saveStandaloneNotebookDraft(notebookCells);
    const state = get();
    let notebooks = state.standaloneNotebooks;
    if (state.activeNotebookId) {
      notebooks = notebooks.map((notebook) =>
        notebook.id === state.activeNotebookId
          ? {
              ...notebook,
              name: state.activeNotebookName,
              cells: slimNotebookCells(notebookCells),
              updatedAt: new Date().toISOString(),
            }
          : notebook,
      );
      saveStandaloneNotebooks(notebooks);
    }
    set({
      notebookCells,
      standaloneNotebookCells: notebookCells,
      standaloneNotebooks: notebooks,
    });
  };

  return {
    document,
    yamlText,
    yamlError: null,
    selectedNodeId: null,
    view: "split",
    leftTab: "palette",
    templatesSubTab: "standard",
    bottomTab: "console",
    bottomOpen: true,
    issues: validateWorkspace(document),
    logs: [
      logEntry({
        level: "info",
        message: "Agent Studio ready — Run executes the canvas; Apply saves to MongoDB when you choose",
      }),
    ],
    stages: [],
    runOutputs: [],
    pendingSecrets: readPendingSecrets(),
    isDirty: false,
    syncingFrom: null,
    backendExists: false,
    backendSynced: false,
    applyConfirmOpen: false,
    applying: false,
    running: false,
    runRuntime: "workflow",
    codeLabContext: "workflow",
    lastRunId: null,
    postRunOffer: null,
    flight: null,
    flightIntent: "dry-run",
    apiStatus: "unknown",
    nodeCodeOverlays: {},
    enhancingCode: false,
    ...initialCodeLab,
    standalonePythonSource,
    standaloneNotebookCells,
    standaloneNotebooks,
    activeNotebookId: null,
    activeNotebookName: "untitled-notebook",

    setView: (view) => {
      set({
        view,
        ...(view === "canvas" || view === "split" || view === "yaml"
          ? {
              codeLabContext: "workflow" as const,
              ...workflowCodeLab(get),
            }
          : {}),
      });
      if (view === "python") set({ runRuntime: "python" });
      if (view === "notebook") set({ runRuntime: "notebook" });
      if (view === "canvas" || view === "split" || view === "yaml") {
        set({ runRuntime: "workflow" });
      }
    },
    openWorkflowCodeView: (view) => {
      set({
        view,
        codeLabContext: "workflow",
        runRuntime: view,
        ...workflowCodeLab(get),
      });
    },
    openStandaloneCodeLab: (view) => {
      const state = get();
      set({
        view,
        codeLabContext: "standalone",
        runRuntime: view,
        pythonSource: state.standalonePythonSource,
        notebookCells: state.standaloneNotebookCells,
      });
    },
    setLeftTab: (leftTab) => set({ leftTab }),
    setTemplatesSubTab: (templatesSubTab) => set({ templatesSubTab }),
    setBottomTab: (bottomTab) => set({ bottomTab }),
    setBottomOpen: (bottomOpen) => set({ bottomOpen }),
    selectNode: (selectedNodeId) => set({ selectedNodeId }),

    pushLog: (entry) => {
      set({ logs: [logEntry(entry), ...get().logs].slice(0, 300) });
    },

    checkApi: async () => {
      try {
        await api.health();
        set({ apiStatus: "ok" });
      } catch {
        set({ apiStatus: "down" });
      }
    },

    loadDocument: (doc, opts) => {
      for (const c of doc.connectors) {
        upsertConnectorLibrary(c);
      }
      const next = withYaml(doc);
      const generatedCodeLab = workflowCodeLab(get, next.document);
      persist(next.document, next.yamlText);
      set({
        ...next,
        ...(get().codeLabContext === "workflow" ? generatedCodeLab : {}),
        yamlError: null,
        selectedNodeId: null,
        issues: validateWorkspace(next.document),
        isDirty: false,
        stages: [],
        runOutputs: [],
        syncingFrom: "canvas",
        backendExists: opts?.fromBackend ?? false,
        backendSynced: opts?.fromBackend ?? false,
      });
      window.setTimeout(() => {
        if (get().syncingFrom === "canvas") set({ syncingFrom: null });
      }, 350);
    },

    newWorkspace: () => {
      // Persist current connectors into the library before wiping the canvas
      for (const c of get().document.connectors) {
        upsertConnectorLibrary(c);
      }
      get().loadDocument(createEmptyWorkspace());
      set({
        ...workflowCodeLab(get),
        backendExists: false,
        backendSynced: false,
        codeLabContext: "workflow",
        runRuntime: "workflow",
        selectedNodeId: null,
        stages: [],
        runOutputs: [],
        yamlError: null,
        logs: get().logs.slice(0, 20),
        view: "split",
        activeNotebookId: null,
        activeNotebookName: "untitled-notebook",
      });
      get().pushLog({
        level: "info",
        message:
          "New empty workspace — blank canvas & YAML. Add nodes from the palette; Apply only to save to MongoDB.",
      });
    },

    loadTemplate: (id) => {
      const afterLoad = (label: string) => {
        set({
          ...workflowCodeLab(get),
          backendExists: false,
          backendSynced: false,
          codeLabContext: "workflow",
          runRuntime: "workflow",
          view: "split",
          leftTab: "palette",
        });
        get().pushLog({
          level: "info",
          message: `${label} — editable workflow ready. Configure Conn if needed, then Run to test (Apply only when you want MongoDB).`,
        });
      };

      if (id === "de-mongo-s3") {
        get().loadDocument(mongoNotebookS3Template());
        set({
          activeNotebookId: null,
          activeNotebookName: "de-mongo-notebook-s3-workflow",
        });
        afterLoad("Loaded DE demo: Mongo → Notebook → S3");
        return;
      }
      if (id === "mongo-cdc") {
        get().loadDocument(mongoCdcTemplate());
        afterLoad("Loaded Mongo CDC template");
        return;
      }
      if (id === "enrichment") {
        get().loadDocument(enrichmentTemplate());
        afterLoad("Loaded enrichment template");
        return;
      }
      if (id === "rag-ingest") {
        get().loadDocument(ragIngestTemplate());
        afterLoad("Loaded RAG ingest template");
        return;
      }

      const custom = customRecordsToTemplates().find((t) => t.id === id);
      if (custom) {
        get().loadDocument(custom.create());
        afterLoad(`Converted custom template “${custom.name}” to workflow`);
        return;
      }

      const std = getStandardTemplate(id);
      if (std) {
        get().loadDocument(std.create());
        afterLoad(
          `Converted “${std.name}” to workflow (${std.nodeCount} nodes)`,
        );
        return;
      }

      get().pushLog({
        level: "warn",
        message: `Template not found: ${id}`,
      });
    },

    convertCurrentToTemplate: ({ name, description }) => {
      try {
        const rec = saveCustomTemplate({
          name,
          description,
          document: get().document,
        });
        get().pushLog({
          level: "info",
          message: `Saved custom template “${rec.name}” (${rec.nodeCount} nodes) — see Templates → Custom`,
        });
        set({ leftTab: "templates", templatesSubTab: "custom" });
        return { id: rec.id };
      } catch (err) {
        get().pushLog({
          level: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to convert workflow to template",
        });
        return null;
      }
    },

    loadFromBackend: async (workspaceId) => {
      try {
        const ws = await api.getWorkspace(workspaceId);
        get().loadDocument(ws.document, { fromBackend: true });
        set({
          yamlText: ws.yaml,
          backendExists: true,
          backendSynced: true,
          apiStatus: "ok",
        });
        get().pushLog({
          level: "info",
          message: `Loaded ${ws.name} v${ws.currentVersion} from MongoDB`,
        });
      } catch (err) {
        get().pushLog({
          level: "error",
          message: err instanceof Error ? err.message : "Failed to load workspace",
        });
      }
    },

    updateMeta: (patch) => {
      const doc = {
        ...get().document,
        workspace: { ...get().document.workspace, ...patch },
      };
      commitCanvasDocument(set, get, doc);
    },

    setNodes: (nodes) => {
      const doc = { ...get().document, flow: { ...get().document.flow, nodes } };
      commitCanvasDocument(set, get, doc);
    },

    setEdges: (edges) => {
      const doc = { ...get().document, flow: { ...get().document.flow, edges } };
      commitCanvasDocument(set, get, doc);
    },

    addNode: (type, position) => {
      const def = getNodeDef(type);
      if (!def) return;
      const schema =
        getNodeSchema(type) ?? getPluginDrivenSchema(type);
      nodeCounter += 1;
      const id = `${type.replace(/\./g, "_")}_${nodeCounter}`;
      const node: FlowNode = {
        id,
        category: def.category,
        type: def.type,
        label: def.label,
        position,
        outputs: [uniqueStageKey({ id })],
        config: {
          ...(schema?.defaultConfig ?? {}),
          ...defaultConfigForType(type),
          ...(schema && !getNodeSchema(type)
            ? Object.fromEntries(
                schema.fields
                  .filter(
                    (f) =>
                      !f.key.startsWith("__") && f.defaultValue !== undefined,
                  )
                  .map((f) => [f.key, f.defaultValue]),
              )
            : {}),
        },
      };
      get().setNodes([...get().document.flow.nodes, node]);
      set({ selectedNodeId: id });
    },

    updateNode: (id, patch) => {
      const fixed = get().document.flow.nodes.map((n) => {
        if (n.id !== id) return n;
        const { config: patchConfig, ...rest } = patch;
        return {
          ...n,
          ...rest,
          ...(patchConfig !== undefined ? { config: patchConfig } : {}),
        };
      });
      get().setNodes(fixed);
    },

    removeNode: (id) => {
      const nodes = get().document.flow.nodes.filter((n) => n.id !== id);
      const edges = get().document.flow.edges.filter(
        (e) => e.source !== id && e.target !== id,
      );
      const doc = {
        ...get().document,
        flow: { ...get().document.flow, nodes, edges },
      };
      commitCanvasDocument(set, get, doc, {
        selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      });
    },

    upsertPluginConnector: (connector: ConnectorRef) => {
      upsertConnectorLibrary(connector);
      const existing = get().document.connectors;
      const idx = existing.findIndex((c) => c.id === connector.id);
      const connectors =
        idx >= 0
          ? existing.map((c, i) => (i === idx ? { ...c, ...connector } : c))
          : [...existing, connector];
      commitCanvasDocument(set, get, { ...get().document, connectors });
    },

    removePluginConnector: (connectorId: string) => {
      removeConnectorFromLibrary(connectorId);
      const connectors = get().document.connectors.filter(
        (c) => c.id !== connectorId,
      );
      const flow = {
        ...get().document.flow,
        nodes: get().document.flow.nodes.map((n) =>
          n.connector === connectorId
            ? { ...n, connector: undefined }
            : n,
        ),
      };
      commitCanvasDocument(set, get, { ...get().document, connectors, flow });
    },

    queuePendingSecret: (secret) => {
      const rest = get().pendingSecrets.filter(
        (s) => s.secretRef !== secret.secretRef,
      );
      const pendingSecrets = [...rest, secret];
      writePendingSecrets(pendingSecrets);
      set({ pendingSecrets });
    },

    clearPendingSecrets: () => {
      writePendingSecrets([]);
      set({ pendingSecrets: [] });
    },

    setYamlText: (yamlText) => set({ yamlText, isDirty: true, backendSynced: false }),

    applyYamlLocal: () => {
      try {
        const doc = yamlToWorkspace(get().yamlText);
        const generatedCodeLab = workflowCodeLab(get, doc);
        persist(doc, get().yamlText);
        set({
          document: doc,
          ...(get().codeLabContext === "workflow" ? generatedCodeLab : {}),
          yamlError: null,
          issues: validateWorkspace(doc),
          isDirty: true,
          backendSynced: false,
          syncingFrom: "yaml",
        });
        queueMicrotask(() => set({ syncingFrom: null }));
        return true;
      } catch (err) {
        set({
          yamlError: err instanceof Error ? err.message : "YAML parse error",
        });
        return false;
      }
    },

    requestApplyToBackend: () => {
      if (!get().applyYamlLocal()) return;
      const id = get().document.workspace.id;
      void api
        .getWorkspace(id)
        .then(() => set({ backendExists: true, applyConfirmOpen: true, apiStatus: "ok" }))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            set({ backendExists: false, applyConfirmOpen: true, apiStatus: "ok" });
            return;
          }
          // API down — still allow confirm; apply will surface error
          set({
            backendExists: false,
            applyConfirmOpen: true,
            apiStatus: "down",
          });
          get().pushLog({
            level: "warn",
            message:
              "API unreachable — start MongoDB + server (`docker compose up -d mongo` then `npm run dev:server`)",
          });
        });
    },

    closeApplyConfirm: () => set({ applyConfirmOpen: false }),

    confirmApplyToBackend: async (mode) => {
      set({ applying: true });
      const { document, yamlText, pendingSecrets } = get();
      const secretsPayload =
        pendingSecrets.length > 0 ? pendingSecrets : undefined;
      try {
        if (!get().backendExists) {
          const created = await api.createWorkspace({
            document,
            yaml: yamlText,
            secrets: secretsPayload,
          });
          get().loadDocument(created.document, { fromBackend: true });
          set({
            yamlText: created.yaml,
            applyConfirmOpen: false,
            applying: false,
            isDirty: false,
            backendExists: true,
            backendSynced: true,
            apiStatus: "ok",
            pendingSecrets: [],
          });
          writePendingSecrets([]);
          get().pushLog({
            level: "info",
            message: `Created workspace ${created.workspaceId} v${created.currentVersion} in MongoDB${
              secretsPayload?.length
                ? ` · ${secretsPayload.length} secret(s) encrypted`
                : ""
            }`,
          });
          return;
        }

        const result = await api.applyWorkspace(document.workspace.id, {
          mode,
          document,
          yaml: yamlText,
          secrets: secretsPayload,
          note:
            mode === "override"
              ? "User confirmed override"
              : "User confirmed new version",
        });

        get().loadDocument(result.workspace.document, { fromBackend: true });
        set({
          yamlText: result.workspace.yaml,
          applyConfirmOpen: false,
          applying: false,
          isDirty: false,
          backendExists: true,
          backendSynced: true,
          apiStatus: "ok",
          pendingSecrets: [],
        });
        writePendingSecrets([]);
        get().pushLog({
          level: "info",
          message: `Applied (${mode}) → v${result.workspace.currentVersion}${
            result.previousVersion ? ` (was v${result.previousVersion})` : ""
          }${
            secretsPayload?.length
              ? ` · ${secretsPayload.length} secret(s) encrypted`
              : ""
          }`,
        });
      } catch (err) {
        set({ applying: false });
        get().pushLog({
          level: "error",
          message: err instanceof Error ? err.message : "Apply to MongoDB failed",
        });
        set({ bottomOpen: true, bottomTab: "console" });
      }
    },

    syncYamlFromCanvas: () => {
      const next = withYaml(get().document);
      set({ yamlText: next.yamlText, syncingFrom: "canvas" });
      queueMicrotask(() => set({ syncingFrom: null }));
    },

    revalidate: () => {
      set({ issues: validateWorkspace(get().document) });
    },

    closeFlight: () => set({ flight: null }),

    applyFlightFix: (nodeId, config) => {
      get().updateNode(nodeId, { config });
      get().selectNode(nodeId);
      set({ flight: assessFlow(get().document) });
    },

    dryRun: () => {
      const { document, issues } = get();
      const flight = assessFlow(document);
      const errors = issues.filter((i) => i.severity === "error");
      const logs: RunLogEntry[] = [
        logEntry({
          level: flight.willRun ? "info" : "warn",
          message: `Dry-run — ${flight.headline}`,
        }),
        logEntry({
          level: "info",
          message: `Client dry-run — ${document.workspace.name} v${document.workspace.version}`,
        }),
      ];
      set({ flight, flightIntent: "dry-run" });

      if (errors.length) {
        logs.push(
          logEntry({
            level: "error",
            message: `Blocked: ${errors.length} validation error(s)`,
          }),
        );
        set({
          logs: [...logs, ...get().logs],
          bottomOpen: true,
          bottomTab: "errors",
        });
        return;
      }

      const stages: StageCacheEntry[] = [];
      for (const node of document.flow.nodes) {
        logs.push(
          logEntry({
            level: "info",
            nodeId: node.id,
            message: `▶ ${node.label ?? node.id} (${node.type})`,
          }),
        );
        if (node.outputs?.length) {
          for (const key of node.outputs) {
            stages.push({
              key,
              nodeId: node.id,
              preview: { ok: true, from: node.id },
              rowCount: 1,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
      logs.push(logEntry({ level: "info", message: "Client dry-run finished" }));
      set({
        logs: [...logs.reverse(), ...get().logs].slice(0, 300),
        stages,
        bottomOpen: true,
        bottomTab: "console",
      });
    },

    setRunRuntime: (runRuntime) => set({ runRuntime }),

    setPythonSource: (pythonSource) => {
      if (get().codeLabContext === "standalone") {
        saveStandalonePython(pythonSource);
        set({ pythonSource, standalonePythonSource: pythonSource });
        return;
      }
      set({ pythonSource });
    },
    setNotebookCells: (notebookCells) => {
      if (get().codeLabContext === "standalone") {
        persistStandaloneCells(notebookCells);
        return;
      }
      set({ notebookCells });
    },
    updateNotebookCell: (id, patch) => {
      const notebookCells = get().notebookCells.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      );
      if (get().codeLabContext === "standalone") {
        persistStandaloneCells(notebookCells);
      } else {
        set({ notebookCells });
      }
    },
    addNotebookCell: (cell_type, afterId) => {
      get().insertNotebookCellAfter(afterId ?? null, cell_type);
    },
    insertNotebookCellAfter: (afterId, cell_type) => {
      const cell: NotebookCell = {
        id: `cell_${crypto.randomUUID().slice(0, 8)}`,
        cell_type,
        status: "idle",
        execution_count: cell_type === "code" ? null : undefined,
        source:
          cell_type === "code"
            ? "# COMMAND ----------\n"
            : "## New markdown cell\n",
      };
      const cells = get().notebookCells;
      let notebookCells: NotebookCell[];
      if (!afterId) {
        notebookCells = [...cells, cell];
      } else {
        const idx = cells.findIndex((c) => c.id === afterId);
        if (idx < 0) {
          notebookCells = [...cells, cell];
        } else {
          notebookCells = [...cells];
          notebookCells.splice(idx + 1, 0, cell);
        }
      }
      if (get().codeLabContext === "standalone") {
        persistStandaloneCells(notebookCells);
      } else {
        set({ notebookCells });
      }
    },
    removeNotebookCell: (id) => {
      const notebookCells = get().notebookCells.filter((c) => c.id !== id);
      if (get().codeLabContext === "standalone") {
        persistStandaloneCells(notebookCells);
      } else {
        set({ notebookCells });
      }
    },

    setActiveNotebookName: (activeNotebookName) => {
      if (get().codeLabContext === "standalone" && get().activeNotebookId) {
        const standaloneNotebooks = get().standaloneNotebooks.map((notebook) =>
          notebook.id === get().activeNotebookId
            ? {
                ...notebook,
                name: activeNotebookName,
                updatedAt: new Date().toISOString(),
              }
            : notebook,
        );
        saveStandaloneNotebooks(standaloneNotebooks);
        set({ activeNotebookName, standaloneNotebooks });
        return;
      }
      set({ activeNotebookName });
    },

    saveNotebookToLibrary: (name, options) => {
      const title = (name ?? get().activeNotebookName).trim() || "untitled-notebook";
      const existingId = options?.asNew ? null : get().activeNotebookId;
      const id = existingId ?? newSavedNotebookId();
      const notebook: SavedNotebook = {
        id,
        name: title,
        cells: slimNotebookCells(get().notebookCells),
        updatedAt: new Date().toISOString(),
      };
      if (get().codeLabContext === "standalone") {
        const standaloneNotebooks = upsertSavedNotebook(
          get().standaloneNotebooks,
          notebook,
        );
        saveStandaloneNotebooks(standaloneNotebooks);
        saveStandaloneNotebookDraft(get().notebookCells);
        set({
          standaloneNotebooks,
          standaloneNotebookCells: get().notebookCells,
          activeNotebookId: id,
          activeNotebookName: title,
        });
        get().pushLog({
          level: "info",
          message: `Saved independent notebook “${title}” locally`,
        });
        return;
      }
      const notebooks = upsertSavedNotebook(
        get().document.notebooks ?? [],
        notebook,
      );
      const doc = { ...get().document, notebooks };
      const next = withYaml(doc);
      persist(next.document, next.yamlText);
      set({
        ...next,
        activeNotebookId: id,
        activeNotebookName: title,
        isDirty: true,
        backendSynced: false,
        issues: validateWorkspace(next.document),
      });
      get().pushLog({
        level: "info",
        message: `Notebook “${title}” saved to library (${id}) — select it on a Notebook node, then Apply`,
      });
    },

    openSavedNotebook: (id) => {
      const library =
        get().codeLabContext === "standalone"
          ? get().standaloneNotebooks
          : (get().document.notebooks ?? []);
      const nb = library.find((n) => n.id === id);
      if (!nb) {
        get().pushLog({
          level: "warn",
          message: `Saved notebook ${id} not found`,
        });
        return;
      }
      const notebookCells = nb.cells.map((c) => ({
        ...c,
        status: "idle" as const,
        execution_count: c.cell_type === "code" ? null : undefined,
      }));
      if (get().codeLabContext === "standalone") {
        saveStandaloneNotebookDraft(notebookCells);
      }
      set({
        activeNotebookId: nb.id,
        activeNotebookName: nb.name,
        notebookCells,
        ...(get().codeLabContext === "standalone"
          ? { standaloneNotebookCells: notebookCells }
          : {}),
        view: "notebook",
        runRuntime: "notebook",
      });
      get().pushLog({
        level: "info",
        message: `Opened notebook “${nb.name}”`,
      });
    },

    deleteSavedNotebook: (id) => {
      if (get().codeLabContext === "standalone") {
        const standaloneNotebooks = get().standaloneNotebooks.filter(
          (notebook) => notebook.id !== id,
        );
        saveStandaloneNotebooks(standaloneNotebooks);
        const patch: Partial<StudioState> = { standaloneNotebooks };
        if (get().activeNotebookId === id) {
          patch.activeNotebookId = null;
          patch.activeNotebookName = "untitled-notebook";
          patch.notebookCells = [];
          patch.standaloneNotebookCells = [];
          saveStandaloneNotebookDraft([]);
        }
        set(patch);
        get().pushLog({
          level: "info",
          message: `Deleted independent notebook ${id}`,
        });
        return;
      }
      const notebooks = (get().document.notebooks ?? []).filter((n) => n.id !== id);
      const flow = {
        ...get().document.flow,
        nodes: get().document.flow.nodes.map((n) => {
          if (n.type !== "notebook") return n;
          if (n.config?.notebookId !== id) return n;
          return {
            ...n,
            config: { ...n.config, notebookId: "" },
          };
        }),
      };
      const doc = { ...get().document, notebooks, flow };
      const next = withYaml(doc);
      persist(next.document, next.yamlText);
      const patch: Partial<StudioState> = {
        ...next,
        isDirty: true,
        backendSynced: false,
        issues: validateWorkspace(next.document),
      };
      if (get().activeNotebookId === id) {
        patch.activeNotebookId = null;
        patch.activeNotebookName = "untitled-notebook";
        Object.assign(patch, workflowCodeLab(get, next.document));
      }
      set(patch);
      get().pushLog({
        level: "info",
        message: `Deleted saved notebook ${id}`,
      });
    },

    newUntitledNotebook: () => {
      if (get().codeLabContext === "standalone") {
        saveStandaloneNotebookDraft([]);
      }
      set({
        activeNotebookId: null,
        activeNotebookName: "untitled-notebook",
        notebookCells: [],
        ...(get().codeLabContext === "standalone"
          ? { standaloneNotebookCells: [] }
          : {}),
        view: "notebook",
        runRuntime: "notebook",
      });
    },

    saveCodeLab: async () => {
      const { document, pythonSource, notebookCells, backendSynced } = get();
      if (get().codeLabContext === "standalone") {
        saveStandalonePython(pythonSource);
        saveStandaloneNotebookDraft(notebookCells);
        set({
          standalonePythonSource: pythonSource,
          standaloneNotebookCells: notebookCells,
        });
        get().pushLog({
          level: "info",
          message: "Independent Python/notebook draft saved locally",
        });
        return;
      }
      if (!backendSynced) {
        get().pushLog({
          level: "warn",
          message: "Apply workspace to MongoDB before saving notebook",
        });
        get().requestApplyToBackend();
        return;
      }
      try {
        // Persist without bulky outputs
        const slim = notebookCells.map(
          ({ id, cell_type, source, execution_count }) => ({
            id,
            cell_type,
            source,
            execution_count,
          }),
        );
        await api.saveCodeLab(document.workspace.id, {
          pythonSource,
          notebookCells: slim,
        });
        get().pushLog({ level: "info", message: "Notebook saved to MongoDB" });
      } catch (err) {
        get().pushLog({
          level: "error",
          message: err instanceof Error ? err.message : "Save notebook failed",
        });
      }
    },

    enhanceWorkflowCode: async () => {
      const { document } = get();
      const settings = loadCodegenSettings();
      if (!settings.apiKey.trim()) {
        throw new Error(
          "Add a codegen API key (LLM polish) — this is separate from connector secrets.",
        );
      }
      if (!document.flow.nodes.length) {
        throw new Error("Add canvas nodes before enhancing code.");
      }
      set({ enhancingCode: true });
      try {
        const nodes = document.flow.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          label: node.label ?? node.id,
          fingerprint: nodeFingerprint(node),
          source: generateNodeClass(node),
        }));
        const result = await api.enhanceWorkflowCode({
          workspaceId: document.workspace.id,
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          nodes,
        });
        const overlays: Record<string, NodeCodeOverlay> = {
          ...get().nodeCodeOverlays,
        };
        for (const item of result.nodes ?? []) {
          if (!item?.id || !item.source) continue;
          const node = document.flow.nodes.find((n) => n.id === item.id);
          if (!node) continue;
          overlays[item.id] = {
            fingerprint: nodeFingerprint(node),
            source: item.source,
          };
        }
        set({ nodeCodeOverlays: overlays });
        if (get().codeLabContext === "workflow") {
          set(workflowCodeLab(get));
        }
        get().pushLog({
          level: "info",
          message: `Polished reference Python for ${Object.keys(overlays).length} node(s) with ${settings.model}`,
        });
      } finally {
        set({ enhancingCode: false });
      }
    },

    loadCodeLabFromBackend: async (_workspaceId) => {
      // Python and notebook views are projections of the current canvas.
      set(workflowCodeLab(get));
    },

    executeCodeLab: async (mode, cellId) => {
      const { document, pythonSource, notebookCells, pendingSecrets } = get();
      const standalone = get().codeLabContext === "standalone";
      const executionDocument: WorkspaceDocument = standalone
        ? {
            workspace: {
              ...document.workspace,
              name: "standalone-code-lab",
              description: "Independent Python / notebook environment",
            },
            connectors: [],
            tools: [],
            agents: [],
            notebooks: [],
            flow: {
              triggers: [],
              nodes: [],
              edges: [],
              error_handlers: [],
            },
          }
        : document;

      const markCells = (ids: string[], status: NotebookCell["status"]) => {
        set({
          notebookCells: get().notebookCells.map((c) =>
            ids.includes(c.id) ? { ...c, status } : c,
          ),
        });
      };

      const targetIds = cellId
        ? [cellId]
        : notebookCells.filter((c) => c.cell_type === "code").map((c) => c.id);

      if (mode === "notebook") markCells(targetIds, "running");

      set({
        running: true,
        bottomOpen: true,
        bottomTab: "console",
        runRuntime: mode,
      });
      get().pushLog({
        level: "info",
        message: `Executing ${mode}${cellId ? ` cell ${cellId}` : " (all cells)"}…`,
      });

      const ephemeralSecrets = mergePendingSecrets(pendingSecrets).map((s) => ({
        secretRef: s.secretRef,
        value: s.value,
      }));

      try {
        // Sequential per-cell when running all — Databricks-like feedback
        if (
          mode === "notebook" &&
          !standalone &&
          !cellId &&
          targetIds.length > 1
        ) {
          let ok = true;
          for (const id of targetIds) {
            markCells([id], "running");
            const one = await api.executeCodeLab(document.workspace.id, {
              mode: "notebook",
              pythonSource,
              notebookCells: get().notebookCells,
              cellId: id,
              document: executionDocument,
              secrets: ephemeralSecrets,
            });
            const out = [one.stdout, one.stderr].filter(Boolean).join("\n").trim();
            const success = one.status === "succeeded";
            const prevCount =
              get().notebookCells.find((c) => c.id === id)?.execution_count ?? 0;
            set({
              notebookCells: get().notebookCells.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      status: success ? "success" : "error",
                      output: out || (success ? "(no output)" : one.stderr),
                      output_error: !success,
                      execution_count: success
                        ? (typeof prevCount === "number" ? prevCount : 0) + 1
                        : c.execution_count,
                    }
                  : c,
              ),
              lastRunId: one.runId,
            });
            get().pushLog({
              level: success ? "info" : "error",
              message: `Cell ${id} ${one.status}`,
            });
            if (!success) {
              ok = false;
              break;
            }
          }
          set({ running: false, apiStatus: "ok" });
          get().pushLog({
            level: ok ? "info" : "error",
            message: ok ? "Run all finished" : "Run all stopped on error",
          });
          return;
        }

        const result = await api.executeCodeLab(document.workspace.id, {
          mode,
          pythonSource,
          notebookCells,
          cellId,
          document: executionDocument,
          secrets: ephemeralSecrets,
        });
        const out = [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim();
        const success = result.status === "succeeded";

        if (mode === "notebook" && targetIds.length) {
          set({
            notebookCells: get().notebookCells.map((c) => {
              if (!targetIds.includes(c.id)) return c;
              const prev = c.execution_count ?? 0;
              return {
                ...c,
                status: success ? "success" : "error",
                output: out || (success ? "(no output)" : result.stderr),
                output_error: !success,
                execution_count: success
                  ? (typeof prev === "number" ? prev : 0) + 1
                  : c.execution_count,
              };
            }),
          });
        }

        set({ running: false, lastRunId: result.runId, apiStatus: "ok" });
        get().pushLog({
          level: success ? "info" : "error",
          message: `${mode} ${result.status} · ${result.runId} · ${result.localPath}`,
        });
        if (result.stdout.trim()) {
          for (const line of result.stdout.trim().split("\n").slice(-80)) {
            get().pushLog({ level: "debug", message: line });
          }
        }
        if (result.stderr.trim()) {
          for (const line of result.stderr.trim().split("\n").slice(-40)) {
            get().pushLog({ level: "error", message: line });
          }
        }
      } catch (err) {
        if (mode === "notebook") markCells(targetIds, "error");
        set({ running: false });
        get().pushLog({
          level: "error",
          message: err instanceof Error ? err.message : "Code lab run failed",
        });
      }
    },

    executeRun: async (opts) => {
      const { runRuntime, view, pendingSecrets } = get();

      if (view === "python") {
        await get().executeCodeLab("python");
        return;
      }
      if (view === "notebook") {
        await get().executeCodeLab("notebook");
        return;
      }

      get().revalidate();
      const document = withGraphDefaults(get().document);
      const issues = validateWorkspace(document);
      const flight = assessFlow(document);
      if (!opts?.skipFlight && flight.verdict !== "ready") {
        set({
          issues,
          flight,
          flightIntent: "run",
          bottomOpen: true,
          bottomTab: flight.willRun ? "console" : "errors",
        });
        get().pushLog({
          level: flight.willRun ? "warn" : "error",
          message: flight.headline,
        });
        return;
      }
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length && !opts?.skipFlight) {
        set({ issues, bottomOpen: true, bottomTab: "errors" });
        get().pushLog({
          level: "error",
          message: "Fix validation errors before run",
        });
        return;
      }
      set({ issues, flight: null });

      // Run uses the current canvas/YAML — does NOT Apply/save to MongoDB.
      // Secrets can be ephemeral for this run; persist secrets only via Apply.
      const ephemeralSecrets = mergePendingSecrets(pendingSecrets).map((s) => ({
        secretRef: s.secretRef,
        value: s.value,
        label: s.label,
      }));

      if (ephemeralSecrets.length) {
        get().pushLog({
          level: "info",
          message: `Using ${ephemeralSecrets.length} queued secret(s) for this run (${ephemeralSecrets.map((s) => s.secretRef).join(", ")})`,
        });
      } else {
        get().pushLog({
          level: "warn",
          message:
            "No queued connector secrets — Run will use MongoDB secrets only (if any). Re-save the connector password if auth fails.",
        });
      }

      const workflowRuntime =
        runRuntime === "notebook" ? "notebook" : "python";

      set({ running: true, bottomOpen: true, bottomTab: "console" });
      get().pushLog({
        level: "info",
        message: `Starting workflow run (${workflowRuntime}) from current canvas`,
      });

      try {
        // Always send live canvas — Run never depends on Apply / Mongo workspace head
        const run = await api.startRun(document.workspace.id, {
          mode: "execute",
          runtime: workflowRuntime,
          document,
          yaml: workspaceToYaml(document),
          secrets: ephemeralSecrets,
        });
        set({
          lastRunId: run.runId,
          running: false,
          apiStatus: "ok",
          bottomTab: "runs",
          postRunOffer: { runId: run.runId, status: run.status },
        });
        void import("@/store/agentStore").then((m) =>
          m.useAgentStore.getState().refresh(document.workspace.id),
        );
        get().pushLog({
          level: run.status === "succeeded" ? "info" : "error",
          message: `Run ${run.runId} ${run.status} · runtime=${run.runtime ?? workflowRuntime} · ${run.localPath}`,
        });
        if (run.artifacts?.notebook) {
          get().pushLog({
            level: "info",
            message: `Notebook: ${run.artifacts.notebook}`,
          });
        }
        try {
          const outs = await api.getRunOutputs(run.runId);
          set({
            runOutputs: outs.files.map((f) => ({
              path: f.path,
              content: f.content,
            })),
          });
          if (outs.files.length) {
            set({ bottomTab: "outputs", bottomOpen: true });
            get().pushLog({
              level: "info",
              message: `${outs.files.length} output file(s) ready — open Outputs tab`,
            });
          }
        } catch {
          /* outputs optional */
        }
        try {
          const logs = await api.getRunLogs(run.runId);
          for (const file of logs.files) {
            const lines = file.content.trim().split("\n").filter(Boolean);
            for (const line of lines.slice(-40)) {
              get().pushLog({
                level:
                  line.includes("FAIL") || line.includes("error")
                    ? "error"
                    : "debug",
                message: line,
              });
            }
          }
        } catch {
          /* logs optional */
        }
      } catch (err) {
        set({ running: false });
        const raw = err instanceof Error ? err.message : "Run failed";
        const message = /Apply to MongoDB/i.test(raw)
          ? "Run failed talking to an outdated API. Restart the Agent Studio API, then Run again (Apply is not required)."
          : raw;
        get().pushLog({
          level: "error",
          message,
        });
      }
    },

    clearLogs: () => set({ logs: [] }),
    dismissPostRunOffer: () => set({ postRunOffer: null }),
  };
});
