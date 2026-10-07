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
  for (const run of oldRuns) {
    try {
      await fs.rm(run.localPath, { recursive: true, force: true });
      runDirsRemoved += 1;
    } catch {
      /* ignore */
    }
    // Also try parent cleanup is unnecessary
    void path;
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
