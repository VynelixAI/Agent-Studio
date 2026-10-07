import { SecurityBadge } from "@/components/layout/SecurityBadge";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useChatStore } from "@/store/chatStore";
import { useStudioStore } from "@/store/studioStore";
import clsx from "clsx";
import {
  BookOpen,
  Columns2,
  Database,
  FileCode2,
  MessageSquare,
  Play,
  Rocket,
  ShieldCheck,
  SquareCode,
  Workflow,
} from "lucide-react";
import { useEffect } from "react";

const CTRL =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-navy-600 bg-transparent px-2.5 text-[11px] font-medium text-ink-300 transition hover:border-cyan-500/45 hover:text-cyan-400";

export function StudioHeader() {
  const document = useStudioStore((s) => s.document);
  const view = useStudioStore((s) => s.view);
  const setView = useStudioStore((s) => s.setView);
  const codeLabContext = useStudioStore((s) => s.codeLabContext);
  const openWorkflowCodeView = useStudioStore((s) => s.openWorkflowCodeView);
  const openStandaloneCodeLab = useStudioStore((s) => s.openStandaloneCodeLab);
  const isDirty = useStudioStore((s) => s.isDirty);
  const backendSynced = useStudioStore((s) => s.backendSynced);
  const issues = useStudioStore((s) => s.issues);
  const dryRun = useStudioStore((s) => s.dryRun);
  const executeRun = useStudioStore((s) => s.executeRun);
  const setRunRuntime = useStudioStore((s) => s.setRunRuntime);
  const requestApplyToBackend = useStudioStore((s) => s.requestApplyToBackend);
  const revalidate = useStudioStore((s) => s.revalidate);
  const updateMeta = useStudioStore((s) => s.updateMeta);
  const running = useStudioStore((s) => s.running);
  const apiStatus = useStudioStore((s) => s.apiStatus);
  const checkApi = useStudioStore((s) => s.checkApi);

  const errorCount = issues.filter((i) => i.severity === "error").length;

  useEffect(() => {
    void checkApi();
    const t = window.setInterval(() => void checkApi(), 30000);
    return () => window.clearInterval(t);
  }, [checkApi]);

  const statusHint = isDirty
    ? "Unsaved · cached locally"
    : !backendSynced
      ? "Not synced to MongoDB"
      : "Synced";

  return (
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-navy-700 bg-navy-900 px-3 dark:bg-navy-900/90 dark:backdrop-blur dark:supports-[backdrop-filter]:bg-navy-900/75">
      {/* Left — brand + workspace */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2.5">
          <img
            src="/vynelix.svg"
            alt=""
            className="h-7 w-7 rounded-md"
            aria-hidden
          />
          <div className="hidden min-w-0 sm:block">
            <div className="text-[13px] font-semibold leading-none tracking-tight text-ink-100">
              Agent Studio
            </div>
            <div className="mt-0.5 text-[10px] leading-none text-cyan-500">
              VynelixAI
            </div>
          </div>
        </div>

        <div
          className="hidden h-7 w-px shrink-0 bg-navy-600 sm:block"
          aria-hidden
        />

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            className="h-8 min-w-0 max-w-[200px] truncate rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-ink-100 outline-none transition hover:border-navy-600 focus:border-cyan-500 focus:bg-navy-950/40 xl:max-w-[260px]"
            value={document.workspace.name}
            onChange={(e) => updateMeta({ name: e.target.value })}
            aria-label="Workspace name"
            title={document.workspace.name}
          />

          <span className="hidden h-8 shrink-0 items-center rounded-md bg-navy-800/80 px-2 font-mono text-[10px] text-ink-400 sm:inline-flex">
            v{document.workspace.version}
          </span>

          <span
            className={clsx(
              "hidden h-8 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold uppercase tracking-wide md:inline-flex",
              document.workspace.mode === "workflow"
                ? "bg-cyan-500/12 text-cyan-400"
                : "bg-violet-500/12 text-violet-600 dark:text-violet-300",
            )}
          >
            {document.workspace.mode}
          </span>

          <span
            className={clsx(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium",
              apiStatus === "ok" && "bg-ok/10 text-ok",
              apiStatus === "down" && "bg-danger/10 text-danger",
              apiStatus === "unknown" && "bg-navy-800 text-ink-400",
            )}
            title="API / MongoDB status"
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                apiStatus === "ok" && "bg-ok",
                apiStatus === "down" && "bg-danger",
                apiStatus === "unknown" && "bg-ink-400",
              )}
              aria-hidden
            />
            <span className="hidden lg:inline">
              {apiStatus === "ok"
                ? "API"
                : apiStatus === "down"
                  ? "API down"
                  : "API…"}
            </span>
          </span>

          {(isDirty || !backendSynced) && (
            <span
              className="hidden h-8 max-w-[140px] truncate items-center text-[10px] text-warn xl:inline-flex"
              title={statusHint}
            >
              {isDirty ? "unsaved" : "local only"}
            </span>
          )}
        </div>
      </div>

      {/* Center — view switcher */}
      <nav
        className="flex h-8 items-center rounded-lg border border-navy-600 bg-navy-950/40 p-0.5"
        aria-label="Studio views"
      >
        {(
          [
            ["canvas", Workflow, "Canvas"],
            ["split", Columns2, "Split"],
            ["yaml", SquareCode, "YAML"],
            ["python", FileCode2, "Python"],
            ["notebook", BookOpen, "Notebook"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => {
              if (id === "python" || id === "notebook") {
                openWorkflowCodeView(id);
              } else {
                setView(id);
              }
            }}
            className={clsx(
              "ui-tab inline-flex h-7 items-center gap-1",
              view === id &&
                (id !== "python" && id !== "notebook"
                  ? true
                  : codeLabContext === "workflow")
                ? "ui-tab-active"
                : "text-ink-400 hover:text-ink-100",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xl:inline">{label}</span>
          </button>
        ))}
      </nav>

      {/* Right — utilities + actions */}
      <div className="flex min-w-0 items-center justify-end gap-2">
        <div className="flex items-center gap-1">
          <SecurityBadge />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => useChatStore.getState().toggle()}
            className={CTRL}
            title="Workspace Brain (Ctrl+J)"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Brain</span>
          </button>
        </div>

        <div className="hidden h-7 w-px bg-navy-600 sm:block" aria-hidden />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => revalidate()}
            className={CTRL}
            title="Validate"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Validate</span>
            {errorCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger/20 px-1 text-[9px] font-semibold text-danger">
                {errorCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => requestApplyToBackend()}
            className={clsx(
              CTRL,
              (isDirty || !backendSynced) &&
                "border-cyan-500/50 text-cyan-400 hover:border-cyan-400",
            )}
            title="Save workspace + secrets to MongoDB"
          >
            <Database className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Apply</span>
            {(isDirty || !backendSynced) && (
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />
            )}
          </button>

          <button
            type="button"
            onClick={() => dryRun()}
            className={CTRL}
            title="Dry-run"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Dry-run</span>
          </button>
        </div>

        <div className="flex h-8 items-stretch overflow-hidden rounded-md border border-navy-600">
          <select
            value={
              codeLabContext === "standalone" &&
              (view === "python" || view === "notebook")
                ? view
                : "workflow"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "python") openStandaloneCodeLab("python");
              else if (v === "notebook") openStandaloneCodeLab("notebook");
              else {
                setRunRuntime("workflow");
                setView("split");
              }
            }}
            className="hidden h-full border-0 border-r border-navy-600 bg-navy-900 px-2 text-[11px] text-ink-300 outline-none focus:bg-navy-800 sm:block"
            title="What Run executes"
            aria-label="Run target"
          >
            <option value="workflow">Workflow</option>
            <option value="python">Python</option>
            <option value="notebook">Notebook</option>
          </select>

          <button
            type="button"
            disabled={running}
            onClick={() => void executeRun()}
            className="btn-primary inline-flex h-full items-center gap-1.5 rounded-none border-0 px-3 text-[11px] font-semibold disabled:opacity-60"
          >
            <Rocket className="h-3.5 w-3.5" />
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
    </header>
  );
}
