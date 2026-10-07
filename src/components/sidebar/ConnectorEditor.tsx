/**
 * Shared connector create / edit form used by Plug and Connectors tabs.
 */

import { allocateConnectorId } from "@/core/connectorLibrary";
import { getPlugin, type PluginDef, type PluginField } from "@/core/pluginCatalog";
import { api } from "@/lib/api";
import { useStudioStore } from "@/store/studioStore";
import type { ConnectorRef } from "@/types/workspace";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";

type FormState = Record<string, string>;

export function resolvePluginForConnector(
  connector: Pick<ConnectorRef, "pluginId" | "type">,
): PluginDef | undefined {
  if (connector.pluginId) {
    const byId = getPlugin(connector.pluginId);
    if (byId) return byId;
  }
  return getPlugin(connector.type);
}

export async function saveConnectorFromForm(
  plugin: PluginDef,
  form: FormState,
  label: string,
  editing?: ConnectorRef,
): Promise<string> {
  const store = useStudioStore.getState();
  const document = store.document;
  const secretParts: Record<string, string> = {};
  const config: Record<string, unknown> = {};
  for (const f of plugin.fields) {
    const v = form[f.key]?.trim();
    if (!v) continue;
    if (f.secret) secretParts[f.key] = v;
    else config[f.key] = f.kind === "number" ? Number(v) : v;
  }

  // Migrate legacy secret values that were mistakenly stored in connector config
  // (e.g. S3 accessKeyId before it was marked secret).
  if (editing?.config) {
    for (const f of plugin.fields) {
      if (!f.secret || secretParts[f.key]) continue;
      const legacy = editing.config[f.key];
      if (legacy == null) continue;
      const s = String(legacy).trim();
      if (s) secretParts[f.key] = s;
    }
  }

  // Partial secret updates must merge — never wipe sibling keys (access + secret).
  if (editing?.secretRef && Object.keys(secretParts).length) {
    const pending = store.pendingSecrets.find(
      (s) => s.secretRef === editing.secretRef,
    );
    if (pending?.value) {
      try {
        const prev = JSON.parse(pending.value) as unknown;
        if (prev && typeof prev === "object" && !Array.isArray(prev)) {
          Object.assign(secretParts, {
            ...(prev as Record<string, string>),
            ...secretParts,
          });
        }
      } catch {
        /* keep typed fields only */
      }
    }
  }

  // Strip secret keys from config so they never land in YAML.
  // Preserve existing non-secret config when only auth fields are updated.
  const cleanedConfig: Record<string, unknown> = {
    ...(editing?.config ?? {}),
    ...config,
  };
  for (const f of plugin.fields) {
    if (f.secret) delete cleanedConfig[f.key];
  }

  const connectorId =
    editing?.id ??
    allocateConnectorId(
      plugin.id,
      document.connectors.map((c) => c.id),
      label,
    );
  const secretRef = editing?.secretRef ?? `secret://${connectorId}`;
  const mongoMode =
    plugin.id === "mongodb"
      ? ((form.mode as "local" | "atlas" | "iaas") ?? "local")
      : undefined;

  store.upsertPluginConnector({
    id: connectorId,
    type: plugin.connectorType,
    label: label || plugin.name,
    mode: mongoMode,
    secretRef,
    config: cleanedConfig,
    pluginId: plugin.id,
  });

  if (Object.keys(secretParts).length) {
    const payload = {
      secretRef,
      value: JSON.stringify(secretParts),
      label: `${label || plugin.name} credentials`,
    };
    // Always keep in the Run queue — Mongo upsert is optional persistence only.
    // Do NOT remove from pending after putSecret; Run overlays pending on top of DB.
    store.queuePendingSecret(payload);

    if (store.backendSynced) {
      try {
        await api.putSecret(document.workspace.id, payload);
        store.pushLog({
          level: "info",
          message: `${label || plugin.name} secret updated for Run + encrypted in MongoDB (${secretRef})`,
        });
      } catch (err) {
        store.pushLog({
          level: "warn",
          message:
            err instanceof Error
              ? `${err.message} — secret stays queued for Run; Apply encrypts in MongoDB`
              : "Could not store secret in MongoDB — queued for Run; Apply encrypts when ready",
        });
      }
    } else {
      store.pushLog({
        level: "info",
        message: `${label || plugin.name} secret queued for Run (${secretRef}) — Apply only if you want it saved in MongoDB`,
      });
    }
  } else if (editing?.secretRef) {
    store.pushLog({
      level: "warn",
      message: `Connector “${label || plugin.name}” saved without new secrets — existing secret for ${editing.secretRef} was left unchanged. Re-type Access key ID and Secret access key to update them.`,
    });
  }

  store.pushLog({
    level: "info",
    message: `${plugin.name} connector “${label || plugin.name}” (${connectorId}) ready`,
  });
  return connectorId;
}

