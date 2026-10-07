/**
 * Custom templates — converted from successful workflows (local library).
 * Scrubs secrets; keeps secretRef placeholders + variable examples only.
 */

import type { WorkspaceDocument } from "@/types/workspace";
import type { StudioTemplate, TemplateVariable } from "@/core/templateTypes";
import { slugId } from "@/core/templateTypes";

const KEY = "vynelix-custom-templates";

export interface CustomTemplateRecord {
  id: string;
  name: string;
  description: string;
  domain: StudioTemplate["domain"];
  products: string[];
  document: WorkspaceDocument;
  variables: TemplateVariable[];
  nodeCount: number;
  updatedAt: string;
  tags?: string[];
}

export function loadCustomTemplateRecords(): CustomTemplateRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomTemplateRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: CustomTemplateRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

/** Strip secrets / PII-looking config; keep structure + dummy examples. */
export function scrubDocumentForTemplate(
  doc: WorkspaceDocument,
  name: string,
  description: string,
): { document: WorkspaceDocument; variables: TemplateVariable[] } {
  const variables: TemplateVariable[] = [
    {
      key: "ENV",
      label: "Environment",
      example: "sandbox",
    },
  ];

  const connectors = (doc.connectors ?? []).map((c) => {
    const varKey = `CONNECTOR_${c.type}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    variables.push({
      key: varKey,
      label: c.label ?? c.type,
      example: `replace-${c.type}-connector`,
      description: "Configure under Conn / Plug — never embed real secrets in templates",
    });
    return {
      ...c,
      id: `tpl_${c.type}_${c.id}`.slice(0, 48),
      label: `${c.label ?? c.type} (template)`,
      secretRef: `secret://REPLACE_${c.type}`,
      config: {
        ...(c.config ?? {}),
        note: "Synthetic / placeholder — no production credentials",
        host: c.config?.host ? "{{HOST}}" : undefined,
        database: c.config?.database ?? "{{DATASET}}",
      },
    };
  });

  const nodes = doc.flow.nodes.map((n) => {
    const cfg = { ...(n.config ?? {}) };
    // Drop anything that looks like a secret
    for (const k of Object.keys(cfg)) {
      const lk = k.toLowerCase();
      if (
        lk.includes("password") ||
        lk.includes("secret") ||
        lk.includes("token") ||
        lk.includes("apikey") ||
        lk.includes("api_key") ||
        lk.includes("authorization")
      ) {
        cfg[k] = `{{${k.toUpperCase()}}}`;
        variables.push({
          key: k.toUpperCase(),
          label: k,
          example: "REDACTED_EXAMPLE",
        });
      }
    }
    return {
      ...n,
      config: cfg,
    };
  });

  const document: WorkspaceDocument = {
    ...doc,
    workspace: {
      ...doc.workspace,
      id: slugId("ws"),
      name: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      description,
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
    },
    connectors,
    flow: {
      ...doc.flow,
      nodes,
    },
  };

  return { document, variables };
}

export function saveCustomTemplate(input: {
  name: string;
  description: string;
  domain?: StudioTemplate["domain"];
  document: WorkspaceDocument;
}): CustomTemplateRecord {
  const { document, variables } = scrubDocumentForTemplate(
    input.document,
    input.name,
    input.description,
  );
  const rec: CustomTemplateRecord = {
    id: slugId("custom"),
    name: input.name,
    description: input.description,
    domain: input.domain ?? "de",
    products: [
      ...new Set(
        (document.connectors ?? []).map((c) => String(c.type)),
      ),
    ],
    document,
    variables,
    nodeCount: document.flow.nodes.length,
    updatedAt: new Date().toISOString(),
    tags: ["custom"],
  };
  const list = loadCustomTemplateRecords().filter((t) => t.id !== rec.id);
  writeAll([rec, ...list]);
  return rec;
}

export function deleteCustomTemplate(id: string) {
  writeAll(loadCustomTemplateRecords().filter((t) => t.id !== id));
}

export function customRecordsToTemplates(): StudioTemplate[] {
  return loadCustomTemplateRecords().map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    domain: r.domain,
    products: r.products,
    origin: "custom" as const,
    nodeCount: r.nodeCount,
    tags: r.tags,
    variables: r.variables,
    updatedAt: r.updatedAt,
    create: () => {
      const fresh = structuredClone(r.document);
      fresh.workspace.id = slugId("ws");
      fresh.workspace.updatedAt = new Date().toISOString();
      return fresh;
    },
  }));
}
