import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { auditLogs, runOutputs, runs } from "../db.js";

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Enforce storage limitation (DPDP) + US retention hygiene */
export async function purgeExpired(): Promise<{
  auditsDeleted: number;
  runsDeleted: number;
  runDirsRemoved: number;
  outputsDeleted: number;
}> {
  const auditCut = cutoff(config.auditRetentionDays).toISOString();
  const runCut = cutoff(config.runRetentionDays).toISOString();

  const auditRes = await auditLogs().deleteMany({ ts: { $lt: auditCut } });
  const oldRuns = await runs()
    .find({ startedAt: { $lt: runCut } })
    .toArray();

  let runDirsRemoved = 0;
  const runsRoot = path.resolve(config.runsRoot);
  let canonicalRunsRoot: string | undefined;
  try { canonicalRunsRoot = await fs.realpath(runsRoot); } catch { /* absent root is okay */ }
  for (const run of oldRuns) {
    try {
      if (!canonicalRunsRoot || typeof run.localPath !== "string" || !path.isAbsolute(run.localPath)) continue;
      const target = path.resolve(run.localPath);
      const relative = path.relative(runsRoot, target);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      const canonicalTarget = await fs.realpath(target);
      const canonicalRelative = path.relative(canonicalRunsRoot, canonicalTarget);
      if (!canonicalRelative || canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) continue;
      await fs.rm(canonicalTarget, { recursive: true, force: true });
      runDirsRemoved += 1;
    } catch {
      /* Ignore missing/unsafe paths; retention must never delete outside runsRoot. */
    }
  }

  const runRes = await runs().deleteMany({ startedAt: { $lt: runCut } });
  const outputRes = await runOutputs().deleteMany({
    runId: { $in: oldRuns.map((r) => r.runId) },
  });

  return {
    auditsDeleted: auditRes.deletedCount ?? 0,
    runsDeleted: runRes.deletedCount ?? 0,
    runDirsRemoved,
    outputsDeleted: outputRes.deletedCount ?? 0,
  };
}
