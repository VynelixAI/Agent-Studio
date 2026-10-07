#!/usr/bin/env node
/**
 * Emit Agent Studio Python codegen into testing/_generated/code
 * for domain node tests.
 *
 *   node testing/scripts/emit_codegen.mjs
 *   # or: npm run test:domains:emit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const outDir = path.join(repo, "testing", "_generated", "code");

async function loadTsModule(rel) {
  // Prefer compiled/tsx dynamic import via pathToFileURL
  const abs = path.join(repo, "server", "src", "codegen", rel);
  const { register } = await import("node:module");
  try {
    // tsx registers itself when run via `npx tsx`
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(abs).href);
}

async function main() {
  const { buildPythonRunner } = await import(
    pathToFileURL(path.join(repo, "server", "src", "codegen", "pythonRunner.ts")).href
  );
  const { buildStageDatasetPy } = await import(
    pathToFileURL(path.join(repo, "server", "src", "codegen", "stageDatasetPy.ts")).href
  );
  const { buildStudioConnectorsPy } = await import(
    pathToFileURL(path.join(repo, "server", "src", "codegen", "studioConnectorsPy.ts")).href
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "run_workflow.py"), buildPythonRunner(), "utf8");
  fs.writeFileSync(path.join(outDir, "stage_dataset.py"), buildStageDatasetPy(), "utf8");
  fs.writeFileSync(
    path.join(outDir, "studio_connectors.py"),
    buildStudioConnectorsPy(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "__init__.py"),
    "# Generated Agent Studio run helpers for domain tests\n",
    "utf8",
  );
  console.log("wrote", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
