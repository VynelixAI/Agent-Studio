import { getNodeDef } from "@/core/nodeRegistry";
import { isTriggerNode } from "@/core/stageWiring";
import type { ValidationIssue, WorkspaceDocument } from "@/types/workspace";

export function validateWorkspace(doc: WorkspaceDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(doc.flow.nodes.map((n) => n.id));
  const connectorIds = new Set(doc.connectors.map((c) => c.id));

  if (!doc.workspace.name?.trim()) {
    issues.push({
      id: "ws-name",
      severity: "error",
      message: "Workspace name is required",
      suggestion: "Set workspace.name in YAML or the header",
    });
  }

  const hasTriggerNode = doc.flow.nodes.some(isTriggerNode);
  if (!doc.flow.triggers.length && !hasTriggerNode) {
    issues.push({
      id: "no-trigger",
      severity: "warning",
      message: "No triggers defined",
      suggestion: "Add a Manual Run or Schedule trigger",
    });
  }

  for (const node of doc.flow.nodes) {
    const def = getNodeDef(node.type);
    if (!def) {
      issues.push({
        id: `unknown-${node.id}`,
        severity: "error",
        nodeId: node.id,
        message: `Unknown node type: ${node.type}`,
      });
      continue;
    }

    if (def.requiresConnector) {
      if (!node.connector) {
        issues.push({
          id: `conn-missing-${node.id}`,
          severity: "error",
          nodeId: node.id,
          message: `${def.label} requires a connector`,
          suggestion: "Select a MongoDB (or other) connector in the inspector",
        });
      } else if (!connectorIds.has(node.connector)) {
        issues.push({
          id: `conn-bad-${node.id}`,
          severity: "error",
          nodeId: node.id,
          message: `Connector "${node.connector}" is not defined`,
          suggestion: "Add it under connectors: or pick an existing one",
        });
      }
    }
  }

  for (const edge of doc.flow.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        id: `edge-src-${edge.id}`,
        severity: "error",
        message: `Edge ${edge.id} references missing source "${edge.source}"`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        id: `edge-tgt-${edge.id}`,
        severity: "error",
        message: `Edge ${edge.id} references missing target "${edge.target}"`,
      });
    }
  }

  // Orphan non-trigger nodes
  const targets = new Set(doc.flow.edges.map((e) => e.target));
  for (const node of doc.flow.nodes) {
    if (node.category === "trigger") continue;
    if (!targets.has(node.id) && doc.flow.nodes.length > 1) {
      issues.push({
        id: `orphan-${node.id}`,
        severity: "warning",
        nodeId: node.id,
        message: `Node "${node.label ?? node.id}" has no inbound edge`,
        suggestion: "Connect it from an upstream node",
      });
    }
  }

  return issues;
}
