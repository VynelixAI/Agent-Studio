/**
 * First-run studio configuration.
 *
 * Written under the chosen workspace folder:
 *   agent-studio.yaml   machine config (Mongo, paths). API key is not stored here.
 *   AGENT.md            human-readable config, Claude-style. Safe to read and edit notes.
 *   .studio-secret      API key only, mode 0600.
 *
 * On later starts, applyDesktopConfigFromEnv / loadDefaultStudioConfig reads the yaml.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

export type LlmKind = "opensource" | "licensed";
export type MongoMode = "local" | "remote";

export interface StudioSetupInput {
  workspacePath: string;
  llmKind: LlmKind;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  mongoMode: MongoMode;
  databaseName: string;
  databaseUri: string;
}

export interface StudioSetupPublic {
  configured: boolean;
  workspacePath: string;
  configPath: string;
  agentMdPath: string;
  llm: { kind: LlmKind; provider: string; model: string; baseUrl: string; apiKeySet: boolean };
  database: { mode: MongoMode; name: string; uri: string };
}

const SECRET_NAME = ".studio-secret";

export function expandHome(raw: string): string {
  const text = raw.trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

export function resolveWorkspacePath(raw: string): string {
  const expanded = expandHome(raw || "~/AgentStudio");
  if (!path.isAbsolute(expanded)) {
    throw Object.assign(new Error("Workspace path must be absolute (or start with ~)"), {
      statusCode: 400,
    });
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) {
    throw Object.assign(new Error("Refusing to use the filesystem root as the workspace"), {
      statusCode: 400,
    });
  }
  return resolved;
}

export function redactUri(uri: string): string {
  return uri.replace(/(\/\/)([^/@\s]+)@/g, "$1***@");
}

export function mongoModeFromUri(mode: string, uri: string): "local" | "atlas" | "iaas" {
  if (mode === "local") return "local";
  if (uri.trim().startsWith("mongodb+srv://")) return "atlas";
  return "iaas";
}

function defaultBase(kind: LlmKind, provider: string): string {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "grok") return "https://api.x.ai/v1";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (provider === "lmstudio") return "http://127.0.0.1:1234/v1";
  if (provider === "vllm") return "http://127.0.0.1:8000/v1";
  if (kind === "licensed") return "https://api.openai.com/v1";
  return "http://127.0.0.1:11434/v1";
}

async function writeAtomic(file: string, text: string, mode = 0o644): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, { mode });
  await fs.rename(tmp, file);
  await fs.chmod(file, mode).catch(() => undefined);
}

export function renderAgentMd(input: StudioSetupInput, workspacePath: string): string {
  const yamlMode = mongoModeFromUri(input.mongoMode, input.databaseUri);
  return `# Agent Studio

This file is the studio configuration, in the same role as a Claude project file.
The app reads it (and \`agent-studio.yaml\` next to it) every time it starts.
Edit the notes below. Do not paste API keys into this file.

## Workspace

- Default path: \`${workspacePath}\`
- Runs, plugins, memory, and code live under this folder.

## Model

- Kind: ${input.llmKind === "licensed" ? "licensed (cloud)" : "open source (local)"}
- Provider: ${input.provider || (input.llmKind === "licensed" ? "openai" : "ollama")}
- Model name: ${input.model || (input.llmKind === "licensed" ? "gpt-4o-mini" : "llama3.2")}
- Endpoint: ${input.baseUrl || defaultBase(input.llmKind, input.provider)}
- API key: stored in \`.studio-secret\` (not in this file)

The Workspace Brain uses this model. Each canvas node is a tool the workspace agent can call.

## MongoDB

- Deployment: ${input.mongoMode === "local" ? "local" : "remote"} (${yamlMode})
- Database name: ${input.databaseName || "vynelix_agent_studio"}
- URI: \`${redactUri(input.databaseUri)}\`

Workspaces and their code are stored in this database when you Apply after a run.
Restart the API after changing the URI so the server reconnects.

## How a workspace behaves

- Every node is a function: \`execute(items, ctx)\` and \`__call__\`.
- \`tool_spec()\` is the tool description an agent runtime can bind.
- \`call_tool(node_id, items)\` runs one node when you ask. Listing tools does not run them.
- After a test, save the flow to MongoDB (Apply) or convert it to a template.
`;
}

export async function saveStudioSetup(input: StudioSetupInput): Promise<StudioSetupPublic> {
  const workspacePath = resolveWorkspacePath(input.workspacePath);
  const provider = input.provider.trim() || (input.llmKind === "licensed" ? "openai" : "ollama");
  const model = input.model.trim() || (input.llmKind === "licensed" ? "gpt-4o-mini" : "llama3.2");
  const baseUrl = (input.baseUrl.trim() || defaultBase(input.llmKind, provider)).replace(/\/$/, "");
  const dbName = input.databaseName.trim() || "vynelix_agent_studio";
  const dbUri =
    input.databaseUri.trim() ||
    (input.mongoMode === "local" ? "mongodb://127.0.0.1:27017" : "");
  if (!dbUri) {
    throw Object.assign(new Error("MongoDB URI is required for a remote database"), {
      statusCode: 400,
    });
  }
  const yamlMode = mongoModeFromUri(input.mongoMode, dbUri);
  const doc = {
    workspace: { path: workspacePath },
    backend: { host: "127.0.0.1", port: 8787, api_url: "http://127.0.0.1:8787" },
    database: { mode: yamlMode, name: dbName, uri: dbUri },
    llm: {
      kind: input.llmKind,
      provider,
      model,
      base_url: baseUrl,
    },
    connectors: {
      mongodb_default_database: dbName,
      notes: "See AGENT.md. API key is in .studio-secret.",
    },
    setup_complete: true,
  };
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(path.join(workspacePath, "data", "runs"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "data", "plugins"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "data", "workspaces"), { recursive: true });
  const configPath = path.join(workspacePath, "agent-studio.yaml");
  const agentMdPath = path.join(workspacePath, "AGENT.md");
  await writeAtomic(configPath, yaml.dump(doc, { lineWidth: 120 }));
  await writeAtomic(
    agentMdPath,
    renderAgentMd(
      { ...input, provider, model, baseUrl, databaseName: dbName, databaseUri: dbUri },
      workspacePath,
    ),
  );
  if (input.apiKey !== undefined) {
    await writeAtomic(
      path.join(workspacePath, SECRET_NAME),
      JSON.stringify({ apiKey: input.apiKey }),
      0o600,
    );
  }
  return readStudioSetup(workspacePath);
}

export async function readStudioSetup(explicitPath?: string): Promise<StudioSetupPublic> {
  const candidates = [
    explicitPath,
    process.env.AGENT_STUDIO_CONFIG
      ? path.dirname(process.env.AGENT_STUDIO_CONFIG)
      : "",
    path.join(os.homedir(), "AgentStudio"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    const configPath = path.join(dir, "agent-studio.yaml");
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const doc = yaml.load(raw) as {
        workspace?: { path?: string };
        database?: { mode?: string; name?: string; uri?: string };
        llm?: { kind?: string; provider?: string; model?: string; base_url?: string };
        setup_complete?: boolean;
      };
      if (!doc || typeof doc !== "object" || !doc.setup_complete) continue;
      let apiKeySet = false;
      try {
        await fs.access(path.join(dir, SECRET_NAME));
        apiKeySet = true;
      } catch {
        apiKeySet = false;
      }
      const mode = doc.database?.mode === "local" ? "local" : "remote";
      const kind: LlmKind = doc.llm?.kind === "licensed" ? "licensed" : "opensource";
      return {
        configured: true,
        workspacePath: String(doc.workspace?.path || dir),
        configPath,
        agentMdPath: path.join(dir, "AGENT.md"),
        llm: {
          kind,
          provider: doc.llm?.provider || "ollama",
          model: doc.llm?.model || "llama3.2",
          baseUrl: doc.llm?.base_url || defaultBase(kind, doc.llm?.provider || "ollama"),
          apiKeySet,
        },
        database: {
          mode,
          name: doc.database?.name || "vynelix_agent_studio",
          uri: redactUri(String(doc.database?.uri || "")),
        },
      };
    } catch {
      /* try next */
    }
  }
  return {
    configured: false,
    workspacePath: path.join(os.homedir(), "AgentStudio"),
    configPath: "",
    agentMdPath: "",
    llm: {
      kind: "opensource",
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeySet: false,
    },
    database: { mode: "local", name: "vynelix_agent_studio", uri: "mongodb://127.0.0.1:27017" },
  };
}

/** LLM defaults for workspaces that have not saved their own brain.json yet. */
export async function studioLlmDefaults(): Promise<{
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
} | null> {
  const pub = await readStudioSetup();
  if (!pub.configured) return null;
  let apiKey = "";
  try {
    const raw = await fs.readFile(path.join(pub.workspacePath, SECRET_NAME), "utf8");
    const parsed = JSON.parse(raw) as { apiKey?: string };
    apiKey = parsed.apiKey || "";
  } catch {
    apiKey = "";
  }
  return {
    provider: pub.llm.provider,
    model: pub.llm.model,
    baseUrl: pub.llm.baseUrl,
    apiKey,
  };
}
