/**
 * Per-workspace folder on the API machine.
 *
 *   data/workspaces/<workspaceId>/
 *     memory.json          latest input/output of every node
 *     brain.json           Workspace Brain model (API key mode 0600)
 *     chat.json            persistent brain conversation
 *     logs/success.log
 *     logs/failure.log
 *     executions/<id>/snapshot.json   kept to the last 5
 *
 * Writes go to a temp file in the same directory, then rename.
 * A lock file serializes writers across processes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { studioLlmDefaults } from "./studioSetup.js";
import type { RunNodeOutput, WorkspaceDocument } from "../types.js";

export const MAX_EXECUTIONS = 5;
const MAX_VALUE_CHARS = 200_000;

export type NodeRunStatus = "success" | "failed" | "running" | "skipped";

export interface NodeMemoryEntry {
  nodeId: string;
  label?: string;
  nodeType?: string;
  status: NodeRunStatus;
  updatedAt: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  truncated?: boolean;
}

export interface MemoryFile {
  workspaceId: string;
  updatedAt: string;
  nodes: Record<string, NodeMemoryEntry>;
}

export interface ExecutionSummary {
  executionId: string;
  runId: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  nodeCount: number;
  error?: string;
}

export interface ExecutionSnapshot extends ExecutionSummary {
  workspaceId: string;
  graph: {
    name?: string;
    nodes: unknown[];
    edges: unknown[];
  };
  nodeIo: NodeMemoryEntry[];
  logs: { excerpt: string };
}

export interface BrainConfig {
  provider: string;
  model: string;
  baseUrl: string;
  /** Present only on disk. API responses mask this. */
  apiKey?: string;
}

export interface BrainChatTurn {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

let rootOverride: string | null = null;

export function localWorkspacesRoot(): string {
  return rootOverride ?? config.localWorkspacesRoot;
}

/** Tests point the store at a temp directory. */
export function setLocalWorkspacesRootForTests(dir: string | null): void {
  rootOverride = dir;
}

export function assertWorkspaceId(workspaceId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(workspaceId)) {
    throw Object.assign(new Error("Invalid workspace id"), { statusCode: 400 });
  }
  return workspaceId;
}

export function workspaceDir(workspaceId: string): string {
  const id = assertWorkspaceId(workspaceId);
  const root = path.resolve(localWorkspacesRoot());
  const dir = path.resolve(root, id);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw Object.assign(new Error("Workspace path escaped the data root"), {
      statusCode: 400,
    });
  }
  return dir;
}

async function writeAtomic(file: string, text: string, mode = 0o644): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmp, text, { mode });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await fs.chmod(file, mode).catch(() => undefined);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fallback;
    throw err;
  }
}

const chains = new Map<string, Promise<unknown>>();

/** One writer at a time in this process, and a lock file for other processes. */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(dir) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    await fs.mkdir(dir, { recursive: true });
    const lock = path.join(dir, ".lock");
    const deadline = Date.now() + 8_000;
    for (;;) {
      try {
        const fh = await fs.open(lock, "wx");
        try {
          return await fn();
        } finally {
          await fh.close().catch(() => undefined);
          await fs.rm(lock, { force: true }).catch(() => undefined);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw err;
        try {
          const st = await fs.stat(lock);
          if (Date.now() - st.mtimeMs > 30_000) await fs.rm(lock, { force: true });
        } catch {
          /* lock disappeared */
        }
        if (Date.now() > deadline) {
          throw Object.assign(new Error("Workspace folder is busy"), { statusCode: 503 });
        }
        await new Promise((r) => setTimeout(r, 40));
      }
    }
  });
  chains.set(
    dir,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function clip(value: unknown): { value: unknown; truncated: boolean } {
  let truncated = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 8) return "[depth limit]";
    if (typeof v === "string" && v.length > 8_000) {
      truncated = true;
      return `${v.slice(0, 8_000)}…`;
    }
    if (Array.isArray(v)) {
      const head = v.slice(0, 40).map((item) => walk(item, depth + 1));
      if (v.length > 40) {
        truncated = true;
        head.push(`… ${v.length - 40} more`);
      }
      return head;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      const entries = Object.entries(v as Record<string, unknown>).slice(0, 40);
      if (Object.keys(v as object).length > 40) truncated = true;
      for (const [k, child] of entries) out[k] = walk(child, depth + 1);
      return out;
    }
    return v;
  };
  const walked = walk(value, 0);
  const text = JSON.stringify(walked);
  if (text && text.length > MAX_VALUE_CHARS) {
    return { value: text.slice(0, MAX_VALUE_CHARS), truncated: true };
  }
  return { value: walked, truncated };
}

