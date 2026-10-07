import type { FlowEdge, FlowNode, FlowTrigger } from "@/types/workspace";

const TRIGGER_TYPES: FlowTrigger["type"][] = [
  "manual",
  "schedule",
  "webhook",
  "chat",
  "error",
];

/** Oracle/CrewAI-style: every node owns a unique stage key for handover. */
export function uniqueStageKey(node: { id: string }): string {
  return `stage.${String(node.id).replace(/\./g, "_")}`;
}

function typeStageKey(node: { type: string }): string {
  return `stage.${node.type.replace(/\./g, "_")}`;
}

function sourceOutputKeys(node: FlowNode | undefined): string[] {
  if (!node) return [];
  if (node.outputs?.length) return node.outputs.map(String);
  return [uniqueStageKey(node)];
}

/**
 * Generic defaults like stage.code collide when two Code nodes exist.
 * Prefer stage.<nodeId> (CrewAI step state / Oracle node output).
 */
export function ensureUniqueStageOutputs(nodes: FlowNode[]): FlowNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    const unique = uniqueStageKey(node);
    const typeKey = typeStageKey(node);
    const current = (node.outputs ?? []).map(String).filter(Boolean);
    if (current.includes(unique) && current[0] === unique) return node;
    if (
      !current.length ||
      (current.length === 1 && (current[0] === typeKey || current[0] === unique))
    ) {
      changed = true;
      return { ...node, outputs: [unique] };
    }
    if (!current.includes(unique)) {
      changed = true;
      return { ...node, outputs: [unique, ...current] };
    }
    if (current[0] !== unique) {
      changed = true;
      return {
        ...node,
        outputs: [unique, ...current.filter((key) => key !== unique)],
      };
    }
    return node;
  });
  return changed ? next : nodes;
}

/** Copy upstream output stage keys onto each target node from canvas edges. */
export function applyEdgeStageInputs(
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inferred = new Map<string, string[]>();
  for (const edge of edges) {
    const keys = sourceOutputKeys(byId.get(edge.source));
    if (!keys.length) continue;
    const cur = inferred.get(edge.target) ?? [];
    for (const key of keys) {
      if (!cur.includes(key)) cur.push(key);
    }
    inferred.set(edge.target, cur);
  }
  let changed = false;
  const next = nodes.map((node) => {
    const keys = inferred.get(node.id);
    if (!keys?.length) return node;
    const prev = node.inputs ?? [];
    if (
      prev.length === keys.length &&
      prev.every((value, index) => value === keys[index])
    ) {
      return node;
    }
    changed = true;
    return { ...node, inputs: keys };
  });
  return changed ? next : nodes;
}

export function isTriggerNode(node: FlowNode): boolean {
  return node.category === "trigger" || node.type.startsWith("trigger.");
}

/** Keep flow.triggers aligned with trigger.* canvas nodes (Manual Run, etc.). */
export function syncTriggersFromNodes(
  nodes: FlowNode[],
  existing: FlowTrigger[],
): FlowTrigger[] {
  const fromNodes: FlowTrigger[] = [];
  for (const node of nodes) {
    if (!isTriggerNode(node)) continue;
    const raw = node.type.replace(/^trigger\./, "") as FlowTrigger["type"];
    if (!TRIGGER_TYPES.includes(raw)) continue;
    fromNodes.push({ type: raw, config: node.config });
  }
  return fromNodes.length ? fromNodes : existing;
}
