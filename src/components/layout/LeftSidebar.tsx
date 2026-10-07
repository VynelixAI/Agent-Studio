import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { ConnectorsPanel } from "@/components/sidebar/ConnectorsPanel";
import { NodePalette } from "@/components/sidebar/NodePalette";
import { PluginsPanel } from "@/components/sidebar/PluginsPanel";
import { TemplatesPanel } from "@/components/sidebar/TemplatesPanel";
import { WorkspacesPanel } from "@/components/sidebar/WorkspacesPanel";
import { usePanelSize } from "@/hooks/usePanelSize";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import { Boxes, Cable, LayoutTemplate, Library, Plug, Sparkles } from "lucide-react";
import { useEffect } from "react";

function TemplatesNavIcon({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
      <LayoutTemplate
        className={active ? "h-3.5 w-3.5 text-cyan-400" : "h-3.5 w-3.5"}
      />
      <Sparkles
        className={
          active
            ? "absolute -right-1 -top-1 h-2 w-2 text-cyan-300 drop-shadow-[0_0_4px_rgba(34,211,238,0.8)]"
            : "absolute -right-1 -top-1 h-2 w-2 text-ink-500"
        }
      />
    </span>
  );
}

export function LeftSidebar() {
  const leftTab = useStudioStore((s) => s.leftTab);
  const setLeftTab = useStudioStore((s) => s.setLeftTab);
  const { size: width, setSize, handleProps } = usePanelSize({
    storageKey: "as.layout.leftWidth",
    defaultSize: 280,
    min: 200,
    max: 560,
    axis: "x",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setLeftTab("templates");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setLeftTab]);

  // Nudge wider when opening Plug / Conn / Templates if still at a narrow default.
  useEffect(() => {
    const needsWide =
      leftTab === "plugins" ||
      leftTab === "connectors" ||
      leftTab === "templates";
    if (needsWide && width < 300) setSize(320);
  }, [leftTab]); // eslint-disable-line react-hooks/exhaustive-deps -- only on tab change

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-navy-700 bg-navy-900 dark:bg-navy-900/80"
      style={{ width }}
    >
      <ResizeHandle axis="x" edge="right" {...handleProps} />
      <div className="flex h-11 shrink-0 items-stretch border-b border-navy-700">
        {(
          [
            ["workspaces", "icon", "WS", Library] as const,
            ["palette", "icon", "Nodes", Boxes] as const,
            ["plugins", "icon", "Plug", Plug] as const,
            ["connectors", "icon", "Conn", Cable] as const,
            ["templates", "templates", "Tpl", null] as const,
          ] as const
        ).map(([id, kind, label, Icon]) => (
          <button
            key={id}
            type="button"
            title={id === "templates" ? "Templates" : label}
            onClick={() => setLeftTab(id)}
            className={clsx(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition sm:text-[11px]",
              leftTab === id
                ? "border-b-2 border-cyan-500 bg-cyan-500/10 text-cyan-600 shadow-[inset_0_-1px_12px_rgba(34,211,238,0.16)] dark:text-cyan-300"
                : "border-b-2 border-transparent text-ink-400 hover:bg-navy-800 hover:text-ink-100",
            )}
          >
            {kind === "templates" || !Icon ? (
              <TemplatesNavIcon active={leftTab === id} />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {leftTab === "workspaces" && <WorkspacesPanel />}
        {leftTab === "palette" && <NodePalette />}
        {leftTab === "plugins" && <PluginsPanel />}
        {leftTab === "connectors" && <ConnectorsPanel />}
        {leftTab === "templates" && <TemplatesPanel />}
      </div>
    </aside>
  );
}
