import {
  CUSTOM_PLUGIN_STORAGE_KEY,
  createEmptyCustomField,
  deleteCustomPlugin,
  getAllPlugins,
  getPlugin,
  loadCustomPlugins,
  slugifyPluginId,
  upsertCustomPlugin,
  type PluginDef,
  type PluginField,
  type PluginFieldKind,
} from "@/core/pluginCatalog";
import {
  ConnectorConfigureForm,
  connectorDefaultLabel,
} from "@/components/sidebar/ConnectorEditor";
import {
  installPluginPackage,
  nodesForPlugin,
  readInstalledPluginIds,
  uninstallPluginPackage,
  writeInstalledPluginIds,
} from "@/core/pluginInstall";
import { api } from "@/lib/api";
import { useStudioStore } from "@/store/studioStore";
import {
  Check,
  ChevronLeft,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  Plug,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PanelMode =
  | { kind: "list" }
  | { kind: "configure"; id: string; connectorId?: string }
  | { kind: "custom-editor"; editId?: string };

export function PluginsPanel() {
  const [installed, setInstalled] = useState<string[]>(readInstalledPluginIds);
  const [mode, setMode] = useState<PanelMode>({ kind: "list" });
  const [q, setQ] = useState("");
  const [catalogTick, setCatalogTick] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const document = useStudioStore((s) => s.document);
  const removePluginConnector = useStudioStore((s) => s.removePluginConnector);
  const pendingSecrets = useStudioStore((s) => s.pendingSecrets);
  const requestApplyToBackend = useStudioStore((s) => s.requestApplyToBackend);
  const pushLog = useStudioStore((s) => s.pushLog);
  const setLeftTab = useStudioStore((s) => s.setLeftTab);

  useEffect(() => {
    writeInstalledPluginIds(installed);
  }, [installed]);

  useEffect(() => {
    void api.listPlugins().then((res) => {
      const map: Record<string, string> = {};
      for (const item of res.items) map[item.pluginId] = item.localPath;
      setPaths(map);
    }).catch(() => undefined);
  }, [installed, catalogTick]);

  const catalog = useMemo(() => {
    void catalogTick;
    return getAllPlugins();
  }, [catalogTick]);

  const refreshCatalog = () => setCatalogTick((n) => n + 1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.vendor.toLowerCase().includes(needle) ||
        p.category.includes(needle) ||
        p.connectorType.toLowerCase().includes(needle),
    );
  }, [q, catalog]);

  if (mode.kind === "configure") {
    const configuring = getPlugin(mode.id);
    if (!configuring) {
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
    const editing = mode.connectorId
      ? document.connectors.find((c) => c.id === mode.connectorId)
      : undefined;
    return (
      <ConnectorConfigureForm
        plugin={configuring}
        existing={editing}
        defaultLabel={connectorDefaultLabel(
          configuring,
          document.connectors,
          editing,
        )}
        isNew={!editing}
        backLabel="Plugins"
        onBack={() => setMode({ kind: "list" })}
        onSaved={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "custom-editor") {
    const editing = mode.editId
      ? loadCustomPlugins().find((p) => p.id === mode.editId)
      : undefined;
    return (
      <CustomPluginEditor
        initial={editing}
        onBack={() => setMode({ kind: "list" })}
        onSaved={(plugin) => {
          void installPluginPackage(plugin).then((res) => {
            setInstalled(readInstalledPluginIds());
            if (res.localPath) {
              setPaths((m) => ({ ...m, [plugin.id]: res.localPath! }));
            }
            refreshCatalog();
            pushLog({
              level: "info",
              message: `Custom plugin “${plugin.name}” ${editing ? "updated" : "added"} · ${res.nodesUnlocked.length} nodes`,
            });
            setMode({ kind: "list" });
          });
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-700 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink-100">
          <Plug className="h-3.5 w-3.5 text-cyan-500" />
          Plugins
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
          Loosely coupled packages: install unlocks product nodes. Add multiple
          connectors per plugin (prod / staging / local). Manage all of them in
          the{" "}
          <button
            type="button"
            className="text-cyan-400 hover:underline"
            onClick={() => setLeftTab("connectors")}
          >
            Conn
          </button>{" "}
          tab. Packages under{" "}
          <code className="text-cyan-500">data/plugins/&lt;id&gt;</code>.
        </p>
        {pendingSecrets.length > 0 && (
          <button
            type="button"
            onClick={() => requestApplyToBackend()}
            className="btn-accent mt-2 w-full rounded-lg px-3 py-2 text-left"
          >
            {pendingSecrets.length} API key(s) ready — click to{" "}
            <span className="font-semibold">Apply / Create in MongoDB</span>
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search plugins…"
          className="mt-2 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
        />
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode({ kind: "custom-editor" })}
            className="btn-primary flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[10px]"
          >
            <Plus className="h-3 w-3" />
            Custom plugin
          </button>
          <label className="flex cursor-pointer items-center gap-1 rounded-md border border-navy-600 px-2 py-1.5 text-[10px] text-ink-300 hover:border-cyan-500/50 hover:text-cyan-400">
            <Upload className="h-3 w-3" />
            Import
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void file.text().then((text) => {
                  try {
                    const raw = JSON.parse(text) as PluginDef | PluginDef[];
                    const list = Array.isArray(raw) ? raw : [raw];
                    let n = 0;
                    for (const item of list) {
                      if (!item?.name || !Array.isArray(item.fields)) continue;
                      const id =
                        item.id && !getAllPlugins().some((p) => p.id === item.id && !p.custom)
                          ? item.id
                          : slugifyPluginId(item.name);
                      upsertCustomPlugin({
                        ...item,
                        id,
                        vendor: item.vendor || "Custom",
                        category: "custom",
                        description: item.description || "Imported custom plugin",
                        connectorType: item.connectorType || id,
                        accent: item.accent || "#22d3ee",
                        badge: (item.badge || item.name.slice(0, 3)).toUpperCase().slice(0, 4),
                        unlocks: item.unlocks ?? [`${id}.connect`],
                        custom: true,
                        fields: item.fields,
                      });
                      setInstalled((ids) => (ids.includes(id) ? ids : [...ids, id]));
                      n += 1;
                    }
                    refreshCatalog();
                    pushLog({
                      level: "info",
                      message: `Imported ${n} custom plugin${n === 1 ? "" : "s"}`,
                    });
                  } catch (err) {
                    pushLog({
                      level: "error",
                      message:
                        err instanceof Error
                          ? err.message
                          : "Invalid plugin JSON",
                    });
                  }
                });
              }}
            />
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {filtered.map((p) => {
          const isOn = installed.includes(p.id);
          const nodes = nodesForPlugin(p);
          const pluginConnectors = document.connectors.filter(
            (c) => c.pluginId === p.id || c.type === p.connectorType,
          );
          return (
            <div
              key={p.id}
              className="rounded-xl border border-navy-600 bg-navy-800/50 p-3"
            >
              <div className="flex gap-2">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-navy-950"
                  style={{ background: p.accent }}
                >
                  {p.badge}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-ink-100">
                      {p.name}
                    </span>
                    {p.category === "workflow" && (
                      <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-400">
                        Workflow
                      </span>
                    )}
                    {p.custom && (
                      <span className="rounded bg-cyan-500/15 px-1 text-[9px] text-cyan-400">
                        Custom
                      </span>
                    )}
                    {isOn && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-ok/15 px-1 text-[9px] text-ok">
                        <Check className="h-2.5 w-2.5" /> Installed
                      </span>
                    )}
                    <span className="rounded bg-navy-700 px-1 text-[9px] text-ink-300">
                      {nodes.length} nodes
                    </span>
                    {pluginConnectors.length > 0 && (
                      <span className="rounded bg-cyan-500/15 px-1 text-[9px] text-cyan-400">
                        {pluginConnectors.length} connector
                        {pluginConnectors.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-ink-400">{p.vendor}</div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-ink-400">
                    {p.description}
                  </p>
                  <p className="mt-1 line-clamp-2 font-mono text-[9px] text-ink-500">
                    {nodes.map((n) => n.type.split(".").pop()).join(" · ")}
                  </p>
                  {isOn && paths[p.id] && (
                    <p className="mt-1 flex items-start gap-1 text-[9px] text-cyan-500/90">
                      <FolderOpen className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-all">{paths[p.id]}</span>
                    </p>
                  )}
                </div>
              </div>

              {isOn && pluginConnectors.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg border border-navy-700 bg-navy-950/40 p-1.5">
                  {pluginConnectors.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-navy-800/80"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-ink-100">
                          {c.label || c.id}
                        </div>
                        <div className="truncate font-mono text-[9px] text-ink-500">
                          {c.id}
                          {c.mode ? ` · ${c.mode}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        title="Edit connector"
                        onClick={() =>
                          setMode({
                            kind: "configure",
                            id: p.id,
                            connectorId: c.id,
                          })
                        }
                        className="rounded p-1 text-ink-400 hover:bg-navy-700 hover:text-cyan-400"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Remove connector"
                        onClick={() => {
                          removePluginConnector(c.id);
                          pushLog({
                            level: "info",
                            message: `Removed connector “${c.label || c.id}”`,
                          });
                        }}
                        className="rounded p-1 text-ink-400 hover:bg-navy-700 hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {!isOn ? (
                  <button
                    type="button"
                    disabled={installing === p.id}
                    onClick={() => {
                      setInstalling(p.id);
                      void installPluginPackage(p)
                        .then((res) => {
                          setInstalled(readInstalledPluginIds());
                          if (res.localPath) {
                            setPaths((m) => ({ ...m, [p.id]: res.localPath! }));
                          }
                          pushLog({
                            level: "info",
                            message: res.offline
                              ? `${p.name} unlocked ${res.nodesUnlocked.length} nodes (API offline — package not written)`
                              : `${p.name} installed → ${res.localPath} (${res.nodesUnlocked.length} nodes)`,
                          });
                        })
                        .finally(() => setInstalling(null));
                    }}
                    className="btn-primary flex items-center gap-1 px-2 py-1 text-[10px] disabled:opacity-60"
                  >
                    <Download className="h-3 w-3" />
                    {installing === p.id ? "Installing…" : "Install"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "configure", id: p.id })}
                      className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-cyan-500 hover:border-cyan-500/50"
                    >
                      {pluginConnectors.length > 0 ? (
                        <>
                          <Plus className="h-3 w-3" />
                          Add connector
                        </>
                      ) : (
                        <>
                          <Settings2 className="h-3 w-3" />
                          Configure
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={installing === p.id}
                      onClick={() => {
                        setInstalling(p.id);
                        void installPluginPackage(p)
                          .then((res) => {
                            if (res.localPath) {
                              setPaths((m) => ({ ...m, [p.id]: res.localPath! }));
                            }
                            pushLog({
                              level: "info",
                              message: `Re-materialized ${p.name} package (${res.nodesUnlocked.length} nodes)`,
                            });
                          })
                          .finally(() => setInstalling(null));
                      }}
                      className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-ink-300 hover:border-cyan-500/50"
                    >
                      <FolderOpen className="h-3 w-3" />
                      Sync package
                    </button>
                    {p.id !== "mongodb" && (
                      <button
                        type="button"
                        onClick={() => {
                          void uninstallPluginPackage(p.id).then(() => {
                            setInstalled(readInstalledPluginIds());
                            setPaths((m) => {
                              const next = { ...m };
                              delete next[p.id];
                              return next;
                            });
                            pushLog({
                              level: "info",
                              message: `${p.name} removed — nodes hidden from palette`,
                            });
                          });
                        }}
                        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-ink-400 hover:border-danger hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </>
                )}
                {p.custom && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setMode({ kind: "custom-editor", editId: p.id })
                      }
                      className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-ink-300 hover:border-cyan-500/50"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCustomPlugin(p.id);
                        void uninstallPluginPackage(p.id).then(() => {
                          setInstalled(readInstalledPluginIds());
                          refreshCatalog();
                          pushLog({
                            level: "info",
                            message: `Deleted custom plugin “${p.name}”`,
                          });
                        });
                      }}
                      className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[10px] text-ink-400 hover:border-danger hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <p className="py-6 text-center text-[11px] text-ink-400">
            No plugins match. Try adding a custom plugin.
          </p>
        )}
      </div>
      <p className="border-t border-navy-700 px-3 py-2 text-[9px] text-ink-400">
        Custom defs stored in browser ({CUSTOM_PLUGIN_STORAGE_KEY}). Export via
        Edit → copy JSON from your definition anytime.
      </p>
    </div>
  );
}

function CustomPluginEditor({
  initial,
  onBack,
  onSaved,
}: {
  initial?: PluginDef;
  onBack: () => void;
  onSaved: (plugin: PluginDef) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "Custom");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [connectorType, setConnectorType] = useState(initial?.connectorType ?? "");
  const [badge, setBadge] = useState(initial?.badge ?? "CUS");
  const [accent, setAccent] = useState(initial?.accent ?? "#22d3ee");
  const [fields, setFields] = useState<PluginField[]>(
    initial?.fields?.length
      ? initial.fields.map((f) => ({ ...f }))
      : [
          {
            key: "host",
            label: "Host / endpoint",
            kind: "text",
            group: "connection",
            required: true,
            placeholder: "https://api.example.com",
          },
          {
            key: "apiKey",
            label: "API key / token",
            kind: "password",
            group: "auth",
            secret: true,
            required: true,
          },
          {
            key: "database",
            label: "Database / dataset",
            kind: "text",
            group: "target",
          },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const [jsonImport, setJsonImport] = useState("");

  const updateField = (idx: number, patch: Partial<PluginField>) => {
    setFields((list) =>
      list.map((f, i) => {
        if (i !== idx) return f;
        const next = { ...f, ...patch };
        if (patch.label != null && !initial && !f.key) {
          next.key = slugifyPluginId(patch.label);
        }
        if (patch.kind === "password") next.secret = true;
        return next;
      }),
    );
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    const id = initial?.id ?? slugifyPluginId(trimmed);
    const type = (connectorType.trim() || id).toLowerCase().replace(/\s+/g, "_");
    const cleaned = fields
      .map((f) => ({
        ...f,
        key: (f.key || slugifyPluginId(f.label)).trim(),
        label: f.label.trim(),
      }))
      .filter((f) => f.key && f.label);

    if (!cleaned.length) {
      setError("Add at least one field");
      return;
    }
    const keys = new Set<string>();
    for (const f of cleaned) {
      if (keys.has(f.key)) {
        setError(`Duplicate field key: ${f.key}`);
        return;
      }
      keys.add(f.key);
    }

    try {
      const plugin = upsertCustomPlugin({
        id,
        name: trimmed,
        vendor: vendor.trim() || "Custom",
        category: "custom",
        description:
          description.trim() ||
          `Custom connector for ${trimmed}`,
        connectorType: type,
        accent,
        badge: (badge.trim() || trimmed.slice(0, 3)).toUpperCase().slice(0, 4),
        fields: cleaned,
        unlocks: [`${type}.connect`],
        custom: true,
      });
      onSaved(plugin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plugin");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-700 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1 text-[11px] text-ink-400 hover:text-cyan-400"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Plugins
        </button>
        <div className="text-xs font-semibold text-ink-100">
          {initial ? "Edit custom plugin" : "New custom plugin"}
        </div>
        <p className="text-[10px] text-ink-400">
          Define metadata and dynamic connector fields for any product.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="text-[10px] text-ink-400">Name *</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!initial && !connectorType) {
                  setConnectorType(slugifyPluginId(e.target.value));
                }
                if (!initial) {
                  setBadge(e.target.value.slice(0, 3).toUpperCase() || "CUS");
                }
              }}
              placeholder="Acme Warehouse"
              className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-400">Vendor</label>
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-400">Connector type</label>
            <input
              value={connectorType}
              onChange={(e) => setConnectorType(e.target.value)}
              placeholder="acme_warehouse"
              className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-400">Badge</label>
            <input
              value={badge}
              maxLength={4}
              onChange={(e) => setBadge(e.target.value.toUpperCase())}
              className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-400">Accent color</label>
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="mt-0.5 h-8 w-full cursor-pointer rounded-lg border border-navy-600 bg-navy-950"
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-ink-400">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Fields
            </span>
            <button
              type="button"
              onClick={() =>
                setFields((list) => [...list, createEmptyCustomField()])
              }
              className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              <Plus className="h-3 w-3" />
              Add field
            </button>
          </div>
          <div className="space-y-2">
            {fields.map((f, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-navy-600 bg-navy-950/80 p-2"
              >
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={f.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="Label"
                    className="rounded border border-navy-600 bg-navy-900 px-2 py-1 text-[11px] outline-none focus:border-cyan-500"
                  />
                  <input
                    value={f.key}
                    onChange={(e) =>
                      updateField(idx, {
                        key: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9_]/g, "_"),
                      })
                    }
                    placeholder="key"
                    className="rounded border border-navy-600 bg-navy-900 px-2 py-1 font-mono text-[11px] outline-none focus:border-cyan-500"
                  />
                  <select
                    value={f.kind}
                    onChange={(e) =>
                      updateField(idx, {
                        kind: e.target.value as PluginFieldKind,
                      })
                    }
                    className="rounded border border-navy-600 bg-navy-900 px-2 py-1 text-[11px] outline-none focus:border-cyan-500"
                  >
                    <option value="text">Text</option>
                    <option value="password">Password / secret</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                  </select>
                  <select
                    value={f.group}
                    onChange={(e) =>
                      updateField(idx, {
                        group: e.target.value as PluginField["group"],
                      })
                    }
                    className="rounded border border-navy-600 bg-navy-900 px-2 py-1 text-[11px] outline-none focus:border-cyan-500"
                  >
                    <option value="connection">Connection</option>
                    <option value="auth">Auth</option>
                    <option value="target">Target</option>
                  </select>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-400">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) =>
                        updateField(idx, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!f.secret}
                      onChange={(e) =>
                        updateField(idx, { secret: e.target.checked })
                      }
                    />
                    Secret
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setFields((list) => list.filter((_, i) => i !== idx))
                    }
                    className="ml-auto text-danger hover:underline"
                  >
                    Remove
                  </button>
                </div>
                {f.kind === "select" && (
                  <input
                    value={(f.options ?? [])
                      .map((o) => o.value)
                      .join(",")}
                    onChange={(e) =>
                      updateField(idx, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((v) => ({ value: v, label: v })),
                      })
                    }
                    placeholder="Select options (comma-separated)"
                    className="mt-1.5 w-full rounded border border-navy-600 bg-navy-900 px-2 py-1 text-[11px] outline-none focus:border-cyan-500"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-ink-400">
            Paste JSON definition (optional override)
          </label>
          <textarea
            value={jsonImport}
            onChange={(e) => setJsonImport(e.target.value)}
            rows={3}
            placeholder='{"name":"…","fields":[…]}'
            className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 font-mono text-[10px] outline-none focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={() => {
              try {
                const raw = JSON.parse(jsonImport) as PluginDef;
                if (!raw.name || !Array.isArray(raw.fields)) {
                  setError("JSON needs name and fields[]");
                  return;
                }
                setName(raw.name);
                setVendor(raw.vendor || "Custom");
                setDescription(raw.description || "");
                setConnectorType(raw.connectorType || slugifyPluginId(raw.name));
                setBadge(raw.badge || raw.name.slice(0, 3).toUpperCase());
                setAccent(raw.accent || "#22d3ee");
                setFields(raw.fields);
                setError(null);
              } catch {
                setError("Invalid JSON");
              }
            }}
            className="mt-1 text-[10px] text-cyan-400 hover:underline"
          >
            Apply JSON to form
          </button>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>

      <div className="border-t border-navy-700 p-3">
        <button
          type="button"
          onClick={save}
          className="btn-primary w-full px-3 py-2 text-xs"
        >
          {initial ? "Update plugin" : "Create & install"}
        </button>
      </div>
    </div>
  );
}
