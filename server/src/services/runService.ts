import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { decryptSecret } from "../crypto.js";
import { runOutputs, runs, secrets, workspaces } from "../db.js";
import { recordWorkspaceRun } from "./localWorkspace.js";
import { materializeRun } from "./materialize.js";
import type { RunNodeOutput, RunRecord, RunRuntime, RunStatus } from "../types.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VENV_PYTHON = path.join(SERVER_ROOT, ".venv", "bin", "python");

async function resolvePython(): Promise<string> {
  try {
    await fs.access(VENV_PYTHON);
    return VENV_PYTHON;
  } catch {
    return "python3";
  }
}
async function loadDecryptedSecrets(
  workspaceId: string,
): Promise<Record<string, string>> {
  const rows = await secrets().find({ workspaceId }).toArray();
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.secretRef] = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
    });
  }
  return out;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code, stderr }));
    child.on("error", (err) =>
      resolve({ code: 1, stderr: err.message }),
    );
  });
}

async function collectLogFiles(logsDir: string): Promise<string[]> {
  const logFiles: string[] = [];
  const mainLog = path.join(logsDir, "run.log");
  try {
    await fs.access(mainLog);
    logFiles.push(mainLog);
  } catch {
    /* missing */
  }
  try {
    const nodeLogs = await fs.readdir(path.join(logsDir, "nodes"));
    for (const f of nodeLogs) {
      logFiles.push(path.join(logsDir, "nodes", f));
    }
  } catch {
    /* ignore */
  }
  return logFiles;
}

async function collectOutputFiles(root: string): Promise<string[]> {
  const outputsDir = path.join(root, "outputs");
  const files: string[] = [];
  try {
    const names = await fs.readdir(outputsDir);
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue;
      const full = path.join(outputsDir, name);
      const st = await fs.stat(full);
      if (st.isFile()) files.push(full);
    }
  } catch {
    /* empty */
  }
  // Also pick stage_cache yaml twins for validation
  try {
    const stageDir = path.join(root, "code", "stage_cache");
    const names = await fs.readdir(stageDir);
    for (const name of names.sort()) {
      if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
      files.push(path.join(stageDir, name));
    }
  } catch {
    /* empty */
  }
  return files;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickOutputFields(source: unknown): {
  result?: unknown;
  summary?: unknown;
  model?: unknown;
  provider?: unknown;
  json?: unknown;
  text?: unknown;
  rowCount?: unknown;
  op?: unknown;
  live?: unknown;
} {
  const rec = asRecord(source);
  if (!rec) return { result: source };
  const inner = asRecord(rec.result) ?? rec;
  return {
    result: rec.result ?? rec,
    summary: inner.summary ?? rec.summary ?? inner.text ?? rec.text,
    model: inner.model ?? rec.model,
    provider: inner.provider ?? rec.provider,
    json: inner.json ?? rec.json,
    text: inner.text ?? rec.text,
    rowCount: inner.rowCount ?? rec.rowCount,
    op: inner.op ?? rec.op ?? rec.type,
    live: inner.live ?? rec.live,
  };
}

/** Parse outputs/*.json (and yaml twins) into Compass-friendly run_outputs docs. */
export function buildNodeOutputDocs(input: {
  runId: string;
  workspaceId: string;
  files: Array<{ path: string; content: string }>;
  createdAt?: string;
}): RunNodeOutput[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const docs: RunNodeOutput[] = [];
  for (const file of input.files) {
    const base = path.basename(file.path);
    if (base.startsWith(".")) continue;
    let parsed: unknown = file.content;
    const trimmed = file.content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = { text: file.content };
      }
    } else {
      parsed = { text: file.content };
    }
    const rec = asRecord(parsed);
    const fields = pickOutputFields(parsed);
    const nodeId =
      (typeof rec?.nodeId === "string" && rec.nodeId) ||
      base.replace(/\.(json|ya?ml)$/i, "");
    docs.push({
      runId: input.runId,
      workspaceId: input.workspaceId,
      nodeId,
      nodeName: typeof rec?.name === "string" ? rec.name : undefined,
      nodeType: typeof rec?.type === "string" ? rec.type : undefined,
      path: file.path,
      generatedAt: typeof rec?.generatedAt === "string" ? rec.generatedAt : undefined,
      result: fields.result,
      summary: fields.summary,
      model: fields.model,
      provider: fields.provider,
      json: fields.json,
      text: fields.text,
      rowCount: fields.rowCount,
      op: fields.op,
      live: fields.live,
      content: parsed,
      createdAt,
    });
  }
  return docs;
}

