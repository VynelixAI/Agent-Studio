/**
 * Emit Agent Studio Python codegen into testing/_generated/code
 *
 *   npx tsx testing/scripts/emit_codegen.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPythonRunner } from "../../server/src/codegen/pythonRunner.ts";
import { buildStageDatasetPy } from "../../server/src/codegen/stageDatasetPy.ts";
import { buildStudioConnectorsPy } from "../../server/src/codegen/studioConnectorsPy.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../_generated/code");

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
