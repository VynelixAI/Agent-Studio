/**
 * Left-sidebar Connectors tab — view / add / edit / update / delete
 * every configured connector across all plugins.
 */

import {
  ConnectorConfigureForm,
  connectorDefaultLabel,
  resolvePluginForConnector,
} from "@/components/sidebar/ConnectorEditor";
import { getAllPlugins, getPlugin } from "@/core/pluginCatalog";
import { readInstalledPluginIds } from "@/core/pluginInstall";
import { useStudioStore } from "@/store/studioStore";
import type { ConnectorRef } from "@/types/workspace";
import {
  Cable,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; connectorId: string }
  | { kind: "add"; pluginId: string };

export function ConnectorsPanel() {
  const document = useStudioStore((s) => s.document);
  const removePluginConnector = useStudioStore((s) => s.removePluginConnector);
  const pushLog = useStudioStore((s) => s.pushLog);
  const setLeftTab = useStudioStore((s) => s.setLeftTab);
  const pendingSecrets = useStudioStore((s) => s.pendingSecrets);
  const requestApplyToBackend = useStudioStore((s) => s.requestApplyToBackend);

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [addPluginId, setAddPluginId] = useState("");

  const installed = useMemo(() => new Set(readInstalledPluginIds()), [mode]);
  const catalog = useMemo(() => getAllPlugins(), []);

  const addablePlugins = useMemo(
    () => catalog.filter((p) => installed.has(p.id)),
    [catalog, installed],
  );

  const typeOptions = useMemo(() => {
    const types = new Set(document.connectors.map((c) => c.type));
    return Array.from(types).sort();
  }, [document.connectors]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return document.connectors.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (!needle) return true;
      return (
        c.id.toLowerCase().includes(needle) ||
        (c.label ?? "").toLowerCase().includes(needle) ||
        c.type.toLowerCase().includes(needle) ||
        (c.pluginId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [document.connectors, typeFilter, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConnectorRef[]>();
    for (const c of filtered) {
      const key = c.type || "other";
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (mode.kind === "edit") {
    const existing = document.connectors.find((c) => c.id === mode.connectorId);
    const plugin = existing ? resolvePluginForConnector(existing) : undefined;
    if (!existing || !plugin) {
      return (
        <div className="p-3 text-[11px] text-ink-400">
          Connector or plugin definition not found.{" "}
          <button
            type="button"
            className="text-cyan-400 hover:underline"
            onClick={() => setMode({ kind: "list" })}
          >
            Back
          </button>
        </div>
      );
    }
    return (
      <ConnectorConfigureForm
        plugin={plugin}
        existing={existing}
        defaultLabel={connectorDefaultLabel(plugin, document.connectors, existing)}
        isNew={false}
        backLabel="Connectors"
        onBack={() => setMode({ kind: "list" })}
        onSaved={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "add") {
    const plugin = getPlugin(mode.pluginId);
    if (!plugin) {
      return (
        <div className="p-3 text-[11px] text-ink-400">
          Plugin not found.{" "}
          <button
            type="button"
            className="text-cyan-400 hover:underline"
            onClick={() => setMode({ kind: "list" })}
          >
            Back
          </button>
        </div>
      );
    }
    return (
      <ConnectorConfigureForm
        plugin={plugin}
        defaultLabel={connectorDefaultLabel(plugin, document.connectors)}
        isNew
        backLabel="Connectors"
        onBack={() => setMode({ kind: "list" })}
        onSaved={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-700 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink-100">
          <Cable className="h-3.5 w-3.5 text-cyan-500" />
          Connectors
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
          All configured connectors across plugins. Add multiple per type
          (prod / staging / local). Edit, update, or delete here.
        </p>
        {pendingSecrets.length > 0 && (
          <button
            type="button"
            onClick={() => requestApplyToBackend()}
            className="btn-accent mt-2 w-full rounded-lg px-3 py-2 text-left"
          >
            {pendingSecrets.length} API key(s) ready — Apply / Create in MongoDB
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search connectors…"
          className="mt-2 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
        />
        <label className="mt-2 block text-[10px] text-ink-400">
          Filter by type
        </label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
        >
          <option value="all">
            All connectors ({document.connectors.length})
          </option>
          {typeOptions.map((t) => {
            const n = document.connectors.filter((c) => c.type === t).length;
            return (
              <option key={t} value={t}>
                {t} ({n})
              </option>
            );
          })}
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="rounded-xl border border-navy-600 bg-navy-800/40 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Add connector
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <select
              value={addPluginId}
              onChange={(e) => setAddPluginId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
            >
              <option value="">— pick plugin —</option>
              {addablePlugins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addPluginId}
              onClick={() => {
                if (!addPluginId) return;
                setMode({ kind: "add", pluginId: addPluginId });
              }}
              className="btn-primary flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-[10px] disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>
          {!addablePlugins.length && (
            <p className="mt-1.5 text-[9px] text-amber-400">
              Install a plugin first from the{" "}
              <button
                type="button"
                className="underline hover:text-cyan-400"
                onClick={() => setLeftTab("plugins")}
              >
                Plug
              </button>{" "}
              tab.
            </p>
          )}
        </div>

        {!document.connectors.length && (
          <p className="py-6 text-center text-[11px] text-ink-400">
            No connectors yet. Install a plugin, then Add above.
          </p>
        )}

        {grouped.map(([type, list]) => (
          <div key={type}>
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {type}
              </span>
              <span className="text-[9px] text-ink-500">{list.length}</span>
            </div>
            <ul className="space-y-1.5">
              {list.map((c) => {
                const plugin = resolvePluginForConnector(c);
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-navy-600 bg-navy-800/50 p-2.5"
                  >
                    <div className="flex gap-2">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold text-navy-950"
                        style={{
                          background: plugin?.accent ?? "#64748b",
                        }}
                      >
                        {plugin?.badge ?? c.type.slice(0, 3).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-ink-100">
                          {c.label || c.id}
                        </div>
                        <div className="truncate font-mono text-[9px] text-ink-500">
                          {c.id}
                          {c.mode ? ` · ${c.mode}` : ""}
                        </div>
                        {c.secretRef && (
                          <div className="mt-0.5 truncate text-[9px] text-cyan-500/80">
                            {c.secretRef}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setMode({ kind: "edit", connectorId: c.id })
                        }
                        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-cyan-500 hover:border-cyan-500/50"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit / update
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removePluginConnector(c.id);
                          pushLog({
                            level: "info",
                            message: `Deleted connector “${c.label || c.id}”`,
                          });
                        }}
                        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-ink-400 hover:border-danger hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {document.connectors.length > 0 && !filtered.length && (
          <p className="py-4 text-center text-[11px] text-ink-400">
            No connectors match this filter.
          </p>
        )}
      </div>
    </div>
  );
}
