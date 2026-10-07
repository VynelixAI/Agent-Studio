import { useStudioStore } from "@/store/studioStore";
import { Database, GitBranch, Replace } from "lucide-react";

export function ApplyConfirmModal() {
  const open = useStudioStore((s) => s.applyConfirmOpen);
  const applying = useStudioStore((s) => s.applying);
  const document = useStudioStore((s) => s.document);
  const backendExists = useStudioStore((s) => s.backendExists);
  const pendingSecrets = useStudioStore((s) => s.pendingSecrets);
  const closeApplyConfirm = useStudioStore((s) => s.closeApplyConfirm);
  const confirmApplyToBackend = useStudioStore((s) => s.confirmApplyToBackend);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md animate-fade-in rounded-2xl border border-navy-600 bg-navy-900 p-5 shadow-2xl"
      >
        <div className="mb-1 flex items-center gap-2 text-cyan-500">
          <Database className="h-4 w-4" />
          <h2 className="text-sm font-semibold text-ink-100">
            Save workspace to MongoDB
          </h2>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          {backendExists ? (
            <>
              <span className="font-mono text-ink-100">{document.workspace.name}</span>{" "}
              (<span className="font-mono">{document.workspace.id}</span>) already
              exists in the database at v{document.workspace.version}. Choose how
              to apply your YAML and attachments.
            </>
          ) : (
            <>
              This will create{" "}
              <span className="font-mono text-ink-100">{document.workspace.name}</span>{" "}
              in MongoDB with YAML, connectors, and encrypted API keys.
            </>
          )}
        </p>

        {pendingSecrets.length > 0 && (
          <p className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-[11px] text-cyan-300">
            {pendingSecrets.length} connector secret(s) will be encrypted with
            this save (e.g. Prefect API key).
          </p>
        )}

        <div className="mt-4 space-y-2">
          {backendExists ? (
            <>
              <button
                type="button"
                disabled={applying}
                onClick={() => void confirmApplyToBackend("override")}
                className="flex w-full items-start gap-3 rounded-xl border border-navy-600 bg-navy-800/80 px-3 py-3 text-left transition hover:border-cyan-500/50 disabled:opacity-60"
              >
                <Replace className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <div>
                  <div className="text-sm font-medium text-ink-100">
                    Override current
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-400">
                    Replace head document/YAML in DB and store a patch version
                    snapshot.
                  </div>
                </div>
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => void confirmApplyToBackend("new_version")}
                className="flex w-full items-start gap-3 rounded-xl border border-navy-600 bg-navy-800/80 px-3 py-3 text-left transition hover:border-cyan-500/50 disabled:opacity-60"
              >
                <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                <div>
                  <div className="text-sm font-medium text-ink-100">
                    Create new version
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-400">
                    Keep history — bump minor version and set it as the new head.
                  </div>
                </div>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={applying}
              onClick={() => void confirmApplyToBackend("new_version")}
              className="btn-primary flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm disabled:opacity-60"
            >
              <Database className="h-4 w-4" />
              {applying
                ? "Creating…"
                : pendingSecrets.length
                  ? "Create in MongoDB (+ encrypt keys)"
                  : "Create in MongoDB"}
            </button>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={applying}
            onClick={() => closeApplyConfirm()}
            className="rounded-lg border border-navy-600 px-3 py-1.5 text-[11px] text-ink-400 hover:text-ink-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
