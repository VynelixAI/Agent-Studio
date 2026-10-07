import {
  agentTypesForVendor,
  agentVendorOptions,
  defaultAgentType,
  getAgentVendor,
} from "@/core/agentVendors";
import {
  generateDynamicCode,
  looksLikeIntentNotCode,
  type AiCodeLanguage,
  type AiNodeKind,
} from "@/core/aiCodegen";
import {
  SECTION_META,
  defaultConfigForType,
  getNodeSchema,
  type NodeFieldDef,
  type NodeFieldSection,
} from "@/core/nodeSchemas";
import { getPluginDrivenSchema } from "@/core/pluginNodeSchemas";
import { NodeVersionCard } from "@/components/inspector/NodeVersionCard";
import { getNodeDef } from "@/core/nodeRegistry";
import {
  defaultModelForProvider,
  getLlmProvider,
  LLM_PROVIDER_SCOPED_KEYS,
  llmProviderOptions,
  modelsForProvider,
} from "@/core/llmProviders";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import { Sparkles, Trash2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";

function stringifyConfigValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isFieldVisible(
  field: NodeFieldDef,
  config: Record<string, unknown> | undefined,
): boolean {
  if (!field.visibleWhen) return true;
  let raw = config?.[field.visibleWhen.key];
  // Dynamic code defaults to enabled when unset (LLM / Agent)
  if (field.visibleWhen.key === "enableDynamicCode" && raw === undefined) {
    raw = true;
  }
  if (field.visibleWhen.key === "codeMode" && raw === undefined) {
    raw = "from_intent";
  }
  if (field.visibleWhen.key === "writeYamlOutput" && raw === undefined) {
    raw = true;
  }
  const cur =
    typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw ?? "");
  const eq = field.visibleWhen.equals;
  return Array.isArray(eq) ? eq.includes(cur) : cur === eq;
}

function resolveFieldOptions(
  field: NodeFieldDef,
  config: Record<string, unknown> | undefined,
): Array<{ value: string; label: string }> {
  if (field.optionsFrom === "llmProviders") return llmProviderOptions();
  if (field.optionsFrom === "llmModels") {
    return modelsForProvider(String(config?.provider ?? "openai"));
  }
  if (field.optionsFrom === "agentVendors") return agentVendorOptions();
  if (field.optionsFrom === "agentTypes") {
    return agentTypesForVendor(String(config?.agentVendor ?? "langgraph"));
  }
  if (field.optionsFrom === "savedNotebooks") {
    const notebooks = useStudioStore.getState().document.notebooks ?? [];
    if (!notebooks.length) {
      return [{ value: "", label: "— save a notebook from Notebook menu —" }];
    }
    return [
      { value: "", label: "— select saved notebook —" },
      ...notebooks.map((n) => ({
        value: n.id,
        label: `${n.name} (${n.cells.length} cells)`,
      })),
    ];
  }
  return field.options ?? [];
}

function parseStageList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type StageOption = {
  value: string;
  nodeId: string;
  nodeLabel: string;
  /** Shown in the list */
  label: string;
};

function StageMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: StageOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const selectedSet = new Set(selected);
  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectedMeta = selected.map((value) => {
    const opt = options.find((o) => o.value === value);
    return {
      value,
      title: opt ? opt.nodeLabel : value,
      sub: opt && opt.nodeLabel !== value ? value : undefined,
    };
  });

  return (
    <div className="mt-0.5 space-y-1.5">
      {selectedMeta.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedMeta.map((s) => (
            <button
              key={s.value}
              type="button"
              title={s.sub ? `${s.title} → ${s.sub}` : s.title}
              onClick={() => toggle(s.value)}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:border-danger hover:text-danger"
            >
              <span className="truncate">{s.title}</span>
              {s.sub && (
                <span className="truncate font-mono text-[9px] text-ink-400">
                  {s.sub}
                </span>
              )}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      <div className="max-h-40 overflow-y-auto rounded-lg border border-navy-600 bg-navy-950">
        {options.length === 0 ? (
          <p className="px-2.5 py-2 text-[10px] text-ink-400">
            {placeholder ??
              "No upstream nodes yet — add nodes with outputs on the canvas"}
          </p>
        ) : (
          <ul className="divide-y divide-navy-800 py-0.5">
            {options.map((o) => {
              const on = selectedSet.has(o.value);
              return (
                <li key={`${o.nodeId}:${o.value}`}>
                  <label
                    className={clsx(
                      "flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-xs hover:bg-navy-900",
                      on && "bg-cyan-500/10",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={on}
                      onChange={() => toggle(o.value)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink-100">
                        {o.nodeLabel}
                      </span>
                      <span className="block truncate font-mono text-[9px] text-ink-400">
                        {o.value}
                        <span className="text-ink-500"> · {o.nodeId}</span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-[9px] text-ink-400">
        Select one or more node labels. Values stored as stage keys in YAML.
      </p>
    </div>
  );
}

function FieldControl({
  field,
  value,
  options,
  onChange,
}: {
  field: NodeFieldDef;
  value: unknown;
  options?: Array<{ value: string; label: string }>;
  onChange: (next: unknown) => void;
}) {
  const str = stringifyConfigValue(value);
  const base =
    "mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500";
  const mono = `${base} font-mono`;
  const selectOpts = options ?? field.options ?? [];

  switch (field.kind) {
    case "checkbox":
      return (
        <label className="mt-1 flex items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );
    case "number":
      return (
        <input
          type="number"
          className={base}
          value={value === undefined || value === null ? "" : Number(value)}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    case "select":
    case "format":
      return (
        <select
          className={base}
          value={str || String(field.defaultValue ?? selectOpts[0]?.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {selectOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "json":
      return (
        <textarea
          className={mono}
          rows={field.rows ?? 5}
          value={str}
          placeholder={field.placeholder}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value;
            try {
              onChange(JSON.parse(raw));
            } catch {
              onChange(raw);
            }
          }}
        />
      );
    case "code":
    case "template":
    case "textarea":
      return (
        <textarea
          className={mono}
          rows={field.rows ?? (field.kind === "code" ? 8 : 4)}
          value={str}
          placeholder={field.placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "cron":
    case "secretRef":
    case "text":
    default:
      return (
        <input
          type="text"
          className={field.kind === "secretRef" ? mono : base}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function SectionBlock({
  section,
  fields,
  renderField,
}: {
  section: NodeFieldSection;
  fields: NodeFieldDef[];
  renderField: (f: NodeFieldDef) => ReactNode;
}) {
  if (!fields.length) return null;
  const meta = SECTION_META[section];
  return (
    <section className="mt-4">
      <div className="mb-1.5 border-b border-navy-700 pb-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
          {meta.label}
        </h3>
        <p className="text-[10px] leading-snug text-ink-400">{meta.hint}</p>
      </div>
      <div className="space-y-3">{fields.map((f) => renderField(f))}</div>
    </section>
  );
}

export function InspectorPanel() {
  const document = useStudioStore((s) => s.document);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const updateMeta = useStudioStore((s) => s.updateMeta);

  const node = document.flow.nodes.find((n) => n.id === selectedNodeId);
  const def = node ? getNodeDef(node.type) : undefined;
  const schema = node
    ? (getNodeSchema(node.type) ?? getPluginDrivenSchema(node.type))
    : undefined;

  const upstreamStageOptions = useMemo((): StageOption[] => {
    if (!node) return [];
    const opts: StageOption[] = [];
    const seen = new Set<string>();
    for (const n of document.flow.nodes) {
      if (n.id === node.id) continue;
      const nodeLabel = (n.label ?? n.id).trim() || n.id;
      const outputs =
        n.outputs && n.outputs.length > 0
          ? n.outputs
          : [`stage.${n.id.replace(/[^a-zA-Z0-9_]+/g, "_")}`];
      for (const out of outputs) {
        const value = out.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        opts.push({
          value,
          nodeId: n.id,
          nodeLabel,
          label: `${nodeLabel} → ${value}`,
        });
      }
    }
    return opts.sort((a, b) =>
      a.nodeLabel.localeCompare(b.nodeLabel, undefined, { sensitivity: "base" }),
    );
  }, [document.flow.nodes, node]);

  if (!node) {
    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          Workspace
        </h2>
        <label className="mt-3 block text-[11px] text-ink-400">Name</label>
        <input
          className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 text-sm outline-none focus:border-cyan-500"
          value={document.workspace.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
        />
        <label className="mt-3 block text-[11px] text-ink-400">Version</label>
        <input
          className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 text-sm outline-none focus:border-cyan-500"
          value={document.workspace.version}
          onChange={(e) => updateMeta({ version: e.target.value })}
        />
        <label className="mt-3 block text-[11px] text-ink-400">Mode</label>
        <select
          className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 text-sm outline-none focus:border-cyan-500"
          value={document.workspace.mode}
          onChange={(e) =>
            updateMeta({ mode: e.target.value as "workflow" | "supervisor" })
          }
        >
          <option value="workflow">Workflow Agent Team</option>
          <option value="supervisor">Supervisor / Hierarchical</option>
        </select>
        <label className="mt-3 block text-[11px] text-ink-400">Description</label>
        <textarea
          className="mt-1 min-h-[80px] w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 text-sm outline-none focus:border-cyan-500"
          value={document.workspace.description ?? ""}
          onChange={(e) => updateMeta({ description: e.target.value })}
        />

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink-400">
          Connectors
        </h3>
        <div className="mt-2 space-y-2">
          {document.connectors.length === 0 && (
            <p className="text-[11px] text-ink-400">
              No connectors — use the Conn tab (left sidebar) or Plug → Configure.
            </p>
          )}
          {document.connectors.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-navy-600 bg-navy-800/60 px-3 py-2"
            >
              <div className="text-xs font-medium text-ink-100">
                {c.label ?? c.id}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-cyan-500">
                {c.id}
                {c.mode ? ` · ${c.mode}` : ""} · {c.type}
              </div>
              {c.secretRef && (
                <div className="mt-1 text-[10px] text-ink-400">
                  secret: {c.secretRef}
                </div>
              )}
            </div>
          ))}
          {document.connectors.length > 0 && (
            <p className="text-[10px] text-ink-400">
              Edit / delete from the left sidebar{" "}
              <span className="text-cyan-400">Conn</span> tab.
            </p>
          )}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-400">
          Select a node to configure typed Input → Processing → Output fields
          (scripts, prompts, mail/Teams templates, formats).
        </p>
      </div>
    );
  }

  const needsConnector = schema?.requiresConnector ?? def?.requiresConnector;
  const connectors = document.connectors.filter((c) => {
    if (!schema?.connectorTypes?.length) return true;
    return schema.connectorTypes.some(
      (t) =>
        c.type === t ||
        c.type.startsWith(t) ||
        c.pluginId === t ||
        (c.pluginId != null && c.pluginId.startsWith(t)),
    );
  });

  const fieldsBySection = (section: NodeFieldSection) =>
    (schema?.fields ?? []).filter(
      (f) => f.section === section && isFieldVisible(f, node.config),
    );

  const readFieldValue = (field: NodeFieldDef): unknown => {
    if (field.key === "__inputs") return (node.inputs ?? []).join(", ");
    if (field.key === "__outputs") return (node.outputs ?? []).join(", ");
    return node.config?.[field.key];
  };

  const writeFieldValue = (field: NodeFieldDef, next: unknown) => {
    if (field.key === "__inputs" || field.key === "__outputs") {
      const list = String(next ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      updateNode(
        node.id,
        field.key === "__inputs" ? { inputs: list } : { outputs: list },
      );
      return;
    }

    const cfg: Record<string, unknown> = {
      ...(node.config ?? {}),
      [field.key]: next,
    };

    // Provider switch → refresh model list default + package + secret hint
    if (field.key === "provider" && typeof next === "string") {
      const prov = getLlmProvider(next);
      cfg.model = defaultModelForProvider(next);
      cfg.customModel = "";
      for (const key of LLM_PROVIDER_SCOPED_KEYS) {
        if (key === "maxTokens") continue;
        delete cfg[key];
      }
      if (prov) {
        cfg.langchainPackage = prov.package;
        if (prov.secretEnv) {
          cfg.secretRef = `secret://${next}`;
        }
        for (const pf of prov.fields) {
          if (pf.defaultValue !== undefined) {
            cfg[pf.key] = pf.defaultValue;
          }
        }
      }
    }

    // Agent vendor switch → agent types + package + secret + remote defaults
    if (field.key === "agentVendor" && typeof next === "string") {
      const vendor = getAgentVendor(next);
      cfg.agentType = defaultAgentType(next);
      if (vendor) {
        cfg.agentPackage = vendor.package;
        if (vendor.secretEnv) {
          cfg.secretRef = `secret://${next}`;
        }
        if (vendor.runtime === "remote_http") {
          cfg.executionMode = "remote";
        } else if (vendor.id === "local_code") {
          cfg.executionMode = "local";
        }
        for (const vf of vendor.fields) {
          if (vf.defaultValue !== undefined && cfg[vf.key] === undefined) {
            cfg[vf.key] = vf.defaultValue;
          }
        }
      }
    }

    // Keep agentType valid when options change
    if (
      field.key === "agentType" &&
      typeof next === "string" &&
      !agentTypesForVendor(String(cfg.agentVendor)).some((t) => t.value === next)
    ) {
      cfg.agentType = defaultAgentType(String(cfg.agentVendor));
    }

    const isAiNode = node.type === "llm" || node.type === "agent";
    let deferredCode: string | null = null;
    if (isAiNode) {
      const lang = (String(cfg.codeLanguage ?? "python") ||
        "python") as AiCodeLanguage;
      const kind = node.type as AiNodeKind;

      // Typing prose into the code box → treat as intent and generate
      if (
        field.key === "dynamicCode" &&
        typeof next === "string" &&
        looksLikeIntentNotCode(next)
      ) {
        cfg.intentText = next;
        cfg.codeMode = "from_intent";
        cfg.enableDynamicCode = true;
        deferredCode = generateDynamicCode({
          kind,
          language: lang,
          intent: next,
          provider: String(cfg.provider ?? ""),
          model: String(cfg.customModel || cfg.model || ""),
        });
        // Keep typed text until deferred generate applies (avoids select/focus fights)
        cfg.dynamicCode = next;
      }

      // Intent description — defer codegen so dropdowns/inputs aren't remounted mid-event
      if (
        field.key === "intentText" &&
        typeof next === "string" &&
        next.trim().length >= 8
      ) {
        cfg.codeMode = "from_intent";
        cfg.enableDynamicCode = true;
        deferredCode = generateDynamicCode({
          kind,
          language: lang,
          intent: next,
          provider: String(cfg.provider ?? ""),
          model: String(cfg.customModel || cfg.model || ""),
        });
      }

      // Language switch — update language immediately; regenerate code after paint
      if (
        field.key === "codeLanguage" &&
        cfg.codeMode === "from_intent" &&
        String(cfg.intentText ?? "").trim().length >= 8
      ) {
        deferredCode = generateDynamicCode({
          kind,
          language: next as AiCodeLanguage,
          intent: String(cfg.intentText),
          provider: String(cfg.provider ?? ""),
          model: String(cfg.customModel || cfg.model || ""),
        });
      }
    }

    updateNode(node.id, { config: cfg });

    if (deferredCode != null) {
      const code = deferredCode;
      const nodeId = node.id;
      window.setTimeout(() => {
        const latest = useStudioStore
          .getState()
          .document.flow.nodes.find((n) => n.id === nodeId);
        if (!latest) return;
        useStudioStore.getState().updateNode(nodeId, {
          config: { ...(latest.config ?? {}), dynamicCode: code },
        });
      }, 0);
    }
  };

  const llmProvider = getLlmProvider(String(node.config?.provider ?? ""));
  const agentVendor = getAgentVendor(String(node.config?.agentVendor ?? ""));

  const renderField = (field: NodeFieldDef) => {
    const options = resolveFieldOptions(field, node.config);
    const value =
      readFieldValue(field) ??
      field.defaultValue ??
      (field.kind === "checkbox" ? false : "");

    // Keep agentType / model select valid when option lists change
    const selectValue =
      (field.optionsFrom === "llmModels" || field.optionsFrom === "agentTypes") &&
      options.length &&
      !options.some((o) => o.value === String(value))
        ? options[0].value
        : value;

    if (field.kind === "checkbox") {
      return (
        <div key={field.key}>
          <FieldControl
            field={field}
            value={value}
            options={options}
            onChange={(v) => writeFieldValue(field, v)}
          />
          {field.help && (
            <p className="mt-0.5 text-[9px] text-ink-400">{field.help}</p>
          )}
        </div>
      );
    }

    const isUpstreamStage =
      field.kind === "stage" &&
      (field.key === "__inputs" || field.section === "input");

    if (isUpstreamStage) {
      return (
        <div key={field.key}>
          <label className="text-[10px] text-ink-400">
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <StageMultiSelect
            options={upstreamStageOptions}
            selected={parseStageList(readFieldValue(field))}
            onChange={(list) => writeFieldValue(field, list.join(", "))}
            placeholder="No other nodes on the canvas yet — add nodes to select them here"
          />
          {field.help && (
            <p className="mt-0.5 text-[9px] leading-snug text-ink-400">
              {field.help}
            </p>
          )}
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="text-[10px] text-ink-400">
          {field.label}
          {field.required ? " *" : ""}
          {(field.key === "dynamicCode"
            ? String(node.config?.codeLanguage ?? field.language ?? "")
            : field.language) ? (
            <span className="ml-1 font-mono text-[9px] text-ink-500">
              ·{" "}
              {field.key === "dynamicCode"
                ? String(node.config?.codeLanguage ?? field.language)
                : field.language}
            </span>
          ) : null}
        </label>
        <FieldControl
          field={field}
          value={selectValue}
          options={options}
          onChange={(v) => writeFieldValue(field, v)}
        />
        {field.kind === "stage" && upstreamStageOptions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {upstreamStageOptions.slice(0, 10).map((s) => (
              <button
                key={s.value}
                type="button"
                className="rounded bg-navy-800 px-1.5 py-0.5 text-[9px] text-cyan-400 hover:bg-navy-700"
                title={s.value}
                onClick={() => writeFieldValue(field, s.value)}
              >
                {s.nodeLabel}
              </button>
            ))}
          </div>
        )}
        {field.help && (
          <p className="mt-0.5 text-[9px] leading-snug text-ink-400">
            {field.help}
          </p>
        )}
        {(field.key === "intentText" || field.key === "dynamicCode") &&
          (node.type === "llm" || node.type === "agent") &&
          node.config?.enableDynamicCode !== false && (
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-400 hover:border-cyan-500"
              onClick={() => {
                const intent = String(
                  field.key === "intentText"
                    ? selectValue
                    : (node.config?.intentText ??
                        (looksLikeIntentNotCode(String(selectValue))
                          ? selectValue
                          : "")),
                ).trim();
                const source =
                  intent ||
                  String(
                    node.config?.userPrompt ?? node.config?.systemPrompt ?? "",
                  ).trim() ||
                  "Process upstream stages with the configured model and return a useful result";
                const code = generateDynamicCode({
                  kind: node.type as AiNodeKind,
                  language: (String(node.config?.codeLanguage ?? "python") ||
                    "python") as AiCodeLanguage,
                  intent: source,
                  provider: String(node.config?.provider ?? ""),
                  model: String(
                    node.config?.customModel || node.config?.model || "",
                  ),
                });
                updateNode(node.id, {
                  config: {
                    ...(node.config ?? {}),
                    enableDynamicCode: true,
                    codeMode: "from_intent",
                    intentText: source,
                    dynamicCode: code,
                  },
                });
              }}
            >
              <Sparkles className="h-3 w-3" />
              Generate {String(node.config?.codeLanguage ?? "python")} code
            </button>
          )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            {node.category}
          </div>
          <h2 className="text-sm font-semibold text-ink-100">
            {def?.label ?? node.type}
          </h2>
          {schema?.summary && (
            <p className="mt-0.5 text-[10px] leading-snug text-ink-400">
              {schema.summary}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => removeNode(node.id)}
          className="rounded-lg border border-navy-600 p-1.5 text-ink-400 hover:border-danger hover:text-danger"
          title="Delete node"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <NodeVersionCard
        nodeId={node.id}
        nodeType={node.type}
        category={node.category}
        config={node.config}
        schemaKeys={(schema?.fields ?? []).map((f) => f.key)}
      />

      <label className="mt-4 block text-[11px] text-ink-400">Label</label>
      <input
        className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 text-sm outline-none focus:border-cyan-500"
        value={node.label ?? ""}
        onChange={(e) => updateNode(node.id, { label: e.target.value })}
      />

      <div className="mt-2 font-mono text-[10px] text-ink-500">{node.id}</div>

      {needsConnector && (
        <div className="mt-3">
          <label className="text-[10px] text-ink-400">Connector</label>
          <select
            className="mt-0.5 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            value={node.connector ?? ""}
            onChange={(e) =>
              updateNode(node.id, { connector: e.target.value || undefined })
            }
          >
            <option value="">— select —</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? c.id}
                {c.mode ? ` · ${c.mode}` : ""} ({c.id})
              </option>
            ))}
          </select>
          {!connectors.length && (
            <p className="mt-1 text-[9px] text-amber-400">
              Install a matching plugin and save a connector first.
            </p>
          )}
        </div>
      )}

      {schema ? (
        <>
          <SectionBlock
            section="input"
            fields={fieldsBySection("input")}
            renderField={renderField}
          />
          {node.type === "llm" && llmProvider && (
            <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-ink-300">
              <div className="font-semibold text-cyan-400">{llmProvider.name}</div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">
                pip: {llmProvider.package}
                {llmProvider.secretEnv ? ` · env ${llmProvider.secretEnv}` : ""}
              </div>
              <a
                href={llmProvider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-cyan-500 hover:underline"
              >
                LangChain provider docs →
              </a>
              <div className="mt-1 text-[9px] text-ink-400">
                {llmProvider.models.length} models listed · override with Custom
                model id for brand-new releases
              </div>
            </div>
          )}
          {node.type === "agent" && agentVendor && (
            <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-ink-300">
              <div className="font-semibold text-cyan-400">{agentVendor.name}</div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">
                pip: {agentVendor.package}
                {agentVendor.secretEnv ? ` · env ${agentVendor.secretEnv}` : ""}
                {" · "}
                runtime: {agentVendor.runtime}
              </div>
              <a
                href={agentVendor.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-cyan-500 hover:underline"
              >
                Vendor docs →
              </a>
              <div className="mt-1 text-[9px] text-ink-400">
                {agentVendor.agentTypes.length} agent types · remote URL connects
                to product on another host · result written as YAML on run
              </div>
            </div>
          )}
          <SectionBlock
            section="processing"
            fields={fieldsBySection("processing")}
            renderField={renderField}
          />
          <SectionBlock
            section="output"
            fields={fieldsBySection("output")}
            renderField={renderField}
          />
        </>
      ) : (
        <p className="mt-4 text-[11px] text-amber-400">
          No typed schema for <code>{node.type}</code> yet — using legacy config.
        </p>
      )}

      {!schema && (
        <>
          <label className="mt-3 block text-[11px] text-ink-400">
            Inputs (stage keys)
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            value={(node.inputs ?? []).join(", ")}
            onChange={(e) =>
              updateNode(node.id, {
                inputs: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <label className="mt-3 block text-[11px] text-ink-400">
            Outputs (stage cache)
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            value={(node.outputs ?? []).join(", ")}
            onChange={(e) =>
              updateNode(node.id, {
                outputs: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <label className="mt-3 block text-[11px] text-ink-400">
            Config (JSON)
          </label>
          <textarea
            className="mt-1 min-h-[140px] w-full rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-2 font-mono text-[11px] outline-none focus:border-cyan-500"
            value={JSON.stringify(node.config ?? {}, null, 2)}
            onChange={(e) => {
              try {
                const config = JSON.parse(e.target.value) as Record<
                  string,
                  unknown
                >;
                updateNode(node.id, { config });
              } catch {
                /* keep typing */
              }
            }}
          />
        </>
      )}

      {schema && (
        <details className="mt-5 rounded-lg border border-navy-700 bg-navy-950/50">
          <summary className="cursor-pointer px-2.5 py-2 text-[10px] text-ink-400 hover:text-ink-200">
            Advanced · raw config JSON
          </summary>
          <textarea
            className="min-h-[100px] w-full border-t border-navy-700 bg-transparent px-2.5 py-2 font-mono text-[10px] outline-none focus:border-cyan-500"
            value={JSON.stringify(node.config ?? {}, null, 2)}
            onChange={(e) => {
              try {
                const config = JSON.parse(e.target.value) as Record<
                  string,
                  unknown
                >;
                // replace merge: pass all keys; store merge still applies
                updateNode(node.id, { config });
              } catch {
                /* keep typing */
              }
            }}
          />
          <button
            type="button"
            className="m-2 text-[10px] text-cyan-400 hover:underline"
            onClick={() =>
              updateNode(node.id, { config: defaultConfigForType(node.type) })
            }
          >
            Reset to schema defaults
          </button>
        </details>
      )}

      {node.type.startsWith("mongodb") && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="text-[11px] font-semibold text-cyan-400">
            Schema browser
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            Connect &amp; verify to introspect collections. Field picker will
            bind from the MongoDB plugin backend.
          </p>
        </div>
      )}

      <div
        className={clsx(
          "mt-4 rounded-lg border px-2.5 py-2 text-[9px] leading-relaxed text-ink-400",
          "border-navy-700",
        )}
      >
        Changes write into workspace YAML under this node&apos;s{" "}
        <code className="text-cyan-500">config</code>,{" "}
        <code className="text-cyan-500">inputs</code>, and{" "}
        <code className="text-cyan-500">outputs</code>.
      </div>
    </div>
  );
}