export function ConnectorConfigureForm({
  plugin,
  existing,
  defaultLabel,
  isNew,
  backLabel = "Back",
  onBack,
  onSaved,
}: {
  plugin: PluginDef;
  existing?: ConnectorRef;
  defaultLabel: string;
  isNew: boolean;
  backLabel?: string;
  onBack: () => void;
  onSaved?: () => void;
}) {
  const [label, setLabel] = useState(defaultLabel);
  const [form, setForm] = useState<FormState>(() => {
    const init: FormState = {};
    for (const f of plugin.fields) {
      const prev = existing?.config?.[f.key];
      init[f.key] =
        prev != null
          ? String(prev)
          : f.kind === "select"
            ? (f.options?.[0]?.value ?? "")
            : "";
    }
    if (existing?.mode && plugin.fields.some((f) => f.key === "mode")) {
      init.mode = existing.mode;
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups: Array<PluginField["group"]> = ["connection", "auth", "target"];
  const titles: Record<PluginField["group"], string> = {
    connection: "Connection",
    auth: "Authentication",
    target: "Database / target",
  };

  const setField = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-700 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1 text-[11px] text-ink-400 hover:text-cyan-400"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[9px] font-bold text-navy-950"
            style={{ background: plugin.accent }}
          >
            {plugin.badge}
          </div>
          <div>
            <div className="text-xs font-semibold text-ink-100">{plugin.name}</div>
            <div className="text-[10px] text-ink-400">
              {isNew ? "Add connector" : "Edit / update connector"}
              {existing?.id ? ` · ${existing.id}` : ""}
              {plugin.custom ? " · custom" : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <label className="text-[10px] text-ink-400">Connector label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Prod, Staging EU, Local"
            className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
          />
          <p className="mt-0.5 text-[9px] text-ink-500">
            Distinct label per environment. Each connector has its own id and
            secret.
          </p>
        </div>

        {groups.map((g) => {
          const gfields = plugin.fields.filter((f) => f.group === g);
          if (!gfields.length) return null;
          return (
            <div key={g}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {titles[g]}
              </div>
              <div className="space-y-2">
                {gfields.map((f) => (
                  <div key={f.key}>
                    <label className="text-[10px] text-ink-400">
                      {f.label}
                      {f.required ? " *" : ""}
                      {f.secret ? " · secret" : ""}
                    </label>
                    {f.kind === "select" ? (
                      <select
                        value={form[f.key] ?? ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          f.kind === "password"
                            ? "password"
                            : f.kind === "number"
                              ? "number"
                              : "text"
                        }
                        value={form[f.key] ?? ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                        placeholder={
                          f.secret && !isNew
                            ? "Re-type to update (blank = keep existing)"
                            : f.placeholder
                        }
                        autoComplete={
                          f.secret || f.kind === "password"
                            ? "new-password"
                            : "off"
                        }
                        className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
                      />
                    )}
                    {f.secret && !isNew && (
                      <p className="mt-0.5 text-[9px] text-amber-400/90">
                        Leave blank to keep the current secret. Type the full
                        password again to change it for the next Run.
                      </p>
                    )}
                    {f.help && (
                      <p className="mt-0.5 text-[9px] text-ink-400">{f.help}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>

      <div className="border-t border-navy-700 p-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            // On edit, blank secret fields mean "keep existing" — do not require re-entry.
            const missing = plugin.fields.filter((f) => {
              if (!f.required || form[f.key]?.trim()) return false;
              if (existing && f.secret) return false;
              return true;
            });
            if (missing.length) {
              setError(`${missing[0].label} is required`);
              return;
            }
            setError(null);
            setSaving(true);
            void saveConnectorFromForm(plugin, form, label, existing)
              .then(() => onSaved?.())
              .finally(() => setSaving(false));
          }}
          className="btn-primary w-full px-3 py-2 text-xs disabled:opacity-60"
        >
          {saving
            ? "Saving…"
            : isNew
              ? "Save connector & API key"
              : "Update connector & API key"}
        </button>
        <p className="mt-1.5 text-[9px] leading-relaxed text-ink-400">
          Password updates are used on the next <span className="text-ink-200">Run</span>{" "}
          immediately. <span className="text-ink-200">Apply</span> only persists
          them into MongoDB.
        </p>
      </div>
    </div>
  );
}

export function connectorDefaultLabel(
  plugin: PluginDef,
  connectors: ConnectorRef[],
  editing?: ConnectorRef,
): string {
  if (editing?.label) return editing.label;
  const siblingCount = connectors.filter(
    (c) => c.pluginId === plugin.id || c.type === plugin.connectorType,
  ).length;
  return siblingCount === 0
    ? `${plugin.name} Prod`
    : `${plugin.name} ${siblingCount + 1}`;
}
