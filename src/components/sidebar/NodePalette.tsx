import { CATEGORY_META, nodesByCategory } from "@/core/nodeRegistry";
import {
  PLUGINS_CHANGED_EVENT,
  readInstalledPluginIds,
} from "@/core/pluginInstall";
import { useStudioStore } from "@/store/studioStore";
import type { NodeCategory } from "@/types/workspace";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function NodePalette() {
  const [q, setQ] = useState("");
  const [installed, setInstalled] = useState(readInstalledPluginIds);
  const addNode = useStudioStore((s) => s.addNode);
  const nodeCount = useStudioStore((s) => s.document.flow.nodes.length);

  useEffect(() => {
    const sync = () => setInstalled(readInstalledPluginIds());
    window.addEventListener(PLUGINS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PLUGINS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const byCat = useMemo(() => nodesByCategory(installed), [installed]);
  const categories = (Object.keys(CATEGORY_META) as NodeCategory[]).sort(
    (a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order,
  );

  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("application/vynelix-node", type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-3 pb-2 pt-3">
        <Search className="pointer-events-none absolute left-5 top-[1.35rem] h-3.5 w-3.5 text-ink-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter nodes…"
          className="w-full rounded-lg border border-navy-600 bg-navy-900 py-2 pl-8 pr-3 text-xs text-ink-100 outline-none placeholder:text-ink-400 focus:border-cyan-500"
        />
        <p className="mt-1.5 text-[9px] leading-snug text-ink-400">
          Core nodes always available. DE/DB/workflow nodes appear after you
          install plugins ({installed.length} installed).
        </p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {categories.map((cat) => {
          const nodes = byCat[cat].filter(
            (n) =>
              !q ||
              n.label.toLowerCase().includes(q.toLowerCase()) ||
              n.type.toLowerCase().includes(q.toLowerCase()) ||
              (n.pluginId ?? "").toLowerCase().includes(q.toLowerCase()),
          );
          if (!nodes.length) return null;
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat} className="animate-fade-in">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: meta.accent }}
                />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                  {meta.label}
                </h3>
              </div>
              <div className="space-y-1">
                {nodes.map((n) => (
                  <div
                    key={n.type}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => onDragStart(e, n.type)}
                    onClick={() =>
                      addNode(n.type, {
                        x: 140 + (nodeCount % 4) * 36,
                        y: 80 + (nodeCount % 3) * 28,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      addNode(n.type, {
                        x: 140 + (nodeCount % 4) * 36,
                        y: 80 + (nodeCount % 3) * 28,
                      });
                    }}
                    className="cursor-grab rounded-lg border border-navy-600/80 bg-navy-800/60 px-2.5 py-2 transition hover:border-cyan-500/50 hover:bg-navy-700/80 active:cursor-grabbing"
                    title={n.description}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="text-xs font-medium text-ink-100">
                        {n.label}
                      </div>
                      {n.pluginId && (
                        <span className="rounded bg-navy-700 px-1 text-[8px] uppercase text-cyan-500">
                          {n.pluginId}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[10px] text-ink-400">
                      {n.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
