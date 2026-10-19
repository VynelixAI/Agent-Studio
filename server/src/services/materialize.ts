import fs from "node:fs/promises";
import yaml from "js-yaml";
import path from "node:path";
import { config } from "../config.js";
import { buildDataCleanupNotebook } from "../codegen/notebook.js";
import {
  buildWorkflowReferenceNotebook,
  buildWorkflowReferencePy,
  buildReferenceNodePy,
} from "../codegen/workflowReference.js";
import {
  buildPythonRunner,
  buildRequirementsTxt,
} from "../codegen/pythonRunner.js";
import { buildStageDatasetPy } from "../codegen/stageDatasetPy.js";
import { buildStudioConnectorsPy } from "../codegen/studioConnectorsPy.js";
import {
  buildTasksFile,
  dumpSecretsLocalYaml,
  dumpTasksYaml,
} from "../codegen/tasksYaml.js";
import type { WorkspaceDocument } from "../types.js";
import { assertSafeFileName, assertSafeIdentifier } from "../security/identifiers.js";

export interface MaterializedRun {
  root: string;
  yamlPath: string;
  tasksYamlPath: string;
  secretsYamlPath: string;
  documentPath: string;
  codeDir: string;
  logsDir: string;
  notebookPath: string;
  pythonRunnerPath: string;
}

