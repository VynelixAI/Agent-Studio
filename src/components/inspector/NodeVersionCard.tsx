import { defaultAgentType, getAgentVendor } from "@/core/agentVendors";
import {
  defaultModelForProvider,
  getLlmProvider,
  LLM_PROVIDER_SCOPED_KEYS,
} from "@/core/llmProviders";
import {
  PERSONA_LABEL,
  applyProductVersion,
  productForNodeType,
  type ProductPersona,
  type VersionOption,
} from "@/core/productVersions";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";

const CATEGORY_PERSONA: Record<string, ProductPersona> = {
  data: "data-eng",
  ai: "ai-eng",
  trigger: "devops",
  control: "devops",
  logic: "devops",
  communication: "system-eng",
};

function finishConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  if (typeof next.provider === "string" && next.provider) {
    const prov = getLlmProvider(next.provider);
    if (!next.model) next.model = defaultModelForProvider(next.provider);
    if (prov) {
      const keep = new Set(prov.fields.map((field) => field.key));
      if (typeof next.baseUrl === "string" && next.baseUrl) keep.add("baseUrl");
      for (const key of LLM_PROVIDER_SCOPED_KEYS) {
        if (!keep.has(key)) delete next[key];
      }
      next.langchainPackage = prov.package;
      next.secretRef = prov.secretEnv ? `secret://${next.provider}` : "";
      for (const field of prov.fields) {
        if (field.defaultValue !== undefined && next[field.key] === undefined) {
          next[field.key] = field.defaultValue;
        }
      }
    }
  }
  if (typeof next.agentVendor === "string" && next.agentVendor) {
    const vendor = getAgentVendor(next.agentVendor);
    next.agentType = defaultAgentType(next.agentVendor);
    if (vendor) {
      next.agentPackage = vendor.package;
      if (vendor.secretEnv) next.secretRef = `secret://${next.agentVendor}`;
      if (vendor.runtime === "remote_http") next.executionMode = "remote";
      else if (vendor.id === "local_code") next.executionMode = "local";
      for (const field of vendor.fields) {
        if (field.defaultValue !== undefined && next[field.key] === undefined) {
          next[field.key] = field.defaultValue;
        }
      }
    }
  }
  return next;
}

/** Version choice for the selected node. Same idea as first-run setup: pick a line, options fill in. */
export function NodeVersionCard({
  nodeId,
  nodeType,
  category,
  config,
  schemaKeys,
}: {
  nodeId: string;
  nodeType: string;
  category: string;
  config: Record<string, unknown> | undefined;
  schemaKeys: string[];
}) {
  const updateNode = useStudioStore((s) => s.updateNode);
  const product = productForNodeType(nodeType);

  const choose = (versionId: string) => {
    if (!product) return;
    updateNode(nodeId, {
      config: finishConfig(applyProductVersion(config, product, versionId)),
    });
  };

  const setOption = (opt: VersionOption, value: string) => {
    updateNode(nodeId, {
      config: { ...(config ?? {}), [opt.key]: value },
    });
  };

  if (!product) {
    const persona = CATEGORY_PERSONA[category] ?? "data-eng";
    return (
      <section className="mt-4 rounded-xl border border-navy-600 bg-navy-950/60 p-3">
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-300">
          {PERSONA_LABEL[persona]}
        </span>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
          This step has one standard set of options. They are saved on the node and open here whenever you select it.
        </p>
      </section>
    );
  }

  const selected = String(config?.productVersion ?? "");
  const version = product.versions.find((v) => v.id === selected);
  const schemaKeySet = new Set(schemaKeys);
  const extraOptions = (version?.options ?? []).filter((opt) => !schemaKeySet.has(opt.key));

  return (
    <section className="mt-4 rounded-xl border border-navy-600 bg-navy-950/60 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-300">
          {PERSONA_LABEL[product.persona]}
        </span>
        <span className="text-[12px] font-semibold text-ink-100">{product.name}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{product.blurb}</p>
      <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-ink-500">
        Product version
      </p>
      <div className="mt-1.5 grid grid-cols-1 gap-1.5">
        {product.versions.map((v) => {
          const active = v.id === selected;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => choose(v.id)}
              className={clsx(
                "rounded-lg border px-2.5 py-2 text-left transition",
                active
                  ? "border-cyan-500/70 bg-cyan-500/10"
                  : "border-navy-600 hover:border-navy-500",
              )}
            >
              <div className={clsx("text-[11px] font-medium", active ? "text-cyan-200" : "text-ink-200")}>
                {v.label}
              </div>
              <div className="text-[10px] text-ink-500">{v.hint}</div>
            </button>
          );
        })}
      </div>
      {!version && (
        <p className="mt-2 text-[10px] text-ink-400">
          Choose a version. The options for that version are filled in and saved on this node.
        </p>
      )}
      {version && extraOptions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
            Options for {version.label}
          </p>
          {extraOptions.map((opt) => (
            <label key={opt.key} className="block">
              <span className="text-[10px] text-ink-400">{opt.label}</span>
              {opt.kind === "select" ? (
                <select
                  value={String(config?.[opt.key] ?? opt.defaultValue ?? "")}
                  onChange={(e) => setOption(opt, e.target.value)}
                  className="mt-1 w-full rounded-md border border-navy-600 bg-navy-900 px-2 py-1.5 text-[12px] outline-none focus:border-cyan-500"
                >
                  {(opt.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={opt.kind === "password" ? "password" : "text"}
                  value={String(config?.[opt.key] ?? "")}
                  placeholder={opt.placeholder}
                  onChange={(e) => setOption(opt, e.target.value)}
                  className="mt-1 w-full rounded-md border border-navy-600 bg-navy-900 px-2 py-1.5 text-[12px] outline-none focus:border-cyan-500"
                />
              )}
              {opt.help && <span className="mt-0.5 block text-[9px] text-ink-500">{opt.help}</span>}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
