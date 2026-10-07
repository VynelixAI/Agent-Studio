import { create } from "zustand";
import { api } from "@/lib/api";
import { useStudioStore } from "@/store/studioStore";

export type NodeMemoryStatus = "success" | "failed" | "running" | "skipped";

export type NodeMemory = {
  nodeId: string;
  label?: string;
  nodeType?: string;
  status: NodeMemoryStatus;
  updatedAt: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type ExecutionSummary = {
  executionId: string;
  runId: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  nodeCount: number;
  error?: string;
};

export type BrainTurn = { role: "user" | "assistant"; content: string; ts: string };

type BrainPublic = { provider: string; model: string; baseUrl: string; apiKeySet: boolean };

interface AgentState {
  workspaceId: string | null;
  mode: "brain" | "canvas" | "fix";
  memory: Record<string, NodeMemory>;
  memoryUpdatedAt: string | null;
  executions: ExecutionSummary[];
  brain: BrainPublic;
  turns: BrainTurn[];
  draft: string;
  apiKeyDraft: string;
  sending: boolean;
  error: string | null;
  hint: string | null;
  inspectNodeId: string | null;
  logKind: "success" | "failure";
  logQuery: string;
  logLines: string[];
  replay: {
    executionId: string;
    nodeIo: NodeMemory[];
    excerpt: string;
  } | null;
  setMode: (mode: "brain" | "canvas" | "fix") => void;
  setDraft: (v: string) => void;
  setApiKeyDraft: (v: string) => void;
  setBrainField: (patch: Partial<BrainPublic>) => void;
  setInspect: (nodeId: string | null) => void;
  setLogKind: (kind: "success" | "failure") => void;
  setLogQuery: (q: string) => void;
  refresh: (workspaceId: string) => Promise<void>;
  saveBrain: () => Promise<void>;
  sendBrain: (text?: string) => Promise<void>;
  loadLogs: () => Promise<void>;
  openReplay: (executionId: string) => Promise<void>;
  closeReplay: () => void;
  noteTemplate: (name: string, description: string) => void;
}

const EMPTY_BRAIN: BrainPublic = {
  provider: "ollama",
  model: "llama3.2",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKeySet: false,
};

function graphSummary(): string {
  const doc = useStudioStore.getState().document;
  const nodes = doc.flow.nodes.map((n) => `${n.id} (${n.type}${n.label ? `: ${n.label}` : ""})`);
  return `${doc.workspace.name}: ${nodes.join(", ") || "(empty canvas)"}`;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  workspaceId: null,
  mode: "brain",
  memory: {},
  memoryUpdatedAt: null,
  executions: [],
  brain: EMPTY_BRAIN,
  turns: [],
  draft: "",
  apiKeyDraft: "",
  sending: false,
  error: null,
  hint: null,
  inspectNodeId: null,
  logKind: "success",
  logQuery: "",
  logLines: [],
  replay: null,
  setMode: (mode) => set({ mode, error: null }),
  setDraft: (draft) => set({ draft }),
  setApiKeyDraft: (apiKeyDraft) => set({ apiKeyDraft }),
  setBrainField: (patch) => set({ brain: { ...get().brain, ...patch } }),
  setInspect: (inspectNodeId) => set({ inspectNodeId }),
  setLogKind: (logKind) => set({ logKind }),
  setLogQuery: (logQuery) => set({ logQuery }),
  refresh: async (workspaceId) => {
    set({ workspaceId, error: null });
    try {
      const [memory, executions, brain] = await Promise.all([
        api.getAgentMemory(workspaceId),
        api.listAgentExecutions(workspaceId),
        api.getBrain(workspaceId),
      ]);
      set({
        memory: memory.nodes ?? {},
        memoryUpdatedAt: memory.updatedAt,
        executions: executions.items,
        brain: brain.brain,
        turns: brain.turns,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not load workspace memory" });
    }
  },
  saveBrain: async () => {
    const id = get().workspaceId;
    if (!id) return;
    const { brain, apiKeyDraft } = get();
    try {
      const saved = await api.saveBrain(id, {
        provider: brain.provider,
        model: brain.model,
        baseUrl: brain.baseUrl,
        ...(apiKeyDraft ? { apiKey: apiKeyDraft } : {}),
      });
      set({ brain: saved.brain, apiKeyDraft: "", error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not save the model" });
    }
  },
  sendBrain: async (text) => {
    const message = (text ?? get().draft).trim();
    const id = get().workspaceId ?? useStudioStore.getState().document.workspace.id;
    if (!message || get().sending) return;
    set({ sending: true, error: null, draft: "", hint: null });
    try {
      const res = await api.askBrain(id, { message, graphSummary: graphSummary() });
      set({ turns: res.turns, sending: false, workspaceId: id });
    } catch (err) {
      set({
        sending: false,
        error: err instanceof Error ? err.message : "Brain request failed",
        draft: message,
      });
    }
  },
  loadLogs: async () => {
    const id = get().workspaceId;
    if (!id) return;
    try {
      const res = await api.getAgentLogs(id, get().logKind, get().logQuery);
      set({ logLines: res.lines });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not read logs" });
    }
  },
  openReplay: async (executionId) => {
    const id = get().workspaceId;
    if (!id) return;
    const snap = await api.getAgentExecution(id, executionId);
    set({
      replay: {
        executionId,
        nodeIo: snap.nodeIo as NodeMemory[],
        excerpt: snap.logs?.excerpt ?? snap.error ?? "",
      },
      memory: Object.fromEntries(snap.nodeIo.map((n) => [n.nodeId, n as NodeMemory])),
    });
  },
  closeReplay: () => {
    const id = get().workspaceId;
    set({ replay: null });
    if (id) void get().refresh(id);
  },
  noteTemplate: (name, description) => {
    set({
      hint: `Loaded “${name}”. ${description} Ask me what each node does, or what to change.`,
    });
  },
}));
