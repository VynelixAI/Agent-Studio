/**
 * Emit stage_dataset.py into server/tests for Python unit tests.
 * Run: npx tsx scripts/emit-stage-dataset.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStageDatasetPy } from "../src/codegen/stageDatasetPy.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, "..", "tests", "stage_dataset_under_test.py");
fs.writeFileSync(out, buildStageDatasetPy(), "utf8");
console.log("wrote", out);
