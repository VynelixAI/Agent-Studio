import type {
  ConnectorRef,
  FlowEdge,
  FlowNode,
  NodeCategory,
  WorkspaceDocument,
} from "@/types/workspace";

export type TemplateDomain =
  | "de"
  | "ds"
  | "ai"
  | "bfsi"
  | "healthcare"
  | "etl"
  | "mlops";

export type TemplateOrigin = "standard" | "custom";

export interface TemplateVariable {
  key: string;
  label: string;
  example: string;
  description?: string;
}

export interface TemplateStep {
  type: string;
  label: string;
  connectorType?: string;
  config?: Record<string, unknown>;
  /** Branch fan-out labels (creates parallel children then joins) */
  branches?: string[];
}

export interface StudioTemplateMeta {
  id: string;
  name: string;
  description: string;
  domain: TemplateDomain;
  /** Top products this pattern uses (Airbyte, dbt, Snowflake, …) */
  products: string[];
  industry?: string;
  origin: TemplateOrigin;
  nodeCount: number;
  tags?: string[];
  variables?: TemplateVariable[];
  updatedAt?: string;
}

export interface StudioTemplate extends StudioTemplateMeta {
  /** Build a fresh workspace document (new ids each load) */
  create: () => WorkspaceDocument;
}

export function categoryForNodeType(type: string): NodeCategory {
  if (type.startsWith("trigger.")) return "trigger";
  if (
    type === "llm" ||
    type === "agent" ||
    type === "sub_workflow" ||
    type === "rag" ||
    type === "embed" ||
    type.startsWith("rag.")
  ) {
    return "ai";
  }
  if (
    type.startsWith("notify.") ||
    type === "log" ||
    type === "webhook.out" ||
    type === "teams" ||
    type === "slack"
  ) {
    return "communication";
  }
  if (
    [
      "if",
      "switch",
      "loop",
      "parallel",
      "human_approval",
      "wait",
      "end",
      "error_handler",
    ].includes(type) ||
    type.startsWith("airflow.") ||
    type.startsWith("prefect.") ||
    type.startsWith("dagster.") ||
    type.startsWith("temporal.")
  ) {
    return "control";
  }
  if (
    ["code", "python", "notebook", "transform", "set_variables"].includes(type)
  ) {
    return "logic";
  }
  return "data";
}

export function slugId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** Build a linear (or lightly branched) workflow from pattern steps. */
export function buildWorkspaceFromSteps(opts: {
  name: string;
  description: string;
  steps: TemplateStep[];
  variables?: TemplateVariable[];
  connectors?: ConnectorRef[];
}): WorkspaceDocument {
  const wsId = slugId("ws");
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let x = 40;
  const y = 200;
  const dx = 200;
  let prevIds: string[] = [];

  const connectorByType = new Map<string, string>();
  for (const c of opts.connectors ?? []) {
    connectorByType.set(c.type, c.id);
  }

  opts.steps.forEach((step, i) => {
    const id = `n${i}_${step.type.replace(/\./g, "_")}`.slice(0, 40);
    const category = categoryForNodeType(step.type);
    const stageOut = `stage.${id}`;
    const node: FlowNode = {
      id,
      category,
      type: step.type,
      label: step.label,
      position: { x, y },
      config: {
        outputFormat: "json",
        ...(step.config ?? {}),
        ...(opts.variables?.length
          ? { _templateVars: opts.variables.map((v) => v.key) }
          : {}),
      },
      outputs:
        category === "trigger" || category === "control"
          ? undefined
          : [stageOut],
      inputs:
        prevIds.length && category !== "trigger"
          ? prevIds.map((pid) => {
              const p = nodes.find((n) => n.id === pid);
              return p?.outputs?.[0] ?? `stage.${pid}`;
            })
          : undefined,
      connector: step.connectorType
        ? connectorByType.get(step.connectorType)
        : undefined,
    };
    nodes.push(node);

    for (const pid of prevIds) {
      edges.push({
        id: `e_${pid}_${id}`,
        source: pid,
        target: id,
      });
    }

    if (step.branches?.length) {
      const branchIds: string[] = [];
      step.branches.forEach((blabel, bi) => {
        const bid = `${id}_b${bi}`;
        nodes.push({
          id: bid,
          category: "logic",
          type: "python",
          label: blabel,
          position: { x: x + dx, y: y - 100 + bi * 100 },
          inputs: [stageOut],
          outputs: [`stage.${bid}`],
          config: {
            outputFormat: "json",
            script: `# branch: ${blabel}\ndef run(stages, ctx):\n    return stages\n`,
          },
        });
        edges.push({ id: `e_${id}_${bid}`, source: id, target: bid });
        branchIds.push(bid);
      });
      prevIds = branchIds;
      x += dx * 2;
    } else {
      prevIds = [id];
      x += dx;
    }
  });

  return {
    workspace: {
      id: wsId,
      name: opts.name,
      version: "1.0.0",
      mode: "workflow",
      description: opts.description,
      updatedAt: new Date().toISOString(),
    },
    connectors: opts.connectors ?? [],
    tools: [],
    agents: [],
    notebooks: [],
    flow: {
      triggers: [{ type: "manual" }],
      nodes,
      edges,
      error_handlers: [],
    },
  };
}

export function placeholderConnectors(
  types: Array<{ type: string; label: string; pluginId?: string }>,
): ConnectorRef[] {
  return types.map((t) => ({
    id: `tpl_${t.type}`,
    type: t.type,
    label: `${t.label} (template)`,
    secretRef: `secret://REPLACE_${t.type}`,
    config: { note: "Replace with your connector — synthetic template only" },
    pluginId: t.pluginId ?? t.type,
  }));
}