/** Create local run folder with Python runner, tasks YAML, secrets, notebook, logs. */
export async function materializeRun(opts: {
  workspaceId: string;
  runId: string;
  version: string;
  yaml: string;
  document: WorkspaceDocument;
  secrets: Record<string, string>;
  attachments?: Array<{ name: string; absolutePath: string }>;
  chat?: {
    sessionId?: string;
    question?: string;
    history?: Array<{ role: string; content: string }>;
  };
}): Promise<MaterializedRun> {
  const workspaceId = assertSafeIdentifier(opts.workspaceId, "workspace id");
  const runId = assertSafeIdentifier(opts.runId, "run id");
  for (const node of opts.document.flow.nodes) {
    assertSafeIdentifier(node.id, "node id");
  }
  const runsRoot = path.resolve(config.runsRoot);
  const root = path.resolve(runsRoot, workspaceId, runId);
  const relativeRoot = path.relative(runsRoot, root);
  if (!relativeRoot || relativeRoot === ".." || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    throw Object.assign(new Error("Run path escaped the runs root"), { statusCode: 400 });
  }
  const codeDir = path.join(root, "code");
  const logsDir = path.join(root, "logs");
  const notebooksDir = path.join(root, "notebooks");
  const attachmentsDir = path.join(root, "attachments");
  const stageDir = path.join(codeDir, "stage_cache");

  // Run folders can contain decrypted connector secrets and logs; keep them private.
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  for (const directory of [codeDir, logsDir, path.join(logsDir, "nodes"), notebooksDir, attachmentsDir, stageDir]) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700).catch(() => undefined);
  }

  // Fresh run log file for every run
  const mainLog = path.join(logsDir, "run.log");
  await fs.writeFile(
    mainLog,
    `[${new Date().toISOString()}] MATERIALIZE_START run=${opts.runId}\n`,
    "utf8",
  );

  const tasks = buildTasksFile({
    document: opts.document,
    runId: opts.runId,
    secrets: opts.secrets,
    chat: opts.chat,
  });

  const yamlPath = path.join(root, "workspace.yaml");
  const tasksYamlPath = path.join(root, "tasks.yaml");
  const secretsYamlPath = path.join(root, "secrets.local.yaml");
  const documentPath = path.join(root, "document.json");
  const metaPath = path.join(root, "run-meta.json");
  const pythonRunnerPath = path.join(codeDir, "run_workflow.py");
  const notebookPath = path.join(notebooksDir, "data_cleanup.ipynb");

  await fs.writeFile(yamlPath, opts.yaml, "utf8");
  await fs.writeFile(tasksYamlPath, dumpTasksYaml(tasks), "utf8");
  await fs.writeFile(secretsYamlPath, dumpSecretsLocalYaml(opts.secrets), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(secretsYamlPath, 0o600).catch(() => undefined);
  const secretsJsonPath = path.join(root, "secrets.local.json");
  await fs.writeFile(
    secretsJsonPath,
    JSON.stringify(
      {
        note: "LOCAL ONLY — decrypted secrets for this run. Do not commit.",
        secrets: opts.secrets,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.chmod(secretsJsonPath, 0o600).catch(() => undefined);
  await fs.writeFile(documentPath, JSON.stringify(opts.document, null, 2), "utf8");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        workspaceId: opts.workspaceId,
        runId: opts.runId,
        version: opts.version,
        materializedAt: new Date().toISOString(),
        artifacts: {
          workspaceYaml: "workspace.yaml",
          tasksYaml: "tasks.yaml",
          secretsLocalYaml: "secrets.local.yaml",
          pythonRunner: "code/run_workflow.py",
          workflowReference: "code/workflow_reference.py",
          notebook: "notebooks/data_cleanup.ipynb",
          workflowNotebook: "notebooks/workflow.ipynb",
          logs: "logs/run.log",
          outputsDir: "outputs",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(pythonRunnerPath, buildPythonRunner(), "utf8");
  await fs.chmod(pythonRunnerPath, 0o755).catch(() => undefined);
  await fs.writeFile(path.join(codeDir, "requirements.txt"), buildRequirementsTxt(), "utf8");
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
  await fs.writeFile(path.join(codeDir, "workspace.yaml"), opts.yaml, "utf8");
  await fs.writeFile(path.join(codeDir, "tasks.yaml"), dumpTasksYaml(tasks), "utf8");
  await fs.writeFile(
    path.join(root, "tasks.json"),
    JSON.stringify(tasks, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(codeDir, "tasks.json"),
    JSON.stringify(tasks, null, 2),
    "utf8",
  );
  await fs.writeFile(notebookPath, buildDataCleanupNotebook(tasks), "utf8");
  await fs.writeFile(
    path.join(codeDir, "workflow_reference.py"),
    buildWorkflowReferencePy(opts.document),
    "utf8",
  );
  await fs.writeFile(
    path.join(notebooksDir, "workflow.ipynb"),
    buildWorkflowReferenceNotebook(opts.document),
    "utf8",
  );
  const nodesDir = path.join(codeDir, "nodes");
  await fs.mkdir(nodesDir, { recursive: true });
  for (const node of opts.document.flow.nodes) {
    const nodeId = assertSafeIdentifier(node.id, "node id");
    await fs.writeFile(
      path.join(nodesDir, `${nodeId}.py`),
      buildReferenceNodePy(node),
      "utf8",
    );
  }

  // Materialize agent / LLM dynamic code for remote copy & local exec
  const agentsDir = path.join(codeDir, "agents");
  const outputsDir = path.join(root, "outputs");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });
  await fs.writeFile(
    path.join(outputsDir, "README.md"),
    `# Outputs for ${opts.runId}

Node result YAML/JSON files are written here when the workflow runner finishes each task.

Expected files after a successful Run:
- \`<nodeId>.yaml\` when the node has \`outputFormat: yaml\`
- \`<nodeId>.json\` otherwise

Structured DB reads write columnar datasets:
- \`query.filter\` / \`query.projection\` / \`query.limit\` (null = all matching rows)
- \`schema.columns\` + \`rows\` (or \`sidecars/<nodeId>.parquet|jsonl\` when large)
- Stage handoff: \`code/stage_cache/\` for Notebook / Logic / Control

If this folder is empty after Run, check \`logs/run.log\` and \`logs/nodes/*.log\`.
`,
    "utf8",
  );
  for (const node of opts.document.flow.nodes) {
    if (node.type !== "agent" && node.type !== "llm") continue;
    const nodeId = assertSafeIdentifier(node.id, "node id");
    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const code = typeof cfg.dynamicCode === "string" ? cfg.dynamicCode : "";
    if (!code.trim()) continue;
    const lang = String(cfg.codeLanguage ?? "python");
    const ext = lang === "javascript" ? "mjs" : "py";
    await fs.writeFile(path.join(agentsDir, `${nodeId}.${ext}`), code, "utf8");
    const metadata = {
      nodeId,
      type: node.type,
      agentVendor: cfg.agentVendor ?? "",
      agentType: cfg.agentType ?? "",
      executionMode: cfg.executionMode ?? "local",
      remoteUrl: cfg.remoteUrl ?? "",
      provider: cfg.provider ?? "",
      model: cfg.customModel || cfg.model || "",
      yamlOutputPath: cfg.yamlOutputPath ?? `outputs/${nodeId}.yaml`,
      package: cfg.agentPackage ?? cfg.langchainPackage ?? "",
    };
    await fs.writeFile(
      path.join(agentsDir, `${nodeId}.meta.yaml`),
      yaml.dump(metadata, { noRefs: true, lineWidth: -1 }),
      "utf8",
    );
  }

    // Materialize Python / Notebook node sources for inspection & Jupyter
  for (const node of opts.document.flow.nodes) {
    if (node.type !== "python" && node.type !== "notebook" && node.type !== "code") {
      continue;
    }
    const nodeId = assertSafeIdentifier(node.id, "node id");
    const cfg = { ...((node.config ?? {}) as Record<string, unknown>) };
    if (
      node.type === "notebook" &&
      String(cfg.notebookSource ?? (cfg.notebookId ? "saved" : "inline")) ===
        "saved" &&
      cfg.notebookId
    ) {
      const nb = (opts.document.notebooks ?? []).find(
        (n) => n.id === String(cfg.notebookId),
      );
      if (nb) {
        cfg.source = nb.cells
          .map((c) => {
            const body = (c.source ?? "").replace(/\r\n/g, "\n").trimEnd();
            if (c.cell_type === "markdown") return `# %% markdown\n${body}\n`;
            return `# %%\n${body}\n`;
          })
          .join("\n");
      }
    }
    const src =
      (typeof cfg.script === "string" && cfg.script) ||
      (typeof cfg.source === "string" && cfg.source) ||
      (typeof cfg.code === "string" && cfg.code) ||
      "";
    if (!String(src).trim()) continue;
    if (node.type === "notebook") {
      await fs.writeFile(
        path.join(notebooksDir, `${nodeId}.py`),
        String(src),
        "utf8",
      );
    } else {
      await fs.writeFile(path.join(codeDir, `${nodeId}.py`), String(src), "utf8");
    }
  }

  // Convenience README in the run folder
  await fs.writeFile(
    path.join(root, "README.md"),
    `# Run ${opts.runId}

## Artifacts
- \`workspace.yaml\` — source of truth from Agent Studio
- \`tasks.yaml\` — ordered tasks, connectors, secret refs
- \`secrets.local.yaml\` — decrypted secrets for this run (do not commit)
- \`code/run_workflow.py\` — step-by-step Python runner
- \`code/agents/\` — LLM/Agent dynamic code (+ *.meta.yaml) for remote copy
- \`outputs/\` — per-node result YAML/JSON (\`outputs/<nodeId>.yaml\`) for validation
- \`code/stage_cache/\` — stage handoff JSON (+ \`.yaml\` when outputFormat=yaml)
- \`notebooks/data_cleanup.ipynb\` — Jupyter for data processing / cleanup
- \`logs/run.log\` + \`logs/nodes/*.log\` — per-run logs

## Validate outputs
\`\`\`bash
ls -la outputs/
cat outputs/*.yaml
# or: cat code/stage_cache/stage.*.yaml
\`\`\`

## Execute (Python)
\`\`\`bash
cd code
pip install -r requirements.txt
python run_workflow.py
\`\`\`

## Copy agent package to remote host
\`\`\`bash
rsync -az code/agents/ user@remote:/opt/vynelix/agents/
# then invoke remote product URL configured on the Agent node
\`\`\`

## Jupyter
\`\`\`bash
cd notebooks
jupyter notebook data_cleanup.ipynb
# or: jupyter nbconvert --to notebook --execute data_cleanup.ipynb
\`\`\`
`,
    "utf8",
  );

  if (opts.attachments?.length) {
    for (const att of opts.attachments) {
      const attachmentName = assertSafeFileName(att.name, "attachment name");
      await fs.copyFile(att.absolutePath, path.join(attachmentsDir, attachmentName));
    }
  }

  await fs.appendFile(
    mainLog,
    `[${new Date().toISOString()}] MATERIALIZE_OK tasks=${tasks.tasks.length} notebook=data_cleanup.ipynb\n`,
    "utf8",
  );

  return {
    root,
    yamlPath,
    tasksYamlPath,
    secretsYamlPath,
    documentPath,
    codeDir,
    logsDir,
    notebookPath,
    pythonRunnerPath,
  };
}