function emptyMemory(workspaceId: string): MemoryFile {
  return { workspaceId, updatedAt: new Date().toISOString(), nodes: {} };
}

export async function readMemory(workspaceId: string): Promise<MemoryFile> {
  const file = path.join(workspaceDir(workspaceId), "memory.json");
  const mem = await readJson<MemoryFile>(file, emptyMemory(workspaceId));
  if (!mem.nodes || typeof mem.nodes !== "object") mem.nodes = {};
  return mem;
}

export async function readBrain(workspaceId: string): Promise<BrainConfig> {
  const file = path.join(workspaceDir(workspaceId), "brain.json");
  const stored = await readJson<Partial<BrainConfig>>(file, {});
  const fallback = await studioLlmDefaults();
  return {
    provider: stored.provider || fallback?.provider || "ollama",
    model: stored.model || fallback?.model || "llama3.2",
    baseUrl: stored.baseUrl || fallback?.baseUrl || "http://127.0.0.1:11434/v1",
    apiKey: stored.apiKey || fallback?.apiKey || "",
  };
}

export function publicBrain(cfg: BrainConfig): {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeySet: boolean;
} {
  return {
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKeySet: Boolean(cfg.apiKey),
  };
}

export async function writeBrain(
  workspaceId: string,
  patch: Partial<BrainConfig>,
): Promise<BrainConfig> {
  const dir = workspaceDir(workspaceId);
  return withLock(dir, async () => {
    const current = await readBrain(workspaceId);
    const next: BrainConfig = {
      provider: patch.provider?.trim() || current.provider,
      model: patch.model?.trim() || current.model,
      baseUrl: (patch.baseUrl ?? current.baseUrl).trim().replace(/\/$/, ""),
      apiKey: patch.apiKey === undefined ? current.apiKey : patch.apiKey,
    };
    await writeAtomic(
      path.join(dir, "brain.json"),
      JSON.stringify(
        { provider: next.provider, model: next.model, baseUrl: next.baseUrl, apiKey: next.apiKey ?? "" },
        null,
        2,
      ),
      0o600,
    );
    return next;
  });
}

export async function readChat(workspaceId: string): Promise<BrainChatTurn[]> {
  const file = path.join(workspaceDir(workspaceId), "chat.json");
  const data = await readJson<{ turns?: BrainChatTurn[] }>(file, {});
  return Array.isArray(data.turns) ? data.turns.slice(-100) : [];
}

export async function appendChat(
  workspaceId: string,
  turns: BrainChatTurn[],
): Promise<BrainChatTurn[]> {
  const dir = workspaceDir(workspaceId);
  return withLock(dir, async () => {
    const existing = await readChat(workspaceId);
    const next = [...existing, ...turns].slice(-100);
    await writeAtomic(
      path.join(dir, "chat.json"),
      JSON.stringify({ turns: next }, null, 2),
    );
    return next;
  });
}

function nodeLabel(node: Record<string, unknown>): string | undefined {
  return typeof node.label === "string" ? node.label : undefined;
}

