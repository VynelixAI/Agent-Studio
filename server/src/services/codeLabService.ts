import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { buildPythonRunner } from "../codegen/pythonRunner.js";
import { buildStageDatasetPy } from "../codegen/stageDatasetPy.js";
import { buildStudioConnectorsPy } from "../codegen/studioConnectorsPy.js";
import { dumpSecretsLocalYaml, dumpTasksYaml, buildTasksFile } from "../codegen/tasksYaml.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto.js";
import { secrets, workspaces } from "../db.js";
import type { WorkspaceDocument } from "../types.js";
import { assertSafeIdentifier, assertSafeSecretRef, assertWorkspaceDocument } from "../security/identifiers.js";
import { resolvePythonExecutable, runProcess } from "./processRunner.js";

export type CodeMode = "python" | "notebook";

export interface NotebookCell {
  id: string;
  cell_type: "code" | "markdown";
  source: string;
}

async function runPython(
  scriptPath: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const python = await resolvePythonExecutable(serverRoot);
  const result = await runProcess(python, [scriptPath], {
    cwd,
    env: { PYTHONUNBUFFERED: "1" },
    timeoutMs: 60_000,
    maxStdoutChars: 1_000_000,
    maxStderrChars: 64_000,
  });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

function cellsToNotebookJson(cells: NotebookCell[]): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python", version: "3.11" },
    },
    cells: cells.map((c) => {
      const src = c.source.endsWith("\n") ? c.source : `${c.source}\n`;
      if (c.cell_type === "markdown") {
        return {
          cell_type: "markdown",
          metadata: {},
          source: src.split(/(?<=\n)/),
        };
      }
      return {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: src.split(/(?<=\n)/),
      };
    }),
  };
  return `${JSON.stringify(nb, null, 2)}\n`;
}

