import yaml from "js-yaml";
import type { WorkspaceDocument } from "@/types/workspace";

export function workspaceToYaml(doc: WorkspaceDocument): string {
  const serializable = {
    workspace: {
      id: doc.workspace.id,
      name: doc.workspace.name,
      version: doc.workspace.version,
      mode: doc.workspace.mode,
      ...(doc.workspace.description
        ? { description: doc.workspace.description }
        : {}),
    },
    connectors: doc.connectors.map((c) => ({
      id: c.id,
      type: c.type,
      ...(c.mode ? { mode: c.mode } : {}),
      ...(c.label ? { label: c.label } : {}),
      ...(c.secretRef ? { secretRef: c.secretRef } : {}),
      ...(c.config ? { config: c.config } : {}),
      ...(c.pluginId ? { pluginId: c.pluginId } : {}),
    })),
    ...(doc.notebooks?.length
      ? {
          notebooks: doc.notebooks.map((n) => ({
            id: n.id,
            name: n.name,
            ...(n.description ? { description: n.description } : {}),
            updatedAt: n.updatedAt,
            cells: n.cells.map((c) => ({
              id: c.id,
              cell_type: c.cell_type,
              source: c.source,
            })),
          })),
        }
      : {}),
    tools: doc.tools,
    agents: doc.agents,
    flow: {
      triggers: doc.flow.triggers,
      nodes: doc.flow.nodes.map((n) => ({
        id: n.id,
        category: n.category,
        type: n.type,
        ...(n.label ? { label: n.label } : {}),
        ...(n.connector ? { connector: n.connector } : {}),
        ...(n.inputs?.length ? { inputs: n.inputs } : {}),
        ...(n.outputs?.length ? { outputs: n.outputs } : {}),
        ...(n.config && Object.keys(n.config).length
          ? { config: n.config }
          : {}),
        ...(n.position ? { position: n.position } : {}),
      })),
      edges: doc.flow.edges,
      ...(doc.flow.error_handlers?.length
        ? { error_handlers: doc.flow.error_handlers }
        : {}),
    },
  };

  return yaml.dump(serializable, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
}

export function yamlToWorkspace(text: string): WorkspaceDocument {
  const parsed = yaml.load(text) as WorkspaceDocument;
  if (!parsed || typeof parsed !== "object" || !parsed.workspace || !parsed.flow) {
    throw new Error("Invalid workspace YAML: missing workspace or flow");
  }
  return {
    workspace: parsed.workspace,
    connectors: parsed.connectors ?? [],
    tools: parsed.tools ?? [],
    agents: parsed.agents ?? [],
    notebooks: parsed.notebooks ?? [],
    flow: {
      triggers: parsed.flow.triggers ?? [],
      nodes: parsed.flow.nodes ?? [],
      edges: parsed.flow.edges ?? [],
      error_handlers: parsed.flow.error_handlers ?? [],
    },
  };
}