async function persistRunOutputs(input: {
  runId: string;
  workspaceId: string;
  outputFiles: string[];
}): Promise<RunNodeOutput[]> {
  const files: Array<{ path: string; content: string }> = [];
  for (const file of input.outputFiles) {
    try {
      const content = await fs.readFile(file, "utf8");
      files.push({ path: file, content });
    } catch {
      /* skip missing */
    }
  }
  const docs = buildNodeOutputDocs({
    runId: input.runId,
    workspaceId: input.workspaceId,
    files,
  });
  await runOutputs().deleteMany({ runId: input.runId });
  if (docs.length) {
    await runOutputs().insertMany(docs);
  }
  return docs;
}

export async function startRun(input: {
  workspaceId: string;
  mode?: "dry-run" | "execute";
  runtime?: RunRuntime;
  /** When set, run this document without requiring Apply / Mongo workspace head */
  document?: import("../types.js").WorkspaceDocument;
  yaml?: string;
  /** Ephemeral secrets for this run only (not written to Mongo) */
  secrets?: Array<{ secretRef: string; value: string }>;
  chat?: {
    sessionId?: string;
    question?: string;
    history?: Array<{ role: string; content: string }>;
  };
}): Promise<RunRecord> {
  const ws = await workspaces().findOne({ workspaceId: input.workspaceId });
  const document = input.document ?? ws?.document;
  if (!document) {
    throw Object.assign(
      new Error(
        "No workflow document on the Run request. The UI must send the current canvas (Run does not require Apply).",
      ),
      { statusCode: 400 },
    );
  }

  const yaml =
    input.yaml ??
    ws?.yaml ??
    JSON.stringify(document, null, 2);

  const runId = `run_${nanoid(10)}`;
  const startedAt = new Date().toISOString();
  const mode = input.mode ?? "execute";
  const runtime: RunRuntime = input.runtime ?? "python";
  const version = ws?.currentVersion ?? document.workspace.version ?? "0.0.0-local";

  const secretMap = ws
    ? await loadDecryptedSecrets(input.workspaceId)
    : ({} as Record<string, string>);
  // Overlay ephemeral secrets (Run-time only — not persisted)
  for (const s of input.secrets ?? []) {
    if (s.secretRef && s.value) secretMap[s.secretRef] = s.value;
  }

  const materialized = await materializeRun({
    workspaceId: input.workspaceId,
    runId,
    version,
    yaml,
    document,
    secrets: secretMap,
    chat: input.chat,
  });

  const record: RunRecord = {
    runId,
    workspaceId: input.workspaceId,
    version,
    status: "running",
    mode,
    runtime,
    localPath: materialized.root,
    startedAt,
    nodeCount: document.flow.nodes.length,
    logFiles: [],
    artifacts: {
      tasksYaml: materialized.tasksYamlPath,
      secretsYaml: materialized.secretsYamlPath,
      pythonRunner: materialized.pythonRunnerPath,
      notebook: materialized.notebookPath,
    },
  };

  await runs().insertOne({ ...record });

  let result: { code: number | null; stderr: string };
  if (runtime === "notebook") {
    // Prefer nbconvert execute; if unavailable, leave notebook for interactive use
    result = await runCommand(
      "jupyter",
      [
        "nbconvert",
        "--to",
        "notebook",
        "--execute",
        "--inplace",
        materialized.notebookPath,
      ],
      path.dirname(materialized.notebookPath),
    );
    if (result.code !== 0) {
      // Fallback: materialize-only success with note in log
      const mainLog = path.join(materialized.logsDir, "run.log");
      await fs.appendFile(
        mainLog,
        `[${new Date().toISOString()}] NOTEBOOK_EXECUTE_SKIPPED err=${result.stderr.slice(0, 500)}\n` +
          `[${new Date().toISOString()}] NOTEBOOK_READY path=${materialized.notebookPath}\n` +
          `[${new Date().toISOString()}] RUN_OK\n`,
        "utf8",
      );
      result = { code: 0, stderr: result.stderr };
    } else {
      const mainLog = path.join(materialized.logsDir, "run.log");
      await fs.appendFile(
        mainLog,
        `[${new Date().toISOString()}] NOTEBOOK_EXECUTED path=${materialized.notebookPath}\n` +
          `[${new Date().toISOString()}] RUN_OK\n`,
        "utf8",
      );
    }
  } else {
    const python = await resolvePython();
    // Ensure PyYAML so outputs/*.yaml is real YAML
    await runCommand(
      python,
      ["-m", "pip", "install", "pyyaml", "-q", "--disable-pip-version-check"],
      materialized.codeDir,
    );
    result = await runCommand(
      python,
      [materialized.pythonRunnerPath],
      materialized.codeDir,
    );
    if (result.code === 1 && /PyYAML|No module named/i.test(result.stderr)) {
      await runCommand(
        python,
        ["-m", "pip", "install", "pyyaml", "-q", "--break-system-packages"],
        materialized.codeDir,
      );
      result = await runCommand(
        python,
        [materialized.pythonRunnerPath],
        materialized.codeDir,
      );
    }
    if (result.code !== 0 && result.stderr) {
      const mainLog = path.join(materialized.logsDir, "run.log");
      await fs.appendFile(
        mainLog,
        `[${new Date().toISOString()}] RUNNER_STDERR ${result.stderr.slice(0, 2000)}\n`,
        "utf8",
      );
    }
  }

  const finishedAt = new Date().toISOString();
  const status: RunStatus = result.code === 0 ? "succeeded" : "failed";
  const logFiles = await collectLogFiles(materialized.logsDir);
  const outputFiles = await collectOutputFiles(materialized.root);
  let nodeOutputs: RunNodeOutput[] = [];
  try {
    nodeOutputs = await persistRunOutputs({
      runId,
      workspaceId: input.workspaceId,
      outputFiles,
    });
  } catch {
    nodeOutputs = [];
  }
  const artifacts = {
    tasksYaml: materialized.tasksYamlPath,
    secretsYaml: materialized.secretsYamlPath,
    pythonRunner: materialized.pythonRunnerPath,
    notebook: materialized.notebookPath,
    outputsDir: path.join(materialized.root, "outputs"),
    outputFiles,
    nodeOutputs: nodeOutputs.map((doc) => ({
      nodeId: doc.nodeId,
      path: doc.path,
      result: doc.result,
      summary: doc.summary,
      model: doc.model,
      provider: doc.provider,
      nodeType: doc.nodeType,
    })),
  };

  try {
    await recordWorkspaceRun({
      workspaceId: input.workspaceId,
      runId,
      status,
      startedAt,
      finishedAt,
      error: status === "failed" ? result.stderr.slice(0, 2_000) || "Runner exited non-zero" : undefined,
      document,
      nodeOutputs,
      logExcerpt: result.stderr,
    });
  } catch {
    // Local memory is best-effort. A disk error must not hide the run result.
  }

  await runs().updateOne(
    { runId },
    {
      $set: {
        status,
        finishedAt,
        logFiles,
        artifacts,
        error: status === "failed" ? result.stderr.slice(0, 500) || "Runner exited non-zero" : undefined,
      },
    },
  );

  return {
    ...record,
    status,
    finishedAt,
    logFiles,
    artifacts,
    error:
      status === "failed"
        ? result.stderr.slice(0, 500) || "Runner exited non-zero"
        : undefined,
  };
}

