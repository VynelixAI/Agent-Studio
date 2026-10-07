import { BRAIN_PROVIDER_OPTIONS } from "@/core/brainProviders";
import { api, setApiBase } from "@/lib/api";
import {
  completeDesktopSetup,
  getAppConfigDir,
  getDefaultWorkspacePath,
  getDesktopStatus,
  isTauriRuntime,
  openConfigFolder,
  type DesktopStatus,
  type MongoDeployMode,
} from "@/lib/tauriDesktop";
import { useStudioStore } from "@/store/studioStore";
import { Cloud, Database, FolderOpen, HardDrive, Loader2, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const SETUP_KEY = "vynelix-studio-setup";

type LlmKind = "opensource" | "licensed";

const OPEN_SOURCE = BRAIN_PROVIDER_OPTIONS.filter((p) => !p.needsKey);
const LICENSED = BRAIN_PROVIDER_OPTIONS.filter((p) => p.needsKey);

const MODE_PRESETS: Record<
  MongoDeployMode,
  { label: string; hint: string; uri: string }
> = {
  local: {
    label: "Local",
    hint: "MongoDB on this machine (Docker / brew / Windows service)",
    uri: "mongodb://127.0.0.1:27017",
  },
  atlas: {
    label: "Atlas",
    hint: "MongoDB Atlas (mongodb+srv://…)",
    uri: "mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority",
  },
  iaas: {
    label: "IaaS / remote",
    hint: "Self-hosted or cloud VM MongoDB",
    uri: "mongodb://USER:PASSWORD@HOST:27017/?authSource=admin",
  },
};

export function DesktopSetupModal() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [appConfigDir, setAppConfigDir] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [mongoMode, setMongoMode] = useState<MongoDeployMode>("local");
  const [dbName, setDbName] = useState("vynelix_agent_studio");
  const [dbUri, setDbUri] = useState(MODE_PRESETS.local.uri);
  const [apiPort, setApiPort] = useState(8787);
  const [llmKind, setLlmKind] = useState<LlmKind>("opensource");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("llama3.2");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434/v1");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushLog = useStudioStore((s) => s.pushLog);
  const checkApi = useStudioStore((s) => s.checkApi);

  const preset = useMemo(() => MODE_PRESETS[mongoMode], [mongoMode]);

  useEffect(() => {
    void (async () => {
      let already = false;
      try {
        already = localStorage.getItem(SETUP_KEY) === "1";
      } catch {
        already = false;
      }
      try {
        const remote = await api.getStudioSetup();
        if (remote.configured) {
          try {
            localStorage.setItem(SETUP_KEY, "1");
          } catch {
            /* ignore */
          }
          already = true;
        }
      } catch {
        /* API offline — local flag still decides */
      }
      if (!isTauriRuntime()) {
        if (!already) {
          setWorkspacePath("~/AgentStudio");
          setOpen(true);
        }
        return;
      }
      try {
        const [def, dir, st] = await Promise.all([
          getDefaultWorkspacePath(),
          getAppConfigDir(),
          getDesktopStatus(),
        ]);
        setAppConfigDir(dir);
        setStatus(st);
        setWorkspacePath(st.workspacePath || def);
        setDbName(st.config.database.name || "vynelix_agent_studio");
        const mode = (st.config.database.mode as MongoDeployMode) || "local";
        setMongoMode(
          mode === "atlas" || mode === "iaas" || mode === "local" ? mode : "local",
        );
        setDbUri(
          st.config.database.uri ||
            MODE_PRESETS[
              mode === "atlas" || mode === "iaas" ? mode : "local"
            ].uri,
        );
        setApiPort(st.config.backend.port || 8787);
        if (st.setupNeeded || !already) {
          setOpen(true);
        } else if (st.backendApiUrl) {
          setApiBase(st.backendApiUrl);
          void checkApi();
          pushLog({
            level: "info",
            message: `Desktop: API ${st.backendApiUrl} · config ${st.configPath}`,
          });
        }
      } catch (err) {
        // If status fails, still force setup so packaged builds never soft-skip
        setOpen(true);
        pushLog({
          level: "warn",
          message:
            err instanceof Error
              ? err.message
              : "Desktop status unavailable — opening setup",
        });
      }
    })();
  }, [checkApi, pushLog]);

  if (!open) return null;

  const providers = llmKind === "licensed" ? LICENSED : OPEN_SOURCE;

  const onKind = (kind: LlmKind) => {
    setLlmKind(kind);
    const list = kind === "licensed" ? LICENSED : OPEN_SOURCE;
    const first = list[0];
    if (first) {
      setProvider(first.id);
      setModel(first.model);
      setBaseUrl(first.baseUrl);
    }
  };

  const onModeChange = (mode: MongoDeployMode) => {
    setMongoMode(mode);
    // Only replace URI when it still looks like a preset / empty
    const current = dbUri.trim();
    const looksPreset = Object.values(MODE_PRESETS).some((p) => p.uri === current);
    if (!current || looksPreset || current.includes("USER:PASSWORD")) {
      setDbUri(MODE_PRESETS[mode].uri);
    }
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const path =
        workspacePath.trim() ||
        (isTauriRuntime() ? await getDefaultWorkspacePath() : "~/AgentStudio");
      const apiUrl = `http://127.0.0.1:${apiPort}`;
      if (isTauriRuntime()) {
      const next = await completeDesktopSetup({
        workspacePath: path,
        mongoMode,
        databaseName: dbName.trim() || "vynelix_agent_studio",
        databaseUri: dbUri.trim() || MODE_PRESETS[mongoMode].uri,
        backendPort: apiPort,
        apiUrl,
        mongodbDefaultDatabase: dbName.trim() || "vynelix_agent_studio",
        connectorNotes: `Mongo mode=${mongoMode}. Edit agent-studio.yaml under the app config folder (and workspace mirror) then restart.`,
      });
      setStatus(next);
      setApiBase(next.backendApiUrl);
      void checkApi();
      pushLog({
        level: "info",
        message: `Setup saved · ${next.configPath} · backend ready=${next.backendReady}`,
      });
      }
      const mongoModeForApi = mongoMode === "local" ? "local" : "remote";
      await api.saveStudioSetup({
        workspacePath: path,
        llmKind,
        provider,
        model,
        baseUrl,
        apiKey: apiKey.trim() || undefined,
        mongoMode: mongoModeForApi,
        databaseName: dbName.trim() || "vynelix_agent_studio",
        databaseUri: dbUri.trim() || MODE_PRESETS[mongoMode].uri,
      });
      try {
        localStorage.setItem(SETUP_KEY, "1");
      } catch {
        /* ignore */
      }
      pushLog({
        level: "info",
        message: "Setup saved. AGENT.md and agent-studio.yaml are in the workspace folder. Restart the API if you changed MongoDB.",
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/85 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-navy-600 bg-navy-900 shadow-2xl">
        <div className="border-b border-navy-700 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink-100">
            Agent Studio — first-run setup
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            Required once. Choose the workspace folder, the model (open source or
            licensed), and MongoDB (local or remote). Next launch reads{" "}
            <code className="text-cyan-400">AGENT.md</code> and{" "}
            <code className="text-cyan-400">agent-studio.yaml</code> (Windows:{" "}
            <code className="text-ink-300">%ProgramData%\AgentStudio</code> +{" "}
            <code className="text-ink-300">Program Files\AgentStudio</code> when
            permitted; macOS/Linux: Application Support /{" "}
            <code className="text-ink-300">~/.config/AgentStudio</code>).
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              <FolderOpen className="h-3 w-3" />
              Workspace path (runs / plugins)
            </span>
            <input
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="Leave blank → ~/AgentStudio"
              className="w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            />
            <span className="mt-1 block text-[10px] text-ink-500">
              Default is your home directory folder{" "}
              <code className="text-ink-300">AgentStudio</code>.
            </span>
          </label>

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              <HardDrive className="h-3 w-3" />
              MongoDB deployment
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(MODE_PRESETS) as MongoDeployMode[]).map((mode) => {
                const active = mongoMode === mode;
                const Icon =
                  mode === "local" ? Server : mode === "atlas" ? Cloud : Database;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onModeChange(mode)}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition ${
                      active
                        ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                        : "border-navy-600 text-ink-300 hover:border-navy-500"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {MODE_PRESETS[mode].label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-500">{preset.hint}</p>
          </div>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              <Database className="h-3 w-3" />
              Database name
            </span>
            <input
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              className="w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              MongoDB connection URI
            </span>
            <textarea
              value={dbUri}
              onChange={(e) => setDbUri(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-[11px] outline-none focus:border-cyan-500"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-ink-400">
              Model
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["opensource", "Open source"],
                  ["licensed", "Licensed"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onKind(id)}
                  className={`rounded-lg border px-2.5 py-2 text-left text-[11px] ${
                    llmKind === id
                      ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                      : "border-navy-600 text-ink-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={provider}
              onChange={(e) => {
                const next = providers.find((p) => p.id === e.target.value);
                setProvider(e.target.value);
                if (next) {
                  setModel(next.model);
                  setBaseUrl(next.baseUrl);
                }
              }}
              className="mt-2 w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 text-xs outline-none focus:border-cyan-500"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model name"
              className="mt-2 w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Endpoint"
              className="mt-2 w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-[11px] outline-none focus:border-cyan-500"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={llmKind === "opensource" ? "API key optional for local models" : "API key"}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            />
          </div>

          <label className="block">
            <span className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              Backend API port
            </span>
            <input
              type="number"
              value={apiPort}
              onChange={(e) => setApiPort(Number(e.target.value) || 8787)}
              className="w-full rounded-md border border-navy-600 bg-navy-950 px-2.5 py-2 font-mono text-xs outline-none focus:border-cyan-500"
            />
          </label>

          <div className="rounded-md border border-navy-700 bg-navy-950/60 px-2.5 py-2 text-[10px] leading-relaxed text-ink-400">
            <div>
              Writes <code className="text-cyan-400">AGENT.md</code> and{" "}
              <code className="text-cyan-400">agent-studio.yaml</code> in the workspace folder.
              The API key goes in <code className="text-ink-300">.studio-secret</code>, not the markdown.
            </div>
            {isTauriRuntime() && (
              <button
                type="button"
                className="mt-1 text-cyan-400/80 hover:underline"
                onClick={() => void openConfigFolder()}
              >
                Open config folder
                {appConfigDir ? ` (${status?.configPath || appConfigDir})` : ""}
              </button>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-navy-700 px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSubmit()}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save & start backend
          </button>
        </div>
      </div>
    </div>
  );
}
