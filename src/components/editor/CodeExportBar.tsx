import { loadCodegenSettings, saveCodegenSettings } from "@/core/codegenSettings";
import {
  generateWorkflowExportFiles,
  notebookToIpynb,
  type NodeCodeOverlay,
} from "@/core/workflowCodegen";
import { downloadBlob, downloadText, zipStore } from "@/lib/downloadZip";
import { useStudioStore } from "@/store/studioStore";
import { Download, Sparkles } from "lucide-react";
import { useState } from "react";

export function CodeExportBar() {
  const document = useStudioStore((s) => s.document);
  const pythonSource = useStudioStore((s) => s.pythonSource);
  const notebookCells = useStudioStore((s) => s.notebookCells);
  const nodeCodeOverlays = useStudioStore((s) => s.nodeCodeOverlays);
  const enhanceWorkflowCode = useStudioStore((s) => s.enhanceWorkflowCode);
  const enhancingCode = useStudioStore((s) => s.enhancingCode);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadCodegenSettings);
  const [error, setError] = useState<string | null>(null);
  const slug = (document.workspace.id || "workspace").replace(/[^\w.-]+/g, "_");

  const downloadPython = () =>
    downloadText(`${slug}.workflow.py`, pythonSource, "text/x-python");

  const downloadNotebook = () =>
    downloadText(
      `${slug}.workflow.ipynb`,
      notebookToIpynb(notebookCells, document.workspace.name),
      "application/json",
    );

  const downloadZip = () => {
    const files = generateWorkflowExportFiles(
      document,
      nodeCodeOverlays as Record<string, NodeCodeOverlay>,
    );
    downloadBlob(`${slug}-reference.zip`, zipStore(files));
  };

  const onEnhance = async () => {
    setError(null);
    saveCodegenSettings(settings);
    try {
      await enhanceWorkflowCode();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={downloadPython}
        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[11px] text-ink-300 hover:border-cyan-500/50"
        title="Download workflow.py for later reference"
      >
        <Download className="h-3.5 w-3.5" />
        Python
      </button>
      <button
        type="button"
        onClick={downloadNotebook}
        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[11px] text-ink-300 hover:border-cyan-500/50"
        title="Download workflow.ipynb"
      >
        <Download className="h-3.5 w-3.5" />
        Notebook
      </button>
      <button
        type="button"
        onClick={downloadZip}
        className="flex items-center gap-1 rounded-md border border-navy-600 px-2 py-1 text-[11px] text-ink-300 hover:border-cyan-500/50"
        title="Zip: workflow.py + nodes/*.py + notebook"
      >
        <Download className="h-3.5 w-3.5" />
        Zip
      </button>
      <button
        type="button"
        disabled={enhancingCode}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-400 hover:border-cyan-500 disabled:opacity-60"
        title="Optional: polish node code with a dedicated codegen model"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {enhancingCode ? "Enhancing…" : "LLM polish"}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-80 rounded-md border border-navy-600 bg-navy-900 p-3 shadow-xl">
          <div className="text-[11px] font-semibold text-ink-100">
            Codegen model (optional)
          </div>
          <p className="mt-1 text-[10px] leading-snug text-ink-400">
            Canvas already generates n8n/Flowise Python. Use a separate key to
            polish comments and live SDK snippets. Key stays in this browser —
            it is not saved to the workspace YAML.
          </p>
          <label className="mt-2 block text-[10px] text-ink-400">
            Provider
            <input
              className="mt-0.5 w-full rounded border border-navy-600 bg-navy-950 px-2 py-1 text-[11px] text-ink-100"
              value={settings.provider}
              onChange={(e) =>
                setSettings((s) => ({ ...s, provider: e.target.value }))
              }
              placeholder="openai / openrouter / ollama"
            />
          </label>
          <label className="mt-1.5 block text-[10px] text-ink-400">
            Model
            <input
              className="mt-0.5 w-full rounded border border-navy-600 bg-navy-950 px-2 py-1 text-[11px] text-ink-100"
              value={settings.model}
              onChange={(e) =>
                setSettings((s) => ({ ...s, model: e.target.value }))
              }
              placeholder="gpt-4.1-mini"
            />
          </label>
          <label className="mt-1.5 block text-[10px] text-ink-400">
            Base URL
            <input
              className="mt-0.5 w-full rounded border border-navy-600 bg-navy-950 px-2 py-1 text-[11px] text-ink-100"
              value={settings.baseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, baseUrl: e.target.value }))
              }
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label className="mt-1.5 block text-[10px] text-ink-400">
            API key
            <input
              type="password"
              className="mt-0.5 w-full rounded border border-navy-600 bg-navy-950 px-2 py-1 text-[11px] text-ink-100"
              value={settings.apiKey}
              onChange={(e) =>
                setSettings((s) => ({ ...s, apiKey: e.target.value }))
              }
              placeholder="sk-…"
            />
          </label>
          {error && (
            <p className="mt-1.5 text-[10px] text-danger">{error}</p>
          )}
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-navy-600 px-2 py-1 text-[11px] text-ink-300"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-primary px-2 py-1 text-[11px]"
              onClick={() => void onEnhance()}
            >
              Enhance nodes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
