/**
 * Studio-wide connector library — survives New workspace so plugin
 * connectors stay visible across workflows. Multiple connectors per
 * plugin (e.g. Atlas prod + staging) are supported via unique ids.
 */

import type { ConnectorRef } from "@/types/workspace";

const KEY = "vynelix-connector-library";

export function loadConnectorLibrary(): ConnectorRef[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConnectorRef[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Upsert by connector id only — same plugin may have many connectors. */
export function upsertConnectorLibrary(connector: ConnectorRef): ConnectorRef[] {
  const existing = loadConnectorLibrary();
  const idx = existing.findIndex((c) => c.id === connector.id);
  const next =
    idx >= 0
      ? existing.map((c, i) => (i === idx ? { ...c, ...connector } : c))
      : [...existing, connector];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function removeConnectorFromLibrary(id: string): void {
  const next = loadConnectorLibrary().filter((c) => c.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Stable slug for a plugin type (base id, not instance-unique). */
export function stableConnectorId(pluginId: string): string {
  return pluginId.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function slugPart(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

/**
 * Allocate a unique connector id for a new instance.
 * Prefers `plugin_label` (e.g. mongodb_atlas_prod), else plugin, else plugin_2…
 */
export function allocateConnectorId(
  pluginId: string,
  existingIds: string[],
  label?: string,
): string {
  const base = stableConnectorId(pluginId) || "connector";
  const taken = new Set(existingIds);
  const labelSlug = label ? slugPart(label) : "";
  if (labelSlug) {
    const candidate = `${base}_${labelSlug}`;
    if (!taken.has(candidate)) return candidate;
  }
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
