import { useAgentStore } from "@/store/agentStore";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import { useEffect } from "react";

/** Last 5 executions plus the success and failure logs. */
export function RunsTab() {
  const workspaceId = useStudioStore((s) => s.document.workspace.id);
  const executions = useAgentStore((s) => s.executions);
  const replay = useAgentStore((s) => s.replay);
  const logKind = useAgentStore((s) => s.logKind);
  const logQuery = useAgentStore((s) => s.logQuery);
  const logLines = useAgentStore((s) => s.logLines);
  const refresh = useAgentStore((s) => s.refresh);
  const openReplay = useAgentStore((s) => s.openReplay);
  const closeReplay = useAgentStore((s) => s.closeReplay);
  const setLogKind = useAgentStore((s) => s.setLogKind);
  const setLogQuery = useAgentStore((s) => s.setLogQuery);
  const loadLogs = useAgentStore((s) => s.loadLogs);
  const setInspect = useAgentStore((s) => s.setInspect);

  useEffect(() => {
    void refresh(workspaceId);
  }, [workspaceId, refresh]);

  useEffect(() => {
    void loadLogs();
  }, [workspaceId, logKind, logQuery, loadLogs, executions.length]);

  return (
    <div className="space-y-3 font-sans">
      <div>
        <div className="mb-1 text-[11px] font-semibold text-ink-200">Last 5 executions</div>
        {executions.length === 0 && (
          <p className="text-ink-400">No saved executions yet. Run the workspace to record one.</p>
        )}
        <div className="space-y-1">
          {executions.map((ex) => (
            <button
              key={ex.executionId}
              type="button"
              onClick={() => void openReplay(ex.executionId)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left",
                replay?.executionId === ex.executionId
                  ? "border-cyan-500 bg-cyan-500/10"
                  : "border-navy-600 bg-navy-800/50 hover:border-cyan-500/40",
              )}
            >
              <span
                className={clsx(
                  "rounded px-1 text-[9px] font-semibold uppercase",
                  ex.status === "succeeded" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400",
                )}
              >
                {ex.status}
              </span>
              <span className="font-mono text-[10px] text-ink-200">{ex.runId}</span>
              <span className="ml-auto text-[10px] text-ink-400">
                {ex.nodeCount} nodes · {new Date(ex.finishedAt).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {replay && (
        <div className="rounded-lg border border-navy-600 bg-navy-800/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink-100">Replay {replay.executionId}</span>
            <button type="button" className="text-[10px] text-ink-400 hover:text-ink-100" onClick={closeReplay}>
              Back to latest
            </button>
          </div>
          <div className="space-y-1">
            {replay.nodeIo.map((n) => (
              <button
                key={n.nodeId}
                type="button"
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-navy-700"
                onClick={() => setInspect(n.nodeId)}
              >
                <span className="font-mono text-[10px] text-cyan-400">{n.nodeId}</span>
                <span className="text-[10px] text-ink-400">{n.status}</span>
                <span className="ml-auto text-[10px] text-ink-500">Inspect</span>
              </button>
            ))}
          </div>
          {replay.excerpt && (
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-rose-200">
              {replay.excerpt}
            </pre>
          )}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-ink-200">Logs</span>
          {(["success", "failure"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setLogKind(kind)}
              className={clsx("ui-tab", logKind === kind && "ui-tab-active")}
            >
              {kind}
            </button>
          ))}
          <input
            value={logQuery}
            onChange={(e) => setLogQuery(e.target.value)}
            placeholder="Filter lines"
            className="ml-auto w-36 rounded border border-navy-600 bg-navy-950 px-2 py-1 text-[10px]"
          />
        </div>
        {logLines.length === 0 ? (
          <p className="text-ink-400">No {logKind} lines{logQuery ? " match that filter" : ""}.</p>
        ) : (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-200">
            {logLines.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