/** Execute authored Python or notebook similarly to a workflow run. */
export async function executeAuthoredCode(input: {
  workspaceId: string;
  mode: CodeMode;
  pythonSource?: string;
  notebookCells?: NotebookCell[];
  cellId?: string;
  /** Optional live canvas document — Run does not require Apply */
  document?: WorkspaceDocument;
  secrets?: Array<{ secretRef: string; value: string }>;
  /** When true, write python/notebook back to Mongo (Save only). Default false. */
  persistCodeLab?: boolean;
}): Promise<{
  runId: string;
  mode: CodeMode;
  status: "succeeded" | "failed";
  localPath: string;
  logPath: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const workspaceId = assertSafeIdentifier(input.workspaceId, "workspace id");
  const ws = await workspaces().findOne({ workspaceId });
  const document =
    (input.document as WorkspaceDocument | undefined) ??
    (ws?.document as WorkspaceDocument | undefined);
  if (!document) {
    throw Object.assign(
      new Error(
        "No workspace document — send the current canvas document with the execute request (Apply is not required to Run)",
      ),
      { statusCode: 404 },
    );
  }
  assertWorkspaceDocument(document);

  const runId = `code_${nanoid(10)}`;
  const runsRoot = path.resolve(config.runsRoot);
  const root = path.resolve(runsRoot, workspaceId, runId);
  const relativeRoot = path.relative(runsRoot, root);
  if (!relativeRoot || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    throw Object.assign(new Error("Code-lab run path escaped the runs root"), { statusCode: 400 });
  }
  const codeDir = path.join(root, "code");
  const logsDir = path.join(root, "logs");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  await fs.mkdir(codeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(logsDir, { recursive: true, mode: 0o700 });
  await fs.chmod(codeDir, 0o700).catch(() => undefined);
  await fs.chmod(logsDir, 0o700).catch(() => undefined);

  const logPath = path.join(logsDir, "run.log");
  const stamp = (line: string) =>
    fs.appendFile(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");

  await fs.chmod(codeDir, 0o700).catch(() => undefined);
  await fs.writeFile(logPath, "", { encoding: "utf8", mode: 0o600 });
  await fs.chmod(logPath, 0o600).catch(() => undefined);
  await stamp(`CODE_RUN_START mode=${input.mode} workspace=${workspaceId}`);

  // Materialize connectors + secrets (DB + ephemeral overlay)
  const secretMap = Object.create(null) as Record<string, string>;
  if (ws) {
    const secretRows = await secrets().find({ workspaceId }).toArray();
    for (const row of secretRows) {
      secretMap[row.secretRef] = decryptSecret({
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag,
      });
    }
  }
  for (const s of input.secrets ?? []) {
    if (s.secretRef && s.value) {
      secretMap[assertSafeSecretRef(s.secretRef)] = s.value;
    }
  }
  const tasks = buildTasksFile({
    document,
    runId,
    secrets: secretMap,
  });
  await fs.writeFile(path.join(root, "tasks.yaml"), dumpTasksYaml(tasks), "utf8");
  await fs.writeFile(
    path.join(root, "tasks.json"),
    JSON.stringify(tasks, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "document.json"),
    JSON.stringify(document, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "secrets.local.yaml"),
    dumpSecretsLocalYaml(secretMap),
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.chmod(path.join(root, "secrets.local.yaml"), 0o600).catch(() => undefined);
  const secretJsonPath = path.join(root, "secrets.local.json");
  await fs.writeFile(
    secretJsonPath,
    JSON.stringify(
      { note: "LOCAL ONLY — decrypted for this code-lab run", secrets: secretMap },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.chmod(secretJsonPath, 0o600).catch(() => undefined);
  await fs.writeFile(
    path.join(codeDir, "studio_connectors.py"),
    buildStudioConnectorsPy(),
    "utf8",
  );
  await fs.writeFile(
    path.join(codeDir, "stage_dataset.py"),
    buildStageDatasetPy(),
    "utf8",
  );
  await fs.writeFile(
    path.join(codeDir, "run_workflow.py"),
    buildPythonRunner(),
    "utf8",
  );
  await stamp(
    `CONNECTORS ready count=${tasks.connectors?.length ?? 0} secrets=${Object.keys(secretMap).length}`,
  );

  // Only persist code-lab to Mongo when explicitly requested (Sync/Save), never on Run
  if (input.persistCodeLab && ws) {
    await workspaces().updateOne(
      { workspaceId },
      {
        $set: {
          "codeLab.pythonSource": input.pythonSource ?? "",
          "codeLab.notebookCells": input.notebookCells ?? [],
          "codeLab.updatedAt": new Date().toISOString(),
        },
      },
    );
  }

  let scriptPath: string;
  if (input.mode === "python") {
    const source =
      input.pythonSource?.trim() ||
      '# empty script\nprint("No Python source provided")\n';
    scriptPath = path.join(codeDir, "main.py");
    await fs.writeFile(scriptPath, source, "utf8");
    await fs.writeFile(path.join(root, "main.py"), source, "utf8");
  } else {
    let cells = input.notebookCells ?? [];
    if (input.cellId) {
      cells = cells.filter((c) => c.id === input.cellId);
    }
    // Execute code cells as a single linear Python script (notebook-style)
    const codeParts = cells
      .filter((c) => c.cell_type === "code")
      .map((c, i) => `# %% cell ${c.id || i}\n${c.source}`);
    const bootstrap = `# %% bootstrap — workspace connectors
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from studio_connectors import list_connectors, fetch_mongodb, write_s3_json, get_connector
print("connectors:", [c.get("id") for c in list_connectors()])
`;
    const combined =
      `${bootstrap}\n\n${codeParts.join("\n\n")}` ||
      'print("No code cells to run")\n';
    scriptPath = path.join(codeDir, "notebook_linear.py");
    await fs.writeFile(scriptPath, combined, "utf8");
    await fs.mkdir(path.join(root, "notebooks"), { recursive: true });
    await fs.writeFile(
      path.join(root, "notebooks", "authored.ipynb"),
      cellsToNotebookJson(input.notebookCells ?? []),
      "utf8",
    );
  }

  const result = await runPython(scriptPath, codeDir);
  await stamp(`EXIT code=${result.code}`);
  if (result.stdout) await stamp(`STDOUT\n${result.stdout}`);
  if (result.stderr) await stamp(`STDERR\n${result.stderr}`);
  await stamp(result.code === 0 ? "RUN_OK" : "RUN_FAIL");

  const stdoutPath = path.join(logsDir, "stdout.log");
  const stderrPath = path.join(logsDir, "stderr.log");
  await fs.writeFile(stdoutPath, result.stdout, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(stderrPath, result.stderr, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(stdoutPath, 0o600).catch(() => undefined);
  await fs.chmod(stderrPath, 0o600).catch(() => undefined);

  return {
    runId,
    mode: input.mode,
    status: result.code === 0 ? "succeeded" : "failed",
    localPath: root,
    logPath,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
  };
}
