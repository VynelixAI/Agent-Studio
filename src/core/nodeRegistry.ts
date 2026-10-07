import type { NodeCategory } from "@/types/workspace";
import {
  customPluginNodes,
  pluginNodesToTypeDefs,
  PLUGIN_CAPABILITIES,
} from "@/core/pluginNodeCatalog";
import { loadCustomPlugins, PLUGIN_STORAGE_KEY } from "@/core/pluginCatalog";

export interface NodeTypeDef {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  /** Default output stage keys */
  defaultOutputs?: string[];
  /** Whether node typically needs a connector */
  requiresConnector?: boolean;
  color: string;
  /** Set when contributed by an installed plugin */
  pluginId?: string;
}

export const CATEGORY_META: Record<
  NodeCategory,
  { label: string; accent: string; order: number }
> = {
  trigger: { label: "Triggers", accent: "#F59E0B", order: 0 },
  ai: { label: "AI", accent: "#22D3EE", order: 1 },
  data: { label: "Data", accent: "#06b6d4", order: 2 },
  logic: { label: "Logic", accent: "#A78BFA", order: 3 },
  control: { label: "Workflow Control", accent: "#F472B6", order: 4 },
  communication: { label: "Communication", accent: "#34D399", order: 5 },
};

/**
 * Always-available core nodes (loosely coupled from DE/DB plugins).
 * Plugin-specific nodes (MongoDB, Snowflake, Airflow, …) appear only after install.
 */
export const CORE_NODE_REGISTRY: NodeTypeDef[] = [
  // Triggers
  {
    type: "trigger.manual",
    category: "trigger",
    label: "Manual Run",
    description: "Start workflow from studio or API",
    color: "#F59E0B",
  },
  {
    type: "trigger.schedule",
    category: "trigger",
    label: "Schedule",
    description: "Cron / interval trigger",
    color: "#F59E0B",
  },
  {
    type: "trigger.webhook",
    category: "trigger",
    label: "Webhook",
    description: "HTTP inbound entry point",
    color: "#F59E0B",
  },
  {
    type: "trigger.chat",
    category: "trigger",
    label: "Chat Start",
    description: "User message from Chat panel / /chat API",
    color: "#F59E0B",
  },
  {
    type: "trigger.error",
    category: "trigger",
    label: "Error / Retry",
    description: "Re-enter on failure path",
    color: "#F59E0B",
  },

  // AI
  {
    type: "llm",
    category: "ai",
    label: "LLM",
    description: "Prompt → text / JSON with memory, JSON mode, stop sequences",
    defaultOutputs: ["stage.llm"],
    color: "#22D3EE",
  },
  {
    type: "chat.reply",
    category: "ai",
    label: "Chat Reply",
    description: "Send upstream LLM text back to the Chat panel",
    defaultOutputs: ["stage.reply"],
    color: "#22D3EE",
  },
  {
    type: "agent",
    category: "ai",
    label: "Agent",
    description: "ReAct agent with built-in tools and session memory",
    defaultOutputs: ["stage.agent"],
    color: "#22D3EE",
  },
  {
    type: "sub_workflow",
    category: "ai",
    label: "Sub-Workflow",
    description: "Call another workflow team",
    color: "#22D3EE",
  },
  {
    type: "rag",
    category: "ai",
    label: "RAG / Retrieval",
    description: "Keyword or vector retrieve + grounded answer",
    defaultOutputs: ["stage.rag"],
    color: "#22D3EE",
  },
  {
    type: "embedding",
    category: "ai",
    label: "Embedding",
    description: "Chunk + vector embed (OpenAI-compatible /embeddings)",
    defaultOutputs: ["stage.vectors"],
    color: "#22D3EE",
  },
  {
    type: "tool",
    category: "ai",
    label: "Tool",
    description: "Calculator, HTTP, stage lookup, or custom Python",
    defaultOutputs: ["stage.tool"],
    color: "#22D3EE",
  },

  // Generic data (not vendor-specific)
  {
    type: "stage.load",
    category: "data",
    label: "Stage Cache Load",
    description: "Load named stage into context",
    defaultOutputs: ["stage.loaded"],
    color: "#06b6d4",
  },
  {
    type: "stage.pass",
    category: "data",
    label: "Stage Pass",
    description: "Handover dataset to next node",
    color: "#06b6d4",
  },
  {
    type: "file.source",
    category: "data",
    label: "File Source",
    description: "Load CSV / Parquet / JSON from a local path",
    defaultOutputs: ["stage.file"],
    color: "#06b6d4",
  },
  {
    type: "file.sink",
    category: "data",
    label: "File Sink",
    description: "Write CSV / Parquet / JSON",
    color: "#06b6d4",
  },
  {
    type: "rest",
    category: "data",
    label: "External REST",
    description: "HTTP GET/POST with JSONPath extract → stage",
    defaultOutputs: ["stage.rest"],
    color: "#06b6d4",
  },

  // Logic
  {
    type: "code",
    category: "logic",
    label: "Code",
    description: "Python / JS sandbox",
    defaultOutputs: ["stage.code"],
    color: "#A78BFA",
  },
  {
    type: "python",
    category: "logic",
    label: "Python",
    description: "Run a Python script on stage inputs",
    defaultOutputs: ["stage.python"],
    color: "#3776AB",
  },
  {
    type: "notebook",
    category: "logic",
    label: "Notebook",
    description: "Run notebook-style cells (%% markers) in the workflow",
    defaultOutputs: ["stage.notebook"],
    color: "#F37626",
  },
  {
    type: "set_variables",
    category: "logic",
    label: "Set Variables",
    description: "Write context / env vars",
    color: "#A78BFA",
  },
  {
    type: "transform",
    category: "logic",
    label: "Transform",
    description: "Map, filter, join, aggregate (expression / SQL / Python)",
    defaultOutputs: ["stage.transform"],
    color: "#A78BFA",
  },

  // Control
  {
    type: "if",
    category: "control",
    label: "IF / Condition",
    description: "Expression or LLM condition-agent branch",
    defaultOutputs: ["stage.if"],
    color: "#F472B6",
  },
  {
    type: "switch",
    category: "control",
    label: "Switch",
    description: "Multi-branch by expression",
    defaultOutputs: ["stage.switch"],
    color: "#F472B6",
  },
  {
    type: "loop",
    category: "control",
    label: "Loop",
    description: "Sequential or parallel over collection",
    color: "#F472B6",
  },
  {
    type: "parallel",
    category: "control",
    label: "Parallel",
    description: "Fan-out / fan-in",
    color: "#F472B6",
  },
  {
    type: "human_approval",
    category: "control",
    label: "Human Approval",
    description: "Human-in-the-loop gate",
    color: "#F472B6",
  },
  {
    type: "wait",
    category: "control",
    label: "Wait / Delay",
    description: "Pause for duration or event",
    defaultOutputs: ["stage.wait"],
    color: "#F472B6",
  },
  {
    type: "return",
    category: "control",
    label: "Return / End",
    description: "Terminate with outputs",
    defaultOutputs: ["stage.return"],
    color: "#F472B6",
  },
  {
    type: "error_handler",
    category: "control",
    label: "Error Handler",
    description: "Catch / retry / branch on error",
    color: "#F472B6",
  },

  // Communication
  {
    type: "notify.email",
    category: "communication",
    label: "Email",
    description: "Send email notification",
    color: "#34D399",
  },
  {
    type: "notify.slack",
    category: "communication",
    label: "Slack",
    description: "Post to Slack channel",
    color: "#34D399",
  },
  {
    type: "notify.teams",
    category: "communication",
    label: "Teams",
    description: "Microsoft Teams message",
    color: "#34D399",
  },
  {
    type: "webhook.out",
    category: "communication",
    label: "Webhook Out",
    description: "Outbound HTTP webhook",
    color: "#34D399",
  },
  {
    type: "log",
    category: "communication",
    label: "Log / Audit",
    description: "Emit structured audit event",
    color: "#34D399",
  },
];