export function buildNodeMemory(input: {
  document?: WorkspaceDocument;
  nodeOutputs: RunNodeOutput[];
  status: "succeeded" | "failed";
  error?: string;
  startedAt: string;
  finishedAt: string;
}): NodeMemoryEntry[] {
  const nodes = input.document?.flow.nodes ?? [];
  const edges = (input.document?.flow.edges ?? []) as Array<{ source?: string; target?: string }>;
  const byId = new Map<string, RunNodeOutput>();
  for (const doc of input.nodeOutputs) byId.set(doc.nodeId, doc);
  const err = input.error ?? "";

  const outputOf = (id: string): unknown => {
    const doc = byId.get(id);
    if (!doc) return undefined;
    return doc.json ?? doc.result ?? doc.text ?? doc.summary;
  };

  return nodes
    .map((node) => {
      const id = String(node.id ?? "");
      if (!id) return null;
      const doc = byId.get(id);
      const mentioned = err.includes(id);
      let status: NodeRunStatus = "skipped";
      if (doc) status = "success";
      else if (input.status === "failed" && mentioned) status = "failed";
      else if (input.status === "failed" && nodes.length === 1) status = "failed";

      const upstream = edges
        .filter((e) => e.target === id && e.source)
        .map((e) => ({ from: e.source as string, value: outputOf(e.source as string) }));
      const inputClip = clip(upstream.length ? upstream : undefined);
      const outputClip = clip(doc ? (doc.json ?? doc.result ?? doc.content) : undefined);
      const entry: NodeMemoryEntry = {
        nodeId: id,
        label: nodeLabel(node) ?? doc?.nodeName,
        nodeType: typeof node.type === "string" ? node.type : doc?.nodeType,
        status,
        updatedAt: input.finishedAt,
        input: inputClip.value,
        output: outputClip.value,
        truncated: inputClip.truncated || outputClip.truncated || undefined,
      };
      if (status === "failed") entry.error = err.slice(0, 2_000) || "Run failed";
      return entry;
    })
    .filter((e): e is NodeMemoryEntry => Boolean(e));
}

