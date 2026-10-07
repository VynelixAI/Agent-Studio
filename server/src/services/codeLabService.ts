import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { buildPythonRunner } from "../codegen/pythonRunner.js";
import { buildStageDatasetPy } from "../codegen/stageDatasetPy.js";
import { buildStudioConnectorsPy } from "../codegen/studioConnectorsPy.js";
import { dumpSecretsLocalYaml, dumpTasksYaml, buildTasksFile } from "../codegen/tasksYaml.js";
import { config } from "../config.js";
import { decryptSecret } from "../crypto.js";
import { secrets, workspaces } from "../db.js";
import type { WorkspaceDocument } from "../types.js";

export type CodeMode = "python" | "notebook";

export interface NotebookCell {
  id: string;
  cell_type: "code" | "markdown";
  source: string;
}

function runPython(
  scriptPath: string,
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [scriptPath], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
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
  const ws = await workspaces().findOne({ workspaceId: input.workspaceId });
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

  const runId = `code_${nanoid(10)}`;
  const root = path.join(config.runsRoot, input.workspaceId, runId);
  const codeDir = path.join(root, "code");
  const logsDir = path.join(root, "logs");
  await fs.mkdir(codeDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const logPath = path.join(logsDir, "run.log");
  const stamp = (line: string) =>
    fs.appendFile(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");

  await fs.writeFile(logPath, "", "utf8");
  await stamp(`CODE_RUN_START mode=${input.mode} workspace=${input.workspaceId}`);

  // Materialize connectors + secrets (DB + ephemeral overlay)
  const secretMap: Record<string, string> = {};
  if (ws) {
    const secretRows = await secrets().find({ workspaceId: input.workspaceId }).toArray();
    for (const row of secretRows) {
      secretMap[row.secretRef] = decryptSecret({
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag,
      });
    }
  }
  for (const s of input.secrets ?? []) {
    if (s.secretRef && s.value) secretMap[s.secretRef] = s.value;
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
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "secrets.local.json"),
    JSON.stringify(
      { note: "LOCAL ONLY — decrypted for this code-lab run", secrets: secretMap },
      null,
      2,
    ),
    "utf8",
  );
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
      { workspaceId: input.workspaceId },
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

  await fs.writeFile(
    path.join(logsDir, "stdout.log"),
    result.stdout,
    "utf8",
  );
  await fs.writeFile(
    path.join(logsDir, "stderr.log"),
    result.stderr,
    "utf8",
  );

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
