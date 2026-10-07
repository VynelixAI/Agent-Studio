import {
  customRecordsToTemplates,
  deleteCustomTemplate,
} from "@/core/customTemplateLibrary";
import {
  DOMAIN_LABELS,
  STANDARD_TEMPLATE_COUNT,
  getStandardTemplates,
} from "@/core/standardTemplates";
import { TEMPLATES as FEATURED } from "@/core/templates";
import type { StudioTemplate, TemplateDomain } from "@/core/templateTypes";
import {
  PERSONA_LABELS,
  personaFor,
  whatItDoes,
  type TemplatePersona,
} from "@/core/templatePersonas";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import {
  LayoutTemplate,
  Play,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Tab = "standard" | "custom" | "featured";

export function TemplatesPanel() {
  const loadTemplate = useStudioStore((s) => s.loadTemplate);
  const templatesSubTab = useStudioStore((s) => s.templatesSubTab);
  const setTemplatesSubTab = useStudioStore((s) => s.setTemplatesSubTab);
  const pushLog = useStudioStore((s) => s.pushLog);

  const [q, setQ] = useState("");
  const [domain, setDomain] = useState<string>("all");
  const [persona, setPersona] = useState<TemplatePersona | "all">("all");
  const [favOnly, setFavOnly] = useState(false);
  const [favs, setFavs] = useState<string[]>(() => readList("vynelix-template-favorites"));
  const [ratings, setRatings] = useState<Record<string, number>>(() => readMap("vynelix-template-ratings"));
  const [customTick, setCustomTick] = useState(0);

  const tab = templatesSubTab as Tab;

  useEffect(() => {
    if (templatesSubTab === "custom") {
      setCustomTick((n) => n + 1);
    }
  }, [templatesSubTab]);

  const standard = useMemo(() => getStandardTemplates(), []);
  const custom = useMemo(() => {
    void customTick;
    return customRecordsToTemplates();
  }, [customTick]);

  const list: StudioTemplate[] = useMemo(() => {
    if (tab === "custom") return custom;
    if (tab === "featured") {
      return FEATURED.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        domain: "de" as TemplateDomain,
        products: [],
        origin: "standard" as const,
        nodeCount: 0,
        tags: ["featured"],
        create: f.factory,
      }));
    }
    return standard;
  }, [tab, custom, standard]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((t) => {
      if (domain !== "all" && t.domain !== domain) return false;
      if (persona !== "all" && personaFor(t) !== persona) return false;
      if (favOnly && !favs.includes(t.id)) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        t.products.some((p) => p.toLowerCase().includes(needle)) ||
        (t.tags ?? []).some((x) => x.toLowerCase().includes(needle)) ||
        (t.industry ?? "").toLowerCase().includes(needle)
      );
    });
  }, [list, q, domain, persona, favOnly, favs]);

  const useAsWorkflow = (t: StudioTemplate) => {
    loadTemplate(t.id);
    useAgentStore.getState().noteTemplate(t.name, whatItDoes(t));
    useChatStore.getState().setOpen(true);
    useAgentStore.getState().setMode("brain");
  };

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    writeJson("vynelix-template-favorites", next);
  };

  const rate = (id: string, score: number) => {
    const next = { ...ratings, [id]: score };
    setRatings(next);
    writeJson("vynelix-template-ratings", next);
  };

  const onDeleteCustom = (t: StudioTemplate) => {
    const ok = window.confirm(
      `Delete custom template “${t.name}”?\n\nThis only removes it from your Custom library (local).`,
    );
    if (!ok) return;
    deleteCustomTemplate(t.id);
    setCustomTick((n) => n + 1);
    pushLog({
      level: "info",
      message: `Deleted custom template “${t.name}”`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy-700 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink-100">
          <span className="relative inline-flex h-5 w-5 items-center justify-center">
            <LayoutTemplate className="h-3.5 w-3.5 text-cyan-400" />
            <Sparkles className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 text-cyan-300" />
          </span>
          Templates
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
          Pick a template → <span className="text-cyan-400">Use this template</span>{" "}
          to load it on the canvas and open the Workspace Brain. Save your own patterns from{" "}
          <span className="text-ink-300">WS → Convert to template</span>.
        </p>

        <div className="mt-2 flex gap-1">
          {(
            [
              ["standard", `Standard (${STANDARD_TEMPLATE_COUNT})`],
              ["featured", "Featured"],
              ["custom", `Custom (${custom.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTemplatesSubTab(id)}
              className={clsx(
                "ui-tab flex-1",
                tab === id && "ui-tab-active",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, domains…"
            className="w-full rounded-lg border border-navy-600 bg-navy-950 py-1.5 pl-7 pr-2 text-[11px] outline-none focus:border-cyan-500"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setPersona("all")}
            className={clsx("ui-tab", persona === "all" && "ui-tab-active")}
          >
            All roles
          </button>
          {(Object.keys(PERSONA_LABELS) as TemplatePersona[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPersona(id)}
              className={clsx("ui-tab", persona === id && "ui-tab-active")}
            >
              {PERSONA_LABELS[id]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            className={clsx("ui-tab", favOnly && "ui-tab-active")}
          >
            Favorites
          </button>
        </div>
        {tab === "standard" && (
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px] outline-none focus:border-cyan-500"
          >
            <option value="all">All domains</option>
            {Object.entries(DOMAIN_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {tab === "custom" && !custom.length && (
          <p className="py-6 text-center text-[11px] text-ink-400">
            No custom templates yet. On the{" "}
            <span className="text-cyan-400">WS</span> tab, use{" "}
            <span className="text-ink-200">Convert workflow to template</span>{" "}
            under New workspace.
          </p>
        )}
        {filtered.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-navy-600 bg-navy-800/70 p-3 transition hover:border-cyan-500/50"
          >
            <div className="flex items-start gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <LayoutTemplate className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-ink-100">
                  {t.name}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-ink-300">
                  <span className="text-ink-500">What this does. </span>
                  {whatItDoes(t)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="rounded bg-navy-700 px-1 text-[8px] uppercase text-cyan-300">
                    {PERSONA_LABELS[personaFor(t)]}
                  </span>
                  <span className="rounded bg-navy-700 px-1 text-[8px] uppercase text-ink-300">
                    {DOMAIN_LABELS[t.domain] ?? t.domain}
                  </span>
                  {t.nodeCount > 0 && (
                    <span className="rounded bg-navy-700 px-1 text-[8px] text-ink-400">
                      {t.nodeCount} nodes
                    </span>
                  )}
                  {t.products.slice(0, 4).map((p) => (
                    <span
                      key={p}
                      className="rounded bg-cyan-500/10 px-1 text-[8px] text-cyan-400"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                title={favs.includes(t.id) ? "Unfavorite" : "Favorite"}
                onClick={() => toggleFav(t.id)}
                className={clsx(
                  "rounded p-1",
                  favs.includes(t.id) ? "text-amber-300" : "text-ink-500 hover:text-ink-200",
                )}
              >
                <Star className="h-3.5 w-3.5" fill={favs.includes(t.id) ? "currentColor" : "none"} />
              </button>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  title={`Rate ${score}`}
                  onClick={() => rate(t.id, score)}
                  className={clsx(
                    "text-[10px]",
                    (ratings[t.id] ?? 0) >= score ? "text-amber-300" : "text-ink-600",
                  )}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => useAsWorkflow(t)}
                className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-[10px]"
                title="Create this workflow on the canvas and open the Workspace Brain"
              >
                <Play className="h-3 w-3" />
                Use this template
              </button>
              {t.origin === "custom" && (
                <button
                  type="button"
                  onClick={() => onDeleteCustom(t)}
                  className="inline-flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1.5 text-[10px] text-ink-400 hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
                  title="Delete from Custom library"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {!filtered.length && tab !== "custom" && (
          <p className="py-6 text-center text-[11px] text-ink-400">
            No templates match.
          </p>
        )}
      </div>
    </div>
  );
}

function readList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readMap(key: string): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