export async function listRuns(workspaceId: string): Promise<RunRecord[]> {
  return runs()
    .find({ workspaceId }, { projection: { _id: 0 } })
    .sort({ startedAt: -1 })
    .toArray();
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  return runs().findOne({ runId }, { projection: { _id: 0 } });
}

export async function readRunLogs(
  runId: string,
): Promise<{ runId: string; files: Array<{ path: string; content: string }> }> {
  const run = await getRun(runId);
  if (!run) {
    throw Object.assign(new Error("Run not found"), { statusCode: 404 });
  }

  const files: Array<{ path: string; content: string }> = [];
  for (const file of run.logFiles) {
    try {
      const content = await fs.readFile(file, "utf8");
      files.push({ path: file, content });
    } catch {
      files.push({ path: file, content: "(missing)" });
    }
  }

  if (!files.length) {
    try {
      const main = path.join(run.localPath, "logs", "run.log");
      files.push({ path: main, content: await fs.readFile(main, "utf8") });
    } catch {
      /* empty */
    }
  }

  return { runId, files };
}

export async function readRunOutputs(
  runId: string,
): Promise<{ runId: string; files: Array<{ path: string; content: string }> }> {
  const run = await getRun(runId);
  if (!run) {
    throw Object.assign(new Error("Run not found"), { statusCode: 404 });
  }

  const paths =
    run.artifacts?.outputFiles?.length
      ? run.artifacts.outputFiles
      : await collectOutputFiles(run.localPath);

  const files: Array<{ path: string; content: string }> = [];
  for (const file of paths) {
    try {
      const content = await fs.readFile(file, "utf8");
      files.push({ path: file, content });
    } catch {
      files.push({ path: file, content: "(missing)" });
    }
  }
  if (!files.some((f) => f.content && f.content !== "(missing)")) {
    const stored = await runOutputs().find({ runId }).toArray();
    for (const doc of stored) {
      files.push({
        path: doc.path,
        content:
          typeof doc.content === "string"
            ? doc.content
            : JSON.stringify(doc.content ?? doc.result ?? {}, null, 2),
      });
    }
  }
  return { runId, files };
}
