import type { NodeMemory } from "@/store/agentStore";
import { useAgentStore } from "@/store/agentStore";
import { Copy, X } from "lucide-react";
import { useState } from "react";

function pretty(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function NodeInspectModal() {
  const nodeId = useAgentStore((s) => s.inspectNodeId);
  const memory = useAgentStore((s) => (nodeId ? s.memory[nodeId] : undefined));
  const replay = useAgentStore((s) => s.replay);
  const setInspect = useAgentStore((s) => s.setInspect);
  const [copied, setCopied] = useState<"input" | "output" | null>(null);
  if (!nodeId) return null;
  const entry: NodeMemory =
    memory ??
    replay?.nodeIo.find((n) => n.nodeId === nodeId) ?? {
      nodeId,
      status: "skipped",
      updatedAt: "",
    };

  const copy = async (which: "input" | "output") => {
    await navigator.clipboard.writeText(pretty(entry[which]));
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${entry.label ?? nodeId}`}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-navy-600 bg-navy-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-navy-700 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-ink-100">
              {entry.label ?? nodeId}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-400">
              {entry.nodeType ?? "node"} · {entry.status}
              {entry.updatedAt ? ` · ${entry.updatedAt}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
            onClick={() => setInspect(null)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 md:grid-cols-2">
          {(["input", "output"] as const).map((which) => (
            <section key={which} className="flex min-h-0 flex-col">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                  {which}
                </h3>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:underline"
                  onClick={() => void copy(which)}
                >
                  <Copy className="h-3 w-3" />
                  {copied === which ? "Copied" : "Copy JSON"}
                </button>
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-navy-700 bg-navy-950 p-3 text-[11px] leading-relaxed text-ink-100">
                {pretty(entry[which])}
              </pre>
            </section>
          ))}
        </div>
        {entry.error && (
          <p className="border-t border-navy-700 px-4 py-2 text-[11px] text-rose-300">
            {entry.error}
          </p>
        )}
      </div>
    </div>
  );
}
