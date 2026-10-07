import { BRAIN_PROVIDER_OPTIONS } from "@/core/brainProviders";
import { assessFlow, formatFlightBrief } from "@/core/flowReadiness";
import { api } from "@/lib/api";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import { MessageSquarePlus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ProviderOpt = { id: string; label: string; baseUrl: string; model: string; needsKey: boolean };

export function ChatPanel() {
  const open = useChatStore((s) => s.open);
  const canvasMessages = useChatStore((s) => s.messages);
  const canvasSending = useChatStore((s) => s.sending);
  const canvasError = useChatStore((s) => s.error);
  const canvasDraft = useChatStore((s) => s.draft);
  const setCanvasDraft = useChatStore((s) => s.setDraft);
  const sendCanvas = useChatStore((s) => s.send);
  const setOpen = useChatStore((s) => s.setOpen);
  const newSession = useChatStore((s) => s.newSession);

  const mode = useAgentStore((s) => s.mode);
  const setMode = useAgentStore((s) => s.setMode);
  const turns = useAgentStore((s) => s.turns);
  const brain = useAgentStore((s) => s.brain);
  const setBrainField = useAgentStore((s) => s.setBrainField);
  const apiKeyDraft = useAgentStore((s) => s.apiKeyDraft);
  const setApiKeyDraft = useAgentStore((s) => s.setApiKeyDraft);
  const saveBrain = useAgentStore((s) => s.saveBrain);
  const draft = useAgentStore((s) => s.draft);
  const setDraft = useAgentStore((s) => s.setDraft);
  const sendBrain = useAgentStore((s) => s.sendBrain);
  const sending = useAgentStore((s) => s.sending);
  const error = useAgentStore((s) => s.error);
  const hint = useAgentStore((s) => s.hint);
  const workspaceId = useStudioStore((s) => s.document.workspace.id);
  const refresh = useAgentStore((s) => s.refresh);

  const [providers, setProviders] = useState<ProviderOpt[]>([...BRAIN_PROVIDER_OPTIONS]);
  const [showConfig, setShowConfig] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refresh(workspaceId);
    void api.listBrainProviders().then((r) => setProviders(r.items)).catch(() => undefined);
  }, [open, workspaceId, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, canvasMessages.length, sending, canvasSending]);

  if (!open) return null;

  const brainMode = mode === "brain";
  const modelChat = mode === "brain" || mode === "fix";

  return (
    <aside
      className={clsx(
        "absolute bottom-0 right-0 top-14 z-40 flex flex-col border-l border-navy-700 bg-navy-900 shadow-2xl",
        mode === "fix" ? "w-[min(100%,36rem)]" : "w-[min(100%,24rem)]",
      )}
    >
      <header className="shrink-0 border-b border-navy-700 px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em] text-ink-100">
              {mode === "fix" ? "Fix this flow" : "Workspace Brain"}
            </div>
            <div className="text-[10px] text-ink-400">
              {brain.provider} · {brain.model}
              {brain.apiKeySet ? "" : " · no key saved"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md px-1.5 py-1 text-[10px] text-ink-300 hover:bg-navy-800"
              onClick={() => setShowConfig((v) => !v)}
            >
              Model
            </button>
            {mode === "canvas" && (
              <button
                type="button"
                className="rounded-md p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                title="New canvas session"
                onClick={() => newSession()}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-ink-400 hover:bg-navy-800 hover:text-ink-100"
              title="Close"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {(
            [
              ["brain", "Ask"],
              ["fix", "Fix"],
              ["canvas", "Run canvas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={clsx("ui-tab flex-1", mode === id && "ui-tab-active")}
            >
              {label}
            </button>
          ))}
        </div>
        {showConfig && modelChat && (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveBrain();
            }}
          >
            <select
              value={brain.provider}
              onChange={(e) => {
                const next = providers.find((p) => p.id === e.target.value);
                setBrainField({
                  provider: e.target.value,
                  ...(next ? { model: next.model, baseUrl: next.baseUrl } : {}),
                });
              }}
              className="w-full rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px]"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={brain.model}
              onChange={(e) => setBrainField({ model: e.target.value })}
              placeholder="Model name"
              className="w-full rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px]"
            />
            <input
              value={brain.baseUrl}
              onChange={(e) => setBrainField({ baseUrl: e.target.value })}
              placeholder="Endpoint"
              className="w-full rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px]"
            />
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={brain.apiKeySet ? "API key saved — paste to replace" : "API key (local models can leave this empty)"}
              className="w-full rounded-lg border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px]"
              autoComplete="off"
            />
            <button type="submit" className="btn-primary w-full py-1.5 text-[11px]">
              Save model
            </button>
          </form>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {brainMode && hint && (
          <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] leading-relaxed text-ink-200">
            {hint}
          </p>
        )}
        {mode === "fix" && (
          <p className="rounded-xl border border-[var(--border)] bg-[#f0fdfa] px-3 py-2 text-[13px] leading-6 text-[#0a1628] dark:bg-white/10 dark:text-white">
            Chat stays on this flow. Apply a suggested version, then ask the workspace model what is mandatory, what is good to have, and what will break.
          </p>
        )}
        {brainMode && turns.length === 0 && (
          <p className="rounded-lg border border-navy-700 bg-navy-800/60 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
            Ask about this workspace. The brain reads <span className="text-ink-200">memory.json</span> and
            the last 5 executions — node inputs, outputs, and failures.
          </p>
        )}
        {mode === "canvas" && canvasMessages.length === 0 && (
          <p className="rounded-lg border border-navy-700 bg-navy-800/60 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
            Runs the canvas as a chatbot. Use a Chat Start → LLM → Chat Reply graph.
          </p>
        )}
        {(modelChat ? turns : canvasMessages).map((m, i) => (
          <div
            key={`${m.ts}-${i}`}
            className={clsx(
              "max-w-[95%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"
                : "bg-navy-800 text-ink-100",
            )}
          >
            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-500">
              {m.role === "user" ? "You" : modelChat ? "Brain" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {(modelChat ? sending : canvasSending) && (
          <div className="rounded-2xl bg-navy-800 px-3 py-2 text-[13px] leading-6 text-[var(--brand-accent)]">
            {modelChat ? "Reading the flow…" : "Running workflow…"}
          </div>
        )}
        {(modelChat ? error : canvasError) && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] leading-6 text-danger">
            {modelChat ? error : canvasError}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="shrink-0 border-t border-navy-700 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "fix") {
            const report = assessFlow(useStudioStore.getState().document);
            void sendBrain(`${formatFlightBrief(report)}\n\n${draft.trim()}`);
          } else if (brainMode) void sendBrain();
          else void sendCanvas();
        }}
      >
        <div className="flex items-end gap-1.5">
          <textarea
            value={mode === "canvas" ? canvasDraft : draft}
            onChange={(e) => (mode === "canvas" ? setCanvasDraft(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mode === "fix") {
                  const report = assessFlow(useStudioStore.getState().document);
                  void sendBrain(`${formatFlightBrief(report)}\n\n${draft.trim()}`);
                } else if (brainMode) void sendBrain();
                else void sendCanvas();
              }
            }}
            rows={mode === "fix" ? 3 : 2}
            placeholder={
              mode === "fix"
                ? "Describe what failed. Enter sends, Shift+Enter adds a line."
                : brainMode
                  ? "Ask about this workspace…"
                  : "Message the flow…"
            }
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-navy-600 bg-navy-950 px-2.5 py-2 text-[12px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={
              (mode === "canvas" ? canvasSending : sending) ||
              !(mode === "canvas" ? canvasDraft : draft).trim()
            }
            className="btn-primary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
