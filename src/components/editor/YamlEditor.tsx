import Editor from "@monaco-editor/react";
import { useStudioStore } from "@/store/studioStore";
import { useThemeStore } from "@/store/themeStore";
import { useEffect, useRef } from "react";

export function YamlEditor() {
  const yamlText = useStudioStore((s) => s.yamlText);
  const yamlError = useStudioStore((s) => s.yamlError);
  const setYamlText = useStudioStore((s) => s.setYamlText);
  const applyYamlLocal = useStudioStore((s) => s.applyYamlLocal);
  const requestApplyToBackend = useStudioStore((s) => s.requestApplyToBackend);
  const syncingFrom = useStudioStore((s) => s.syncingFrom);
  const backendSynced = useStudioStore((s) => s.backendSynced);
  const workspaceId = useStudioStore((s) => s.document.workspace.id);
  const theme = useThemeStore((s) => s.theme);
  const timer = useRef<number | null>(null);
  const syncingFromRef = useRef(syncingFrom);
  syncingFromRef.current = syncingFrom;

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col border-l border-navy-700">
      <div className="flex items-center justify-between gap-2 border-b border-navy-700 bg-navy-900/80 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          YAML · source of truth
          {!backendSynced && (
            <span className="ml-2 font-normal normal-case text-warn">
              · not saved to DB
            </span>
          )}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => applyYamlLocal()}
            className="rounded-md border border-navy-600 px-2 py-1 text-[11px] text-ink-300 hover:border-cyan-500/50"
            title="Parse YAML into canvas only"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => requestApplyToBackend()}
            className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-500 hover:border-cyan-500"
            title="Save to MongoDB (confirm override or new version)"
          >
            Apply to DB
          </button>
        </div>
      </div>
      {yamlError && (
        <div className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger">
          {yamlError}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {/* Remount on workspace change so Monaco never keeps a previous workflow */}
        <Editor
          key={workspaceId}
          height="100%"
          defaultLanguage="yaml"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={yamlText}
          onChange={(v) => {
            // Ignore Monaco echo while canvas is pushing YAML into the editor
            if (syncingFromRef.current === "canvas") return;
            const next = v ?? "";
            // Ignore no-op echoes of the value we already hold
            if (next === useStudioStore.getState().yamlText) return;
            setYamlText(next);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              if (syncingFromRef.current === "canvas") return;
              applyYamlLocal();
            }, 450);
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "JetBrains Mono, SF Mono, monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
