import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getNodeDef } from "@/core/nodeRegistry";
import type { NodeMemory } from "@/store/agentStore";
import { useAgentStore } from "@/store/agentStore";
import clsx from "clsx";
import { useState } from "react";

export type StudioFlowNodeData = {
  label: string;
  type: string;
  category: string;
  selected?: boolean;
  memory?: NodeMemory;
};

const STATUS_LABEL: Record<string, string> = {
  success: "success",
  failed: "failed",
  running: "running",
  skipped: "skipped",
};

function previewText(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function StudioFlowNode({ id, data, selected }: NodeProps) {
  const d = data as StudioFlowNodeData;
  const def = getNodeDef(d.type);
  const accent = def?.color ?? "var(--brand-accent)";
  const isIf = d.type === "if";
  const mem = d.memory;
  const [open, setOpen] = useState(false);
  const setInspect = useAgentStore((s) => s.setInspect);
  const out = previewText(mem?.output);
  const inn = previewText(mem?.input);

  return (
    <div
      className={clsx(
        "relative min-w-[180px] max-w-[240px] rounded-xl border bg-navy-800/95 px-3 py-2.5 shadow-lg backdrop-blur",
        selected ? "border-cyan-500" : "border-navy-600",
        mem?.status === "failed" && "border-rose-500/70",
        mem?.status === "success" && "border-emerald-500/50",
      )}
      style={{
        boxShadow: selected
          ? `0 0 0 1px ${accent}, 0 0 20px ${accent}33`
          : "var(--node-shadow)",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-navy-900 !bg-cyan-500"
        title="Input"
      />
      <span className="pointer-events-none absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 pr-1 text-[8px] uppercase tracking-wide text-ink-500">
        in
      </span>
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
        />
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-ink-400">
          {def?.label ?? d.category}
        </span>
        {mem && (
          <span
            className={clsx(
              "ml-auto rounded px-1 py-0.5 text-[8px] font-semibold uppercase",
              mem.status === "success" && "bg-emerald-500/15 text-emerald-400",
              mem.status === "failed" && "bg-rose-500/15 text-rose-400",
              mem.status === "running" && "bg-cyan-500/15 text-cyan-300",
              mem.status === "skipped" && "bg-navy-700 text-ink-400",
            )}
          >
            {STATUS_LABEL[mem.status] ?? mem.status}
          </span>
        )}
      </div>
      <div className="truncate text-sm font-semibold text-ink-100">{d.label}</div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-ink-400">{d.type}</div>
      {mem && (
        <div className="mt-1.5">
          {(out || inn) && (
            <>
              <button
                type="button"
                className="text-[9px] text-cyan-400 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((v) => !v);
                }}
              >
                {open ? "Hide last I/O" : "Last input / output"}
              </button>
              {open && (
                <div className="mt-1 space-y-1 text-[9px] leading-snug text-ink-300">
                  {inn && (
                    <div>
                      <span className="text-ink-500">in </span>
                      {inn}
                    </div>
                  )}
                  {out && (
                    <div>
                      <span className="text-ink-500">out </span>
                      {out}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className="mt-1 block text-[9px] font-medium text-ink-200 hover:text-cyan-300"
            onClick={(e) => {
              e.stopPropagation();
              setInspect(id);
            }}
          >
            Inspect
          </button>
        </div>
      )}
      {isIf ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "35%" }}
            className="!h-2.5 !w-2.5 !border-navy-900 !bg-emerald-400"
            title="true"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "70%" }}
            className="!h-2.5 !w-2.5 !border-navy-900 !bg-rose-400"
            title="false"
          />
          <div className="pointer-events-none absolute -right-1 top-[28%] translate-x-full text-[8px] text-emerald-400/90">
            true
          </div>
          <div className="pointer-events-none absolute -right-1 top-[63%] translate-x-full text-[8px] text-rose-400/90">
            false
          </div>
        </>
      ) : (
        <>
          <Handle
            type="source"
            position={Position.Right}
            className="!h-2.5 !w-2.5 !border-navy-900 !bg-cyan-500"
            title="Output"
          />
          <span className="pointer-events-none absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full pl-1 text-[8px] uppercase tracking-wide text-ink-500">
            out
          </span>
        </>
      )}
    </div>
  );
}
