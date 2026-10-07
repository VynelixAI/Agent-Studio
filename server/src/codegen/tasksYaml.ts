import yaml from "js-yaml";
import type { ConnectorRef, WorkspaceDocument } from "../types.js";

export interface TaskStep {
  id: string;
  name: string;
  type: string;
  category: string;
  connector?: string;
  inputs: string[];
  outputs: string[];
  config: Record<string, unknown>;
  depends_on: string[];
}

export interface TasksFile {
  run: {
    workspace_id: string;
    workspace_name: string;
    version: string;
    run_id: string;
    generated_at: string;
    chat?: {
      sessionId?: string;
      question?: string;
      history?: Array<{ role: string; content: string }>;
    };
  };
  connectors: Array<{
    id: string;
    type: string;
    mode?: string;
    label?: string;
    secret_ref?: string;
    config?: Record<string, unknown>;
  }>;
  secrets: Array<{
    ref: string;
    /** Placeholder only in committed artifacts; real values live in secrets.local.yaml */
    env_key: string;
  }>;
  tasks: TaskStep[];
  edges: Array<{ id: string; source: string; target: string }>;
}

function topoSort(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): string[] {
  const ids = nodes.map((n) => String(n.id));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, [] as string[]]));

  for (const e of edges) {
    const s = String(e.source);
    const t = String(e.target);
    if (!indeg.has(s) || !indeg.has(t)) continue;
    adj.get(s)!.push(t);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }

  const q = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    out.push(id);
    for (const n of adj.get(id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 1) - 1);
      if ((indeg.get(n) ?? 0) === 0) q.push(n);
    }
  }
  // append any leftover (cycles)
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

export function buildTasksFile(opts: {
  document: WorkspaceDocument;
  runId: string;
  secrets: Record<string, string>;
  chat?: {
    sessionId?: string;
    question?: string;
    history?: Array<{ role: string; content: string }>;
  };
}): TasksFile {
  const nodes = opts.document.flow.nodes;
  const edges = (opts.document.flow.edges ?? []) as Array<Record<string, unknown>>;
  const order = topoSort(nodes, edges);
  const byId = new Map(nodes.map((n) => [String(n.id), n]));

  const depends = new Map<string, string[]>();
  for (const id of order) depends.set(id, []);
  for (const e of edges) {
    const s = String(e.source);
    const t = String(e.target);
    if (depends.has(t)) depends.get(t)!.push(s);
  }

  const secretRefs = new Set<string>();
  for (const c of opts.document.connectors) {
    if (c.secretRef) secretRefs.add(c.secretRef);
  }
  for (const ref of Object.keys(opts.secrets)) secretRefs.add(ref);

  const inferInputs = (n: (typeof nodes)[number]): string[] => {
    const existing = Array.isArray(n.inputs)
      ? (n.inputs as string[]).map(String).filter(Boolean)
      : [];
    if (existing.length) return existing;
    const keys: string[] = [];
    for (const e of edges) {
      if (String(e.target) !== String(n.id)) continue;
      const src = byId.get(String(e.source));
      if (!src) continue;
      const outs =
        Array.isArray(src.outputs) && src.outputs.length
          ? (src.outputs as string[])
          : [`stage.${String(src.type ?? "node").replace(/\./g, "_")}`];
      for (const o of outs) {
        const key = String(o);
        if (key && !keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  };

  const tasks: TaskStep[] = order.map((id) => {
    const n = byId.get(id)!;
    let config = { ...((n.config as Record<string, unknown>) ?? {}) };
    const ntype = String(n.type);
    if (ntype === "notebook") {
      const mode = String(config.notebookSource ?? (config.notebookId ? "saved" : "inline"));
      if (mode === "saved" && config.notebookId) {
        const notebooks = opts.document.notebooks ?? [];
        const nb = notebooks.find((x) => x.id === String(config.notebookId));
        if (nb) {
          const source = nb.cells
            .map((c) => {
              const body = (c.source ?? "").replace(/\r\n/g, "\n").trimEnd();
              if (c.cell_type === "markdown") return `# %% markdown\n${body}\n`;
              return `# %%\n${body}\n`;
            })
            .join("\n");
          config = {
            ...config,
            source,
            notebookName: nb.name,
            resolvedFrom: nb.id,
          };
        } else {
          config = {
            ...config,
            source:
              String(config.source ?? "") ||
              "# %%\nresult = {\"ok\": False, \"error\": \"saved notebook not found\"}\n",
            resolveError: `notebook ${config.notebookId} missing`,
          };
        }
      }
    }
    return {
      id,
      name: String(n.label ?? id),
      type: ntype,
      category: String(n.category ?? "logic"),
      connector: n.connector ? String(n.connector) : undefined,
      inputs: inferInputs(n),
      outputs: (() => {
        const unique = `stage.${id.replace(/\./g, "_")}`;
        const existing = Array.isArray(n.outputs)
          ? (n.outputs as string[]).map(String).filter(Boolean)
          : [];
        if (!existing.length) return [unique];
        return existing.includes(unique) ? existing : [unique, ...existing];
      })(),
      config,
      depends_on: depends.get(id) ?? [],
    };
  });

  return {
    run: {
      workspace_id: opts.document.workspace.id,
      workspace_name: opts.document.workspace.name,
      version: opts.document.workspace.version,
      run_id: opts.runId,
      generated_at: new Date().toISOString(),
      ...(opts.chat?.question
        ? {
            chat: {
              sessionId: opts.chat.sessionId,
              question: opts.chat.question,
              history: opts.chat.history ?? [],
            },
          }
        : {}),
    },
    connectors: opts.document.connectors.map((c: ConnectorRef) => ({
      id: c.id,
      type: c.type,
      mode: c.mode,
      label: c.label,
      secret_ref: c.secretRef,
      config: c.config,
    })),
    secrets: [...secretRefs].map((ref) => ({
      ref,
      env_key: ref.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase(),
    })),
    tasks,
    edges: edges.map((e, i) => ({
      id: String(e.id ?? `e_${i}`),
      source: String(e.source),
      target: String(e.target),
      ...(e.sourceHandle ? { sourceHandle: String(e.sourceHandle) } : {}),
      ...(e.targetHandle ? { targetHandle: String(e.targetHandle) } : {}),
      ...(e.label != null && String(e.label).length
        ? { label: String(e.label) }
        : {}),
    })),
  };
}

export function dumpTasksYaml(tasks: TasksFile): string {
  return yaml.dump(tasks, { indent: 2, lineWidth: 100, noRefs: true, sortKeys: false });
}

export function dumpSecretsLocalYaml(secrets: Record<string, string>): string {
  return yaml.dump(
    {
      note: "LOCAL ONLY — decrypted secrets for this run. Do not commit.",
      secrets,
    },
    { indent: 2, lineWidth: 100, noRefs: true },
  );
}
