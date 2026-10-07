import { useStudioStore } from "@/store/studioStore";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import clsx from "clsx";
import { X } from "lucide-react";

const TONE = {
  ready: "border-[#99f6e4] bg-[#f0fdfa] text-[#0f766e]",
  risky: "border-[#fcd34d] bg-[#fffbeb] text-[#b45309]",
  blocked: "border-[#fecdd3] bg-[#fff1f2] text-[#be123c]",
} as const;

export function openFixChat(seed: string) {
  useChatStore.getState().setOpen(true);
  useAgentStore.getState().setMode("fix");
  useAgentStore.getState().setDraft(seed);
}

/** Shown before dry-run and before a run that is not ready. */
export function FlightCheck() {
  const report = useStudioStore((s) => s.flight);
  const intent = useStudioStore((s) => s.flightIntent);
  const close = useStudioStore((s) => s.closeFlight);
  const applyFix = useStudioStore((s) => s.applyFlightFix);
  const run = useStudioStore((s) => s.executeRun);
  const selectNode = useStudioStore((s) => s.selectNode);
  if (!report) return null;

  return (
    <div className="absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
      <section className="flex max-h-[min(70vh,36rem)] w-[min(100%,40rem)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_20px_50px_rgba(10,31,54,0.18)]">
        <header className="flex items-start justify-between gap-3 bg-[var(--brand-primary)] px-4 py-3 text-white">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#99f6e4]">
              Flight check · {intent === "dry-run" ? "Dry-run" : "Before run"}
            </p>
            <h2 className="mt-1 text-[18px] font-bold leading-snug tracking-[-0.02em]">{report.headline}</h2>
            <p className="mt-1 text-[13px] leading-6 text-white/80">
              {report.willRun
                ? "The flow can start. Review the good-to-have options below."
                : "A mandatory option is empty, so this run is likely to stop."}
            </p>
          </div>
          <button type="button" onClick={close} className="rounded-lg p-1 text-white/80 hover:bg-white/10" aria-label="Close flight check">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {report.challenges.length > 0 && (
            <ul className="space-y-1 text-[13px] leading-6 text-[var(--text-300)]">
              {report.challenges.slice(0, 6).map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          )}
          {report.nodes.map((node) => {
            const missing = node.options.filter((opt) => opt.status === "missing");
            if (!missing.length && node.verdict === "ready") return null;
            return (
              <button
                key={node.nodeId}
                type="button"
                onClick={() => selectNode(node.nodeId)}
                className="block w-full rounded-xl border border-[var(--border)] bg-[var(--bg,#f7fafc)] px-3 py-2 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-[var(--text-100)]">{node.label}</span>
                  <span className={clsx("rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE[node.verdict])}>
                    {node.versionLabel ?? node.verdict}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {missing.map((opt) => (
                    <span
                      key={opt.key}
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        opt.rank === "mandatory" ? "bg-[#fff1f2] text-[#be123c]" : "bg-[#f0fdfa] text-[#0f766e]",
                      )}
                      title={opt.detail}
                    >
                      {opt.rank === "mandatory" ? "Required" : "Good"} · {opt.label}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
          {report.fixes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--muted,#3d4f63)]">
                Suggested fixes
              </p>
              {report.fixes.map((fix) => (
                <div key={fix.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
                  <div>
                    <div className="text-[13px] font-semibold">{fix.title}</div>
                    <div className="text-[12px] leading-5 text-[var(--muted,#3d4f63)]">{fix.detail}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary shrink-0 px-3 py-1.5 text-[12px]"
                    onClick={() => applyFix(fix.nodeId, fix.config)}
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px]"
            onClick={() => {
              openFixChat(
                "Walk this flight check. Tell me which options are mandatory, which are good to have, and what will break if I run now.",
              );
              close();
            }}
          >
            Fix in chat
          </button>
          <button
            type="button"
            className="rounded-[10px] border border-[var(--border)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--brand-primary)]"
            onClick={() => {
              close();
              void run({ skipFlight: true });
            }}
          >
            {report.willRun ? "Run" : "Run anyway"}
          </button>
        </footer>
      </section>
    </div>
  );
}
