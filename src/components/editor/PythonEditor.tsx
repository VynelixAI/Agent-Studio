import Editor from "@monaco-editor/react";
import { useStudioStore } from "@/store/studioStore";
import { useThemeStore } from "@/store/themeStore";
import { Play, Save } from "lucide-react";
import { CodeExportBar } from "@/components/editor/CodeExportBar";

export function PythonEditor() {
  const pythonSource = useStudioStore((s) => s.pythonSource);
  const setPythonSource = useStudioStore((s) => s.setPythonSource);
  const saveCodeLab = useStudioStore((s) => s.saveCodeLab);
  const executeCodeLab = useStudioStore((s) => s.executeCodeLab);
  const running = useStudioStore((s) => s.running);
  const backendSynced = useStudioStore((s) => s.backendSynced);
  const codeLabContext = useStudioStore((s) => s.codeLabContext);
  const theme = useThemeStore((s) => s.theme);
  const standalone = codeLabContext === "standalone";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-navy-700 bg-navy-900/80 px-3 py-1.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {standalone ? "Independent Python lab" : "Generated workflow Python"}
          </div>
          <div className="text-[10px] text-ink-400">
            {standalone
              ? "Global local script · independent from canvas and YAML"
              : "n8n execute(items) + Flowise json/text — one class per canvas node"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!standalone && <CodeExportBar />}
          <button
            type="button"
            disabled={!standalone && !backendSynced}
            onClick={() => void saveCodeLab()}
            className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[11px] text-ink-300 hover:border-cyan-500/50 disabled:opacity-50"
            title={
              standalone
                ? "Save independent script locally"
                : backendSynced
                  ? "Save generated snapshot to MongoDB"
                  : "Apply workspace first"
            }
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void executeCodeLab("python")}
            className="btn-primary flex items-center gap-1 px-2.5 py-1 text-[11px] disabled:opacity-60"
            title="Runs current editor code without saving to MongoDB"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? "Running…" : "Run Python"}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={pythonSource}
          onChange={(v) => setPythonSource(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "JetBrains Mono, SF Mono, monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 4,
            padding: { top: 12 },
            automaticLayout: true,
            readOnly: !standalone,
            ...(!standalone
              ? {
                  readOnlyMessage: {
                    value:
                      "Generated from the canvas. Edit or delete the corresponding node.",
                  },
                }
              : {}),
          }}
        />
      </div>
    </div>
  );
}