/** @deprecated use CORE_NODE_REGISTRY + getActiveNodeRegistry */
export const NODE_REGISTRY = CORE_NODE_REGISTRY;

export function loadInstalledPluginIds(): string[] {
  try {
    const raw = localStorage.getItem(PLUGIN_STORAGE_KEY);
    if (!raw) return ["mongodb"];
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) && ids.length ? ids : ["mongodb"];
  } catch {
    return ["mongodb"];
  }
}

export function getPluginContributedNodes(
  installedIds: string[] = loadInstalledPluginIds(),
): NodeTypeDef[] {
  const out: NodeTypeDef[] = [];
  for (const id of installedIds) {
    if (PLUGIN_CAPABILITIES[id]) {
      out.push(...pluginNodesToTypeDefs(id));
      continue;
    }
    const custom = loadCustomPlugins().find((p) => p.id === id);
    if (custom) {
      out.push(
        ...customPluginNodes(custom.id, custom.connectorType).map((node) => ({
          type: node.type,
          category: node.category,
          label: node.label,
          description: node.description,
          requiresConnector: true,
          defaultOutputs: node.outputStage ? [node.outputStage] : undefined,
          color: "#22d3ee",
          pluginId: custom.id,
        })),
      );
    }
  }
  return out;
}

export function getActiveNodeRegistry(
  installedIds?: string[],
): NodeTypeDef[] {
  return [...CORE_NODE_REGISTRY, ...getPluginContributedNodes(installedIds)];
}

export function getNodeDef(
  type: string,
  installedIds?: string[],
): NodeTypeDef | undefined {
  return getActiveNodeRegistry(installedIds).find((n) => n.type === type);
}

export function nodesByCategory(
  installedIds?: string[],
): Record<NodeCategory, NodeTypeDef[]> {
  const map = {} as Record<NodeCategory, NodeTypeDef[]>;
  for (const cat of Object.keys(CATEGORY_META) as NodeCategory[]) {
    map[cat] = [];
  }
  for (const n of getActiveNodeRegistry(installedIds)) {
    map[n.category].push(n);
  }
  return map;
}
