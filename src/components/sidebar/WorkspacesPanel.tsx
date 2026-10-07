import { useEffect, useRef, useState } from "react";
import {
  api,
  clearApiBaseOverride,
  getApiBase,
  setApiBase,
  type BackendWorkspaceSummary,
} from "@/lib/api";
import {
  deleteCachedWorkspace,
  listCachedWorkspaces,
  type CachedWorkspace,
} from "@/lib/cacheDb";
import { skipWorkspaceCache, useStudioStore } from "@/store/studioStore";
import { isTauriRuntime, openConfigFile } from "@/lib/tauriDesktop";
import {
  BookmarkPlus,
  Cloud,
  FilePlus2,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";

export function WorkspacesPanel() {
  const [localItems, setLocalItems] = useState<CachedWorkspace[]>([]);
  const [remoteItems, setRemoteItems] = useState<BackendWorkspaceSummary[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<Set<string>>(new Set());
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertName, setConvertName] = useState("");
  const document = useStudioStore((s) => s.document);
  const loadDocument = useStudioStore((s) => s.loadDocument);
  const loadFromBackend = useStudioStore((s) => s.loadFromBackend);
  const newWorkspace = useStudioStore((s) => s.newWorkspace);
  const convertCurrentToTemplate = useStudioStore(
    (s) => s.convertCurrentToTemplate,
  );
  const isDirty = useStudioStore((s) => s.isDirty);
  const apiStatus = useStudioStore((s) => s.apiStatus);
  const checkApi = useStudioStore((s) => s.checkApi);
  const pushLog = useStudioStore((s) => s.pushLog);
  const [apiUrlDraft, setApiUrlDraft] = useState(() => getApiBase());

  /** Hide IDs while DELETE is in flight so a stale list refresh cannot resurrect them */
  const remoteTombstones = useRef(new Set<string>());
  const localTombstones = useRef(new Set<string>());
  const remoteFetchGen = useRef(0);
  const localFetchGen = useRef(0);

  const refreshLocal = () => {
    const gen = ++localFetchGen.current;
    void listCachedWorkspaces().then((items) => {
      if (gen !== localFetchGen.current) return;
      setLocalItems(
        items.filter((x) => !localTombstones.current.has(x.id)),
      );
    });
  };

  const refreshRemote = () => {
    const gen = ++remoteFetchGen.current;
    void api
      .listWorkspaces()
      .then((r) => {
        if (gen !== remoteFetchGen.current) return;
        setRemoteItems(
          r.items.filter(
            (x) => !remoteTombstones.current.has(x.workspaceId),
          ),
        );
      })
      .catch(() => {
        if (gen !== remoteFetchGen.current) return;
        setRemoteItems([]);
      });
  };

  useEffect(() => {
    refreshLocal();
  }, [document.workspace.id, document.workspace.updatedAt]);

  useEffect(() => {
    refreshRemote();
    const t = window.setInterval(refreshRemote, 15000);
    return () => window.clearInterval(t);
  }, [apiStatus, document.workspace.updatedAt]);

  const onConvertToTemplate = () => {
    const name =
      convertName.trim() || `${document.workspace.name} template`;
    convertCurrentToTemplate({
      name,
      description: `Custom template from “${document.workspace.name}” (secrets scrubbed)`,
    });
    setConvertOpen(false);
    setConvertName("");
  };

  const leaveIfActive = (id: string) => {
    if (useStudioStore.getState().document.workspace.id !== id) return;
    newWorkspace();
    useStudioStore.setState({
      backendExists: false,
      backendSynced: false,
    });
  };

  const deleteRemote = async (w: BackendWorkspaceSummary) => {
    const ok = window.confirm(
      `Delete workspace “${w.name}” (${w.workspaceId}) from MongoDB?\n\nThis removes YAML versions, secrets, and run metadata. Cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(w.workspaceId);
    const wasActive = document.workspace.id === w.workspaceId;
    remoteTombstones.current.add(w.workspaceId);
    localTombstones.current.add(w.workspaceId);
    setRemoteItems((prev) =>
      prev.filter((x) => x.workspaceId !== w.workspaceId),
    );
    setLocalItems((prev) => prev.filter((x) => x.id !== w.workspaceId));
    setSelectedRemote((prev) => {
      const next = new Set(prev);
      next.delete(w.workspaceId);
      return next;
    });
    try {
      skipWorkspaceCache(w.workspaceId);
      // Delete from Mongo first — then switch canvas — avoids list refresh resurrecting the row
      await api.deleteWorkspace(w.workspaceId);
      await deleteCachedWorkspace(w.workspaceId).catch(() => undefined);
      if (wasActive) leaveIfActive(w.workspaceId);
      pushLog({
        level: "info",
        message: `Deleted workspace ${w.workspaceId} from MongoDB`,
      });
      refreshRemote();
      refreshLocal();
      window.setTimeout(() => {
        remoteTombstones.current.delete(w.workspaceId);
        localTombstones.current.delete(w.workspaceId);
      }, 30_000);
    } catch (err) {
      remoteTombstones.current.delete(w.workspaceId);
      localTombstones.current.delete(w.workspaceId);
      pushLog({
        level: "error",
        message:
          err instanceof Error ? err.message : "Failed to delete workspace",
      });
      refreshRemote();
      refreshLocal();
    } finally {
      setDeletingId(null);
    }
  };

  const deleteRemoteSelected = async () => {
    const ids = [...selectedRemote];
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Delete ${ids.length} workspace(s) from MongoDB?\n\nYAML versions, secrets, and run metadata will be removed. Cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId("bulk-remote");
    const activeId = document.workspace.id;
    for (const id of ids) {
      remoteTombstones.current.add(id);
      localTombstones.current.add(id);
    }
    setRemoteItems((prev) =>
      prev.filter((x) => !ids.includes(x.workspaceId)),
    );
    setLocalItems((prev) => prev.filter((x) => !ids.includes(x.id)));
    setSelectedRemote(new Set());
    let failed = 0;
    try {
      for (const id of ids) {
        skipWorkspaceCache(id);
        try {
          await api.deleteWorkspace(id);
          await deleteCachedWorkspace(id).catch(() => undefined);
        } catch {
          failed += 1;
          remoteTombstones.current.delete(id);
          localTombstones.current.delete(id);
        }
      }
      if (ids.includes(activeId)) leaveIfActive(activeId);
      pushLog({
        level: failed ? "warn" : "info",
        message:
          failed === 0
            ? `Deleted ${ids.length} workspace(s) from MongoDB`
            : `Deleted ${ids.length - failed}/${ids.length} from MongoDB (${failed} failed)`,
      });
      refreshRemote();
      refreshLocal();
    } finally {
      setDeletingId(null);
    }
  };

  const deleteLocal = async (w: CachedWorkspace) => {
    const ok = window.confirm(
      `Remove “${w.name}” from local cache only?\n\nMongoDB copy (if any) is kept.`,
    );
    if (!ok) return;
    setDeletingId(w.id);
    const wasActive = document.workspace.id === w.id;
    localTombstones.current.add(w.id);
    setLocalItems((prev) => prev.filter((x) => x.id !== w.id));
    setSelectedLocal((prev) => {
      const next = new Set(prev);
      next.delete(w.id);
      return next;
    });
    try {
      skipWorkspaceCache(w.id);
      await deleteCachedWorkspace(w.id);
      if (wasActive) leaveIfActive(w.id);
      pushLog({
        level: "info",
        message: `Removed local cache for ${w.id}`,
      });
      refreshLocal();
      window.setTimeout(() => localTombstones.current.delete(w.id), 30_000);
    } catch (err) {
      localTombstones.current.delete(w.id);
      pushLog({
        level: "error",
        message:
          err instanceof Error ? err.message : "Failed to remove local cache",
      });
      refreshLocal();
    } finally {
      setDeletingId(null);
    }
  };

  const deleteLocalSelected = async () => {
    const ids = [...selectedLocal];
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Remove ${ids.length} workflow(s) from local cache?\n\nMongoDB copies (if any) are kept.`,
    );
    if (!ok) return;
    setDeletingId("bulk-local");
    const activeId = document.workspace.id;
    for (const id of ids) localTombstones.current.add(id);
    setLocalItems((prev) => prev.filter((x) => !ids.includes(x.id)));
    setSelectedLocal(new Set());
    try {
      for (const id of ids) {
        skipWorkspaceCache(id);
        await deleteCachedWorkspace(id).catch(() => undefined);
      }
      if (ids.includes(activeId)) leaveIfActive(activeId);
      pushLog({
        level: "info",
        message: `Removed ${ids.length} workflow(s) from local cache`,
      });
      refreshLocal();
    } finally {
      setDeletingId(null);
    }
  };

  const clearAllLocal = async () => {
    if (localItems.length === 0) return;
    const ok = window.confirm(
      `Clear all ${localItems.length} local cache entries?\n\nMongoDB copies are kept.`,
    );
    if (!ok) return;
    setDeletingId("bulk-local");
    const ids = localItems.map((w) => w.id);
    const activeId = document.workspace.id;
    for (const id of ids) localTombstones.current.add(id);
    setLocalItems([]);
    setSelectedLocal(new Set());
    try {
      for (const id of ids) {
        skipWorkspaceCache(id);
        await deleteCachedWorkspace(id).catch(() => undefined);
      }
      if (ids.includes(activeId)) leaveIfActive(activeId);
      pushLog({
        level: "info",
        message: `Cleared ${ids.length} local cache entries`,
      });
      refreshLocal();
    } finally {
      setDeletingId(null);
    }
  };

  const toggleLocal = (id: string) => {
    setSelectedLocal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRemote = (id: string) => {
    setSelectedRemote((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allLocalSelected =
    localItems.length > 0 && selectedLocal.size === localItems.length;
  const allRemoteSelected =
    remoteItems.length > 0 && selectedRemote.size === remoteItems.length;

  return (
    <div className="flex h-full flex-col p-3">
      <button
        type="button"
        onClick={() => newWorkspace()}
        className="btn-primary mb-2 flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
      >
        <FilePlus2 className="h-3.5 w-3.5" />
        New workspace
      </button>

      <button
        type="button"
        onClick={() => {
          setConvertName(`${document.workspace.name} template`);
          setConvertOpen((v) => !v);
        }}
        className="btn-accent mb-3 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2"
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        Convert workflow to template
      </button>

      {convertOpen && (
        <div className="mb-3 space-y-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2">
          <label className="text-[10px] text-ink-400">Template name</label>
          <input
            value={convertName}
            onChange={(e) => setConvertName(e.target.value)}
            className="w-full rounded-md border border-navy-600 bg-navy-950 px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
            placeholder="My pipeline template"
          />
          <p className="text-[9px] leading-relaxed text-ink-500">
            Saves to <span className="text-ink-300">Templates → Custom</span>{" "}
            (local). Secrets scrubbed — connectors become placeholders.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onConvertToTemplate}
              className="btn-primary flex-1 px-2 py-1.5 text-[10px]"
            >
              Save to Custom
            </button>
            <button
              type="button"
              onClick={() => setConvertOpen(false)}
              className="rounded-md border border-navy-600 px-2 py-1.5 text-[10px] text-ink-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isTauriRuntime() && (
        <button
          type="button"
          onClick={() => void openConfigFile()}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-navy-600 px-3 py-1.5 text-[10px] text-ink-300 hover:border-cyan-500/40 hover:text-cyan-300"
          title="Edit agent-studio.yaml (DB name, Mongo URI, API port)"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Edit desktop config (YAML)
        </button>
      )}

      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        <span className="flex items-center gap-1.5">
          <Cloud className="h-3 w-3" />
          MongoDB
        </span>
        {remoteItems.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1 font-normal normal-case text-ink-500">
            <input
              type="checkbox"
              checked={allRemoteSelected}
              onChange={() => {
                if (allRemoteSelected) setSelectedRemote(new Set());
                else
                  setSelectedRemote(
                    new Set(remoteItems.map((w) => w.workspaceId)),
                  );
              }}
              className="rounded border-navy-600"
            />
            <span className="text-[10px]">All</span>
          </label>
        )}
      </div>
      {selectedRemote.size > 0 && (
        <button
          type="button"
          disabled={deletingId !== null}
          onClick={() => void deleteRemoteSelected()}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[10px] text-danger hover:bg-danger/20 disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
          Delete {selectedRemote.size} from MongoDB
        </button>
      )}
      <div className="mb-3 max-h-48 space-y-1 overflow-y-auto">
        {apiStatus === "down" && (
          <div className="mb-2 space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[10px] leading-relaxed text-ink-200">
            <p className="font-semibold text-danger">API offline</p>
            <p>
              UI cannot reach{" "}
              <code className="text-cyan-400">{getApiBase()}</code>. On this
              host start MongoDB + the API:
            </p>
            <pre className="overflow-x-auto rounded bg-navy-950/80 p-1.5 font-mono text-[9px] text-ink-300">{`npm run mongo:up
cd server && npm install && npm run dev
# UI: npm run dev → http://<host>:1420`}</pre>
            <label className="block text-ink-400">API URL (if remote)</label>
            <div className="flex gap-1">
              <input
                value={apiUrlDraft}
                onChange={(e) => setApiUrlDraft(e.target.value)}
                placeholder="http://host:8787"
                className="min-w-0 flex-1 rounded border border-navy-600 bg-navy-950 px-1.5 py-1 font-mono text-[10px] outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => {
                  setApiBase(apiUrlDraft);
                  void checkApi().then(() => refreshRemote());
                  pushLog({
                    level: "info",
                    message: `API URL set to ${getApiBase()}`,
                  });
                }}
                className="rounded border border-cyan-500/40 px-1.5 py-1 text-cyan-400 hover:border-cyan-400"
              >
                Use
              </button>
              <button
                type="button"
                title="Retry health check"
                onClick={() => void checkApi().then(() => refreshRemote())}
                className="rounded border border-navy-600 px-1.5 py-1 text-ink-300 hover:border-cyan-500/50"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              className="text-cyan-400 hover:underline"
              onClick={() => {
                clearApiBaseOverride();
                setApiUrlDraft(getApiBase());
                void checkApi();
              }}
            >
              Reset URL to auto
            </button>
          </div>
        )}
        {apiStatus !== "down" && remoteItems.length === 0 && (
          <p className="text-[11px] text-ink-400">
            No workspaces yet. Apply to create one.
          </p>
        )}
        {remoteItems.map((w) => {
          const active = w.workspaceId === document.workspace.id;
          const busy = deletingId === w.workspaceId || deletingId === "bulk-remote";
          return (
            <div
              key={w.workspaceId}
              className={`flex w-full items-start gap-1 rounded-lg border px-1 py-1 transition ${
                active
                  ? "border-cyan-500/60 bg-cyan-500/10"
                  : "border-transparent hover:border-navy-600 hover:bg-navy-800"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedRemote.has(w.workspaceId)}
                onChange={() => toggleRemote(w.workspaceId)}
                className="mt-2 shrink-0 rounded border-navy-600"
                title="Select for bulk delete"
              />
              <button
                type="button"
                onClick={() => void loadFromBackend(w.workspaceId)}
                className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5 text-left"
              >
                <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-ink-100">
                    {w.name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-ink-400">
                    {w.workspaceId} · v{w.currentVersion}
                  </div>
                </div>
              </button>
              <button
                type="button"
                title="Delete from MongoDB"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void deleteRemote(w);
                }}
                className="mt-1 shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-danger/15 hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        <span className="flex items-center gap-1.5">
          <HardDrive className="h-3 w-3" />
          Local cache
        </span>
        {localItems.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1 font-normal normal-case text-ink-500">
            <input
              type="checkbox"
              checked={allLocalSelected}
              onChange={() => {
                if (allLocalSelected) setSelectedLocal(new Set());
                else setSelectedLocal(new Set(localItems.map((w) => w.id)));
              }}
              className="rounded border-navy-600"
            />
            <span className="text-[10px]">All</span>
          </label>
        )}
      </div>
      {(selectedLocal.size > 0 || localItems.length > 1) && (
        <div className="mb-2 flex gap-1.5">
          {selectedLocal.size > 0 && (
            <button
              type="button"
              disabled={deletingId !== null}
              onClick={() => void deleteLocalSelected()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[10px] text-danger hover:bg-danger/20 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              Delete {selectedLocal.size} selected
            </button>
          )}
          {localItems.length > 1 && (
            <button
              type="button"
              disabled={deletingId !== null}
              onClick={() => void clearAllLocal()}
              className="rounded-md border border-navy-600 px-2 py-1.5 text-[10px] text-ink-400 hover:border-danger/40 hover:text-danger disabled:opacity-50"
            >
              Clear all
            </button>
          )}
        </div>
      )}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {localItems.length === 0 && (
          <p className="text-[11px] text-ink-400">
            IndexedDB cache for offline edit.
          </p>
        )}
        {localItems.map((w) => {
          const active = w.id === document.workspace.id;
          const busy = deletingId === w.id || deletingId === "bulk-local";
          return (
            <div
              key={w.id}
              className={`flex w-full items-start gap-1 rounded-lg border px-1 py-1 transition ${
                active
                  ? "border-navy-600 bg-navy-800"
                  : "border-transparent hover:border-navy-600 hover:bg-navy-800"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedLocal.has(w.id)}
                onChange={() => toggleLocal(w.id)}
                className="mt-2 shrink-0 rounded border-navy-600"
                title="Select for bulk delete"
              />
              <button
                type="button"
                onClick={() => loadDocument(w.document)}
                className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5 text-left"
              >
                <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-ink-100">
                    {w.name}
                    {active && isDirty ? " ·" : ""}
                  </div>
                  <div className="truncate font-mono text-[10px] text-ink-400">
                    {w.id}
                  </div>
                </div>
              </button>
              <button
                type="button"
                title="Remove from local cache"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void deleteLocal(w);
                }}
                className="mt-1 shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-danger/15 hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
