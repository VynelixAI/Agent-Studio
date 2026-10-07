import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useStudioStore } from "@/store/studioStore";
import { useEffect, useState } from "react";

const keyFor = (id: string) => `vynelix-onboard:${id}`;

/** Empty workspaces start with a question instead of a blank canvas. */
export function CanvasOnboarding() {
  const workspaceId = useStudioStore((s) => s.document.workspace.id);
  const nodeCount = useStudioStore((s) => s.document.flow.nodes.length);
  const [dismissed, setDismissed] = useState(true);
  const [goal, setGoal] = useState("");
  const sendBrain = useAgentStore((s) => s.sendBrain);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(keyFor(workspaceId)) === "1");
    } catch {
      setDismissed(false);
    }
    setGoal("");
  }, [workspaceId]);

  if (nodeCount > 0 || dismissed) return null;

  const showCanvas = () => {
    try {
      localStorage.setItem(keyFor(workspaceId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const talk = () => {
    useChatStore.getState().setOpen(true);
    useAgentStore.getState().setMode("brain");
    const text = goal.trim();
    if (text) void sendBrain(text);
    showCanvas();
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-navy-950/80 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-navy-600 bg-navy-900 p-5 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400">
          New workspace
        </p>
        <h2 className="mt-1 text-lg font-semibold text-ink-100">
          What do you want this agent to do?
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
          Describe the job in plain language. The Workspace Brain will suggest nodes.
          You can switch to the canvas whenever you want.
        </p>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          placeholder="Ingest orders from Postgres every hour, clean them, and load a warehouse table."
          className="mt-3 w-full resize-none rounded-lg border border-navy-600 bg-navy-950 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-cyan-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-3 py-2 text-[12px]" onClick={talk}>
            Talk to me
          </button>
          <button
            type="button"
            className="rounded-lg border border-navy-600 px-3 py-2 text-[12px] text-ink-200 hover:border-cyan-500"
            onClick={showCanvas}
          >
            Show me the canvas
          </button>
        </div>
      </div>
    </div>
  );
}