export async function recordWorkspaceRun(input: {
  workspaceId: string;
  runId: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  error?: string;
  document?: WorkspaceDocument;
  nodeOutputs: RunNodeOutput[];
  logExcerpt?: string;
}): Promise<ExecutionSummary> {
  const dir = workspaceDir(input.workspaceId);
  return withLock(dir, async () => {
    const entries = buildNodeMemory(input);
    const memory = await readMemory(input.workspaceId);
    for (const entry of entries) memory.nodes[entry.nodeId] = entry;
    // Nodes removed from the graph stay in memory so the brain can still explain them.
    memory.updatedAt = input.finishedAt;
    memory.workspaceId = input.workspaceId;
    await writeAtomic(path.join(dir, "memory.json"), JSON.stringify(memory, null, 2));

    const line =
      `[${input.finishedAt}] run=${input.runId} status=${input.status} nodes=${entries.length}` +
      (input.error ? ` error=${input.error.replace(/\s+/g, " ").slice(0, 400)}` : "") +
      "\n";
    const logName = input.status === "succeeded" ? "success.log" : "failure.log";
    const logsDir = path.join(dir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(path.join(logsDir, logName), line, "utf8");
    for (const entry of entries) {
      await fs.appendFile(
        path.join(logsDir, logName),
        `[${input.finishedAt}] node=${entry.nodeId} type=${entry.nodeType ?? ""} status=${entry.status}\n`,
        "utf8",
      );
    }

    const executionId = `exec_${nanoid(10)}`;
    const summary: ExecutionSummary = {
      executionId,
      runId: input.runId,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      nodeCount: entries.length,
      error: input.error?.slice(0, 2_000),
    };
    const snapshot: ExecutionSnapshot = {
      ...summary,
      workspaceId: input.workspaceId,
      graph: {
        name: input.document?.workspace.name,
        nodes: input.document?.flow.nodes ?? [],
        edges: input.document?.flow.edges ?? [],
      },
      nodeIo: entries,
      logs: { excerpt: (input.logExcerpt ?? "").slice(0, 20_000) },
    };
    const execDir = path.join(dir, "executions", executionId);
    await writeAtomic(path.join(execDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
    await pruneExecutions(path.join(dir, "executions"));
    return summary;
  });
}

async function pruneExecutions(execRoot: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(execRoot);
  } catch {
    return;
  }
  const ranked: Array<{ name: string; mtime: number }> = [];
  for (const name of names) {
    if (!name.startsWith("exec_")) continue;
    try {
      const st = await fs.stat(path.join(execRoot, name));
      if (st.isDirectory()) ranked.push({ name, mtime: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  ranked.sort((a, b) => b.mtime - a.mtime);
  for (const old of ranked.slice(MAX_EXECUTIONS)) {
    await fs.rm(path.join(execRoot, old.name), { recursive: true, force: true });
  }
}

export async function listExecutions(workspaceId: string): Promise<ExecutionSummary[]> {
  const execRoot = path.join(workspaceDir(workspaceId), "executions");
  let names: string[] = [];
  try {
    names = await fs.readdir(execRoot);
  } catch {
    return [];
  }
  const out: Array<ExecutionSummary & { mtime: number }> = [];
  for (const name of names) {
    if (!name.startsWith("exec_")) continue;
    const file = path.join(execRoot, name, "snapshot.json");
    try {
      const snap = await readJson<ExecutionSnapshot | null>(file, null);
      const st = await fs.stat(file);
      if (!snap) continue;
      out.push({
        executionId: snap.executionId || name,
        runId: snap.runId,
        status: snap.status,
        startedAt: snap.startedAt,
        finishedAt: snap.finishedAt,
        nodeCount: snap.nodeCount,
        error: snap.error,
        mtime: st.mtimeMs,
      });
    } catch {
      /* unreadable snapshot */
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, MAX_EXECUTIONS).map(({ mtime: _m, ...rest }) => rest);
}

export async function readExecution(
  workspaceId: string,
  executionId: string,
): Promise<ExecutionSnapshot | null> {
  if (!/^exec_[A-Za-z0-9_-]{1,40}$/.test(executionId)) return null;
  const file = path.join(workspaceDir(workspaceId), "executions", executionId, "snapshot.json");
  try {
    return await readJson<ExecutionSnapshot>(file, null as unknown as ExecutionSnapshot);
  } catch {
    return null;
  }
}

export async function readLog(
  workspaceId: string,
  kind: "success" | "failure",
  query?: string,
): Promise<{ kind: string; lines: string[] }> {
  const file = path.join(workspaceDir(workspaceId), "logs", `${kind}.log`);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return { kind, lines: [] };
  }
  let lines = text.split("\n").filter(Boolean);
  const q = query?.trim().toLowerCase();
  if (q) lines = lines.filter((line) => line.toLowerCase().includes(q));
  return { kind, lines: lines.slice(-400) };
}

/** Compact text the Workspace Brain can read without dragging the whole snapshot. */
export async function brainContext(workspaceId: string): Promise<string> {
  const memory = await readMemory(workspaceId);
  const execs = await listExecutions(workspaceId);
  const nodes = Object.values(memory.nodes).slice(0, 40).map((n) => ({
    nodeId: n.nodeId,
    label: n.label,
    type: n.nodeType,
    status: n.status,
    error: n.error,
    input: n.input,
    output: n.output,
  }));
  const payload = {
    memoryUpdatedAt: memory.updatedAt,
    nodes,
    executions: execs.map((e) => ({
      executionId: e.executionId,
      runId: e.runId,
      status: e.status,
      finishedAt: e.finishedAt,
      error: e.error,
    })),
  };
  const text = JSON.stringify(payload, null, 2);
  return text.length > 24_000 ? `${text.slice(0, 24_000)}\n…` : text;
}
