import {
  renderSimpleMarkdown,
  type NotebookCell,
} from "@/core/codeLabDefaults";
import { isGeneratedWorkflowCell } from "@/core/workflowCodegen";
import { CodeExportBar } from "@/components/editor/CodeExportBar";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function NotebookEditor() {
  const cells = useStudioStore((s) => s.notebookCells);
  const document = useStudioStore((s) => s.document);
  const codeLabContext = useStudioStore((s) => s.codeLabContext);
  const standaloneNotebooks = useStudioStore((s) => s.standaloneNotebooks);
  const activeNotebookId = useStudioStore((s) => s.activeNotebookId);
  const activeNotebookName = useStudioStore((s) => s.activeNotebookName);
  const setActiveNotebookName = useStudioStore((s) => s.setActiveNotebookName);
  const saveNotebookToLibrary = useStudioStore((s) => s.saveNotebookToLibrary);
  const openSavedNotebook = useStudioStore((s) => s.openSavedNotebook);
  const deleteSavedNotebook = useStudioStore((s) => s.deleteSavedNotebook);
  const newUntitledNotebook = useStudioStore((s) => s.newUntitledNotebook);
  const updateNotebookCell = useStudioStore((s) => s.updateNotebookCell);
  const insertNotebookCellAfter = useStudioStore((s) => s.insertNotebookCellAfter);
  const removeNotebookCell = useStudioStore((s) => s.removeNotebookCell);
  const setNotebookCells = useStudioStore((s) => s.setNotebookCells);
  const executeCodeLab = useStudioStore((s) => s.executeCodeLab);
  const running = useStudioStore((s) => s.running);
  const apiStatus = useStudioStore((s) => s.apiStatus);
  const [activeId, setActiveId] = useState<string | null>(cells[0]?.id ?? null);

  const standalone = codeLabContext === "standalone";
  const saved = standalone ? standaloneNotebooks : (document.notebooks ?? []);

  return (
    <div className="flex h-full flex-col bg-navy-950/40">
      {/* Databricks-like command bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-700 bg-navy-900/95 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {standalone ? (
              <input
                value={activeNotebookName}
                onChange={(e) => setActiveNotebookName(e.target.value)}
                className="min-w-[10rem] max-w-xs flex-1 rounded-md border border-navy-600 bg-navy-950 px-2 py-1 text-sm font-semibold text-ink-100 outline-none focus:border-cyan-500"
                placeholder="Notebook name"
                title="Independent notebook name"
              />
            ) : (
              <div className="text-sm font-semibold text-ink-100">
                {document.workspace.name} · Workflow notebook
              </div>
            )}
            {activeNotebookId && (
              <span className="font-mono text-[9px] text-ink-500">
                {activeNotebookId}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-400">
            <span className="rounded bg-[#FF3621]/15 px-1.5 py-0.5 font-medium text-[#FF3621]">
              Python
            </span>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                apiStatus === "ok"
                  ? "bg-ok/15 text-ok"
                  : "bg-navy-800 text-ink-400",
              )}
            >
              <span
                className={clsx(
                  "h-1.5 w-1.5 rounded-full",
                  apiStatus === "ok" ? "bg-ok" : "bg-ink-400",
                )}
              />
              {apiStatus === "ok"
                ? "Attached · Agent Studio runtime"
                : "Detached · start API"}
            </span>
            <span>
              {standalone
                ? "Independent local notebook · not linked to the workflow"
                : "Generated from canvas nodes · n8n execute + Flowise json/text"}
            </span>
          </div>
        </div>

        {standalone && (
          <select
            className="max-w-[11rem] rounded-md border border-navy-600 bg-navy-950 px-2 py-1.5 text-[11px] text-ink-200 outline-none focus:border-cyan-500"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = "";
              if (id === "__new__") newUntitledNotebook();
              else if (id) openSavedNotebook(id);
            }}
          >
            <option value="">Open notebook…</option>
            <option value="__new__">+ New notebook</option>
            {saved.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        )}

        {standalone && (
          <>
            <button
              type="button"
              onClick={() => saveNotebookToLibrary()}
              className="btn-accent flex items-center gap-1.5 rounded-md px-3 py-1.5"
              title={
                activeNotebookId
                  ? "Save changes to this notebook"
                  : "Save to the global local notebook library"
              }
            >
              <Save className="h-3.5 w-3.5" />
              {activeNotebookId ? "Save" : "Save notebook"}
            </button>
            {activeNotebookId && (
              <button
                type="button"
                onClick={() =>
                  saveNotebookToLibrary(
                    `${activeNotebookName} copy`,
                    { asNew: true },
                  )
                }
                className="flex items-center gap-1 rounded-md border border-navy-600 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-cyan-500"
                title="Create a separate notebook instead of overwriting this one"
              >
                <Plus className="h-3.5 w-3.5" />
                Save as new
              </button>
            )}
          </>
        )}

        {standalone && activeNotebookId && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete saved notebook “${activeNotebookName}”?`)) {
                deleteSavedNotebook(activeNotebookId);
              }
            }}
            className="rounded-md border border-navy-600 px-2 py-1.5 text-[11px] text-ink-400 hover:border-danger hover:text-danger"
            title="Delete from library"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        {!standalone && <CodeExportBar />}
        {!standalone && (
          <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-500">
            Canvas synced
          </span>
        )}
        <button
          type="button"
          disabled={running}
          onClick={() => void executeCodeLab("notebook")}
          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-[11px] disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run all
        </button>
      </div>

      {standalone && (
        <div className="flex items-center gap-1 border-b border-navy-700 bg-navy-900/80 px-3 py-1.5">
          <button className="ui-tab" onClick={() => newUntitledNotebook()}>
            File · New
          </button>
          <button className="ui-tab" onClick={() => saveNotebookToLibrary()}>
            Save
          </button>
          {activeNotebookId && (
            <button
              className="ui-tab"
              onClick={() =>
                saveNotebookToLibrary(
                  `${activeNotebookName} copy`,
                  { asNew: true },
                )
              }
            >
              Save As
            </button>
          )}
          <button
            className="ui-tab"
            onClick={() =>
              insertNotebookCellAfter(cells.at(-1)?.id ?? null, "code")
            }
          >
            + Code
          </button>
          <button
            className="ui-tab"
            onClick={() =>
              insertNotebookCellAfter(cells.at(-1)?.id ?? null, "markdown")
            }
          >
            + Markdown
          </button>
          <button
            className="ui-tab"
            onClick={() =>
              setNotebookCells(
                cells.map((cell) => ({
                  ...cell,
                  status: "idle",
                  execution_count:
                    cell.cell_type === "code" ? null : undefined,
                  output: undefined,
                  output_error: undefined,
                })),
              )
            }
          >
            Kernel · Clear outputs
          </button>
        </div>
      )}

      {standalone && saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-navy-800 bg-navy-950/60 px-3 py-1.5 text-[10px] text-ink-400">
          <span className="mr-1">Library:</span>
          {saved.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openSavedNotebook(n.id)}
              className={clsx(
                "rounded-full border px-2 py-0.5 hover:border-cyan-500/50 hover:text-cyan-400",
                n.id === activeNotebookId
                  ? "border-cyan-500/50 text-cyan-400"
                  : "border-navy-700",
              )}
            >
              {n.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-6">
        <div className="mx-auto max-w-4xl">
          {standalone && (
            <InsertRail
              onCode={() => insertNotebookCellAfter(null, "code")}
              onMarkdown={() => insertNotebookCellAfter(null, "markdown")}
              label="Add cell at top"
            />
          )}

          {cells.map((cell, idx) => (
            <div key={cell.id}>
              <DatabricksCell
                cell={cell}
                index={idx}
                active={activeId === cell.id}
                disabled={running}
                readOnly={isGeneratedWorkflowCell(cell.id)}
                onFocus={() => setActiveId(cell.id)}
                onChange={(source) => updateNotebookCell(cell.id, { source })}
                onRemove={() => removeNotebookCell(cell.id)}
                onRun={async () => {
                  setActiveId(cell.id);
                  await executeCodeLab("notebook", cell.id);
                  const next = cells[idx + 1];
                  if (next) setActiveId(next.id);
                }}
                onRunInPlace={() => {
                  setActiveId(cell.id);
                  void executeCodeLab("notebook", cell.id);
                }}
              />
              {standalone && (
                <InsertRail
                  onCode={() => insertNotebookCellAfter(cell.id, "code")}
                  onMarkdown={() => insertNotebookCellAfter(cell.id, "markdown")}
                />
              )}
            </div>
          ))}

          {cells.length === 0 && (
            <div className="rounded-lg border border-dashed border-navy-600 px-6 py-10 text-center text-sm text-ink-400">
              Empty notebook — add a code or markdown cell to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsertRail({
  onCode,
  onMarkdown,
  label,
}: {
  onCode: () => void;
  onMarkdown: () => void;
  label?: string;
}) {
  return (
    <div className="group relative flex h-6 items-center justify-center">
      <div className="absolute inset-x-8 top-1/2 h-px bg-navy-700 opacity-0 transition group-hover:opacity-100" />
      <div className="relative z-[1] hidden gap-1 rounded-full border border-navy-600 bg-navy-900 px-1 py-0.5 shadow group-hover:flex">
        <button
          type="button"
          title={label ?? "Insert code cell"}
          onClick={onCode}
          className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] text-ink-300 hover:bg-navy-700 hover:text-cyan-400"
        >
          <Plus className="h-3 w-3" /> Code
        </button>
        <button
          type="button"
          title="Insert markdown cell"
          onClick={onMarkdown}
          className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] text-ink-300 hover:bg-navy-700 hover:text-cyan-400"
        >
          <Plus className="h-3 w-3" /> Markdown
        </button>
      </div>
    </div>
  );
}

function DatabricksCell({
  cell,
  index,
  active,
  disabled,
  readOnly,
  onFocus,
  onChange,
  onRemove,
  onRun,
  onRunInPlace,
}: {
  cell: NotebookCell;
  index: number;
  active: boolean;
  disabled: boolean;
  readOnly: boolean;
  onFocus: () => void;
  onChange: (source: string) => void;
  onRemove: () => void;
  onRun: () => void | Promise<void>;
  onRunInPlace: () => void;
}) {
  const [editingMd, setEditingMd] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autoSize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(72, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    autoSize();
  }, [cell.source, autoSize]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (cell.cell_type !== "code") return;
      if (e.shiftKey) void onRun();
      else onRunInPlace();
    }
  };

  const statusIcon =
    cell.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
    ) : cell.status === "success" ? (
      <Check className="h-3.5 w-3.5 text-ok" />
    ) : cell.status === "error" ? (
      <X className="h-3.5 w-3.5 text-danger" />
    ) : null;

  return (
    <div
      className={clsx(
        "group/cell relative mb-1 rounded-md border transition",
        active
          ? "border-[#FF3621]/60 bg-navy-900/80 shadow-[inset_3px_0_0_#FF3621]"
          : "border-transparent hover:border-navy-600 hover:bg-navy-900/40",
      )}
      onMouseDown={onFocus}
    >
      <div className="flex gap-0">
        {/* Left gutter — Databricks run control */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 py-2">
          {cell.cell_type === "code" ? (
            <button
              type="button"
              disabled={disabled}
              title="Run cell (Shift+Enter)"
              onClick={() => void onRun()}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FF3621] text-white shadow hover:brightness-110 disabled:opacity-40"
            >
              {cell.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
            </button>
          ) : (
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              md
            </span>
          )}
          <span className="font-mono text-[10px] text-ink-400">
            {cell.cell_type === "code"
              ? cell.execution_count != null
                ? `[${cell.execution_count}]`
                : "[ ]"
              : ""}
          </span>
          {statusIcon}
        </div>

        <div className="min-w-0 flex-1 py-2 pr-2">
          <div className="mb-1 flex items-center gap-2 opacity-0 transition group-hover/cell:opacity-100">
            <span className="text-[10px] text-ink-400">
              Cell {index + 1} · {cell.cell_type === "code" ? "Python" : "Markdown"}
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={onRemove}
                className="ml-auto rounded p-1 text-ink-400 hover:bg-navy-700 hover:text-danger"
                title="Delete cell"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>

          {cell.cell_type === "markdown" && !editingMd ? (
            <button
              type="button"
              className="nb-md w-full rounded-md px-2 py-1 text-left hover:bg-navy-800/50"
              onDoubleClick={() => {
                if (!readOnly) setEditingMd(true);
              }}
              dangerouslySetInnerHTML={{
                __html: renderSimpleMarkdown(cell.source || "_Empty markdown_"),
              }}
            />
          ) : (
            <textarea
              ref={taRef}
              value={cell.source}
              readOnly={readOnly}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                if (cell.cell_type === "markdown") setEditingMd(false);
              }}
              spellCheck={cell.cell_type === "markdown"}
              className="w-full resize-none bg-transparent px-2 py-1 font-mono text-[12.5px] leading-relaxed text-ink-100 outline-none"
              placeholder={
                cell.cell_type === "code"
                  ? "# COMMAND ----------"
                  : "Markdown (double-click cell to edit)"
              }
            />
          )}

          {cell.cell_type === "code" && cell.output != null && cell.output !== "" && (
            <div className="mt-2 overflow-hidden rounded-md border border-navy-700 bg-navy-950/80">
              <button
                type="button"
                className="flex w-full items-center gap-1 border-b border-navy-700 px-2 py-1 text-[10px] text-ink-400 hover:text-ink-100"
                onClick={() => setOutputOpen((v) => !v)}
              >
                <ChevronDown
                  className={clsx(
                    "h-3 w-3 transition",
                    !outputOpen && "-rotate-90",
                  )}
                />
                Output
                {cell.output_error && (
                  <span className="text-danger"> · error</span>
                )}
              </button>
              {outputOpen && (
                <pre
                  className={clsx(
                    "max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
                    cell.output_error ? "text-danger" : "text-ink-300",
                  )}
                >
                  {cell.output}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
