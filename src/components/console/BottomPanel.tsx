import { RunsTab } from "@/components/console/RunsTab";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { usePanelSize } from "@/hooks/usePanelSize";
import { useAgentStore } from "@/store/agentStore";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import { AlertTriangle, Database, FileCode2, History, Terminal } from "lucide-react";

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function BottomPanel() {
  const bottomOpen = useStudioStore((s) => s.bottomOpen);
  const bottomTab = useStudioStore((s) => s.bottomTab);
  const setBottomTab = useStudioStore((s) => s.setBottomTab);
  const setBottomOpen = useStudioStore((s) => s.setBottomOpen);
  const logs = useStudioStore((s) => s.logs);
  const issues = useStudioStore((s) => s.issues);
  const stages = useStudioStore((s) => s.stages);
  const runOutputs = useStudioStore((s) => s.runOutputs);
  const selectNode = useStudioStore((s) => s.selectNode);
  const clearLogs = useStudioStore((s) => s.clearLogs);
  const executionCount = useAgentStore((s) => s.executions.length);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const { size: height, handleProps } = usePanelSize({
    storageKey: "as.layout.bottomHeight",
    defaultSize: 220,
    min: 120,
    max: 720,
    axis: "y",
    invert: true, // drag handle on top: drag up → taller
  });

  if (!bottomOpen) {
    return (
      <button
        type="button"
        onClick={() => setBottomOpen(true)}
        className="flex h-8 items-center border-t border-navy-700 bg-navy-900 px-3 text-[11px] text-ink-400 hover:text-cyan-400"
      >
        Console · {errorCount} errors · {warnCount} warnings ·{" "}
        {stages.length} stages · {runOutputs.length} outputs
      </button>
    );
  }

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-navy-700 bg-navy-900"
      style={{ height }}
    >
      <ResizeHandle axis="y" edge="top" {...handleProps} />
      <div className="flex items-center gap-1 border-b border-navy-700 px-2">
        {(
          [
            ["console", "Console", Terminal],
            ["errors", "Errors", AlertTriangle],
            ["stage", "Stage Cache", Database],
            ["outputs", "Outputs", FileCode2],
            ["runs", "Runs", History],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setBottomTab(id)}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-medium transition",
              bottomTab === id
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-ink-400 hover:text-ink-100",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === "errors" && errorCount > 0 && (
              <span className="rounded-full bg-danger/20 px-1.5 text-[10px] text-danger">
                {errorCount}
              </span>
            )}
            {id === "errors" && errorCount === 0 && warnCount > 0 && (
              <span className="rounded-full bg-warn/20 px-1.5 text-[10px] text-warn">
                {warnCount}
              </span>
            )}
            {id === "runs" && executionCount > 0 && (
              <span className="rounded-full bg-cyan-500/20 px-1.5 text-[10px] text-cyan-400">
                {executionCount}
              </span>
            )}
            {id === "outputs" && runOutputs.length > 0 && (
              <span className="rounded-full bg-cyan-500/20 px-1.5 text-[10px] text-cyan-400">
                {runOutputs.length}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {bottomTab === "console" && (
            <button
              type="button"
              onClick={() => clearLogs()}
              className="text-[11px] text-ink-400 hover:text-ink-100"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setBottomOpen(false)}
            className="text-[11px] text-ink-400 hover:text-ink-100"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px]">
        {bottomTab === "console" &&
          (logs.length === 0 ? (
            <p className="text-ink-400">No logs yet. Run a dry-run to populate.</p>
          ) : (
            <div className="space-y-1">
              {logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-ink-400">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span
                    className={clsx(
                      "shrink-0 uppercase",
                      l.level === "error" && "text-danger",
                      l.level === "warn" && "text-warn",
                      l.level === "info" && "text-cyan-400",
                      l.level === "debug" && "text-ink-400",
                    )}
                  >
                    {l.level}
                  </span>
                  {l.nodeId && (
                    <button
                      type="button"
                      className="shrink-0 text-cyan-500 hover:underline"
                      onClick={() => selectNode(l.nodeId ?? null)}
                    >
                      [{l.nodeId}]
                    </button>
                  )}
                  <span className="text-ink-100">{l.message}</span>
                </div>
              ))}
            </div>
          ))}

        {bottomTab === "errors" &&
          (issues.length === 0 ? (
            <p className="text-ok">No validation issues.</p>
          ) : (
            <div className="space-y-2">
              {issues.map((i) => (
                <div
                  key={i.id}
                  className="rounded-lg border border-navy-600 bg-navy-800/50 px-3 py-2"
                >
                  <div className="flex gap-2">
                    <span
                      className={
                        i.severity === "error" ? "text-danger" : "text-warn"
                      }
                    >
                      {i.severity}
                    </span>
                    {i.nodeId && (
                      <button
                        type="button"
                        className="text-cyan-500 hover:underline"
                        onClick={() => selectNode(i.nodeId ?? null)}
                      >
                        {i.nodeId}
                      </button>
                    )}
                    <span className="text-ink-100">{i.message}</span>
                  </div>
                  {i.suggestion && (
                    <div className="mt-1 text-ink-400">→ {i.suggestion}</div>
                  )}
                </div>
              ))}
            </div>
          ))}

        {bottomTab === "stage" &&
          (stages.length === 0 ? (
            <p className="text-ink-400">
              Stage cache empty. Dry-run writes simulated datasets here for handover
              preview.
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {stages.map((s) => (
                <div
                  key={s.key}
                  className="rounded-lg border border-navy-600 bg-navy-800/50 p-2"
                >
                  <div className="flex justify-between text-cyan-400">
                    <span>{s.key}</span>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => selectNode(s.nodeId)}
                    >
                      {s.nodeId}
                    </button>
                  </div>
                  <pre className="mt-1 max-h-24 overflow-auto text-ink-300">
                    {JSON.stringify(s.preview, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ))}

        {bottomTab === "runs" && <RunsTab />}

        {bottomTab === "outputs" &&
          (runOutputs.length === 0 ? (
            <p className="text-ink-400">
              No run outputs yet. After Run succeeds, YAML/JSON appears here from{" "}
              <span className="text-cyan-400">outputs/&lt;nodeId&gt;.yaml</span>.
            </p>
          ) : (
            <div className="space-y-3">
              {runOutputs.map((f) => (
                <div
                  key={f.path}
                  className="rounded-lg border border-navy-600 bg-navy-800/50 p-2"
                >
                  <div className="mb-1 truncate text-cyan-400" title={f.path}>
                    {basename(f.path)}
                    <span className="ml-2 font-sans text-[9px] text-ink-400">
                      {f.path}
                    </span>
                  </div>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-ink-200">
                    {f.content}
                  </pre>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
