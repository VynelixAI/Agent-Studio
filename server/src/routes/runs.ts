import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { writeAudit } from "../security/audit.js";
import { requireRole } from "../security/plugin.js";
import { scrubPii } from "../security/privacy.js";
import {
  getRun,
  listRuns,
  readRunLogs,
  readRunOutputs,
  startRun,
} from "../services/runService.js";

export async function runRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: {
      mode?: "dry-run" | "execute";
      runtime?: "python" | "notebook";
      document?: import("../types.js").WorkspaceDocument;
      yaml?: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
    };
  }>(
    "/workspaces/:id/runs",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      try {
        const run = await startRun({
          workspaceId: req.params.id,
          mode: req.body?.mode ?? "execute",
          runtime: req.body?.runtime ?? "python",
          document: req.body?.document,
          yaml: req.body?.yaml,
          secrets: req.body?.secrets?.map((s) => ({
            secretRef: s.secretRef,
            value: s.value,
          })),
        });
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "run.start",
          resourceType: "run",
          resourceId: run.runId,
          residency: config.dataResidency,
          success: run.status === "succeeded",
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: {
            workspaceId: req.params.id,
            runtime: run.runtime,
            status: run.status,
          },
        });
        return reply.code(201).send(run);
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "run.start",
          resourceType: "run",
          resourceId: req.params.id,
          success: false,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: { error: e.message },
        });
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/runs",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const items = await listRuns(req.params.id);
        return { items };
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/runs/:runId",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const run = await getRun(req.params.runId);
      if (!run) return reply.code(404).send({ error: "Run not found" });
      return run;
    },
  );

  app.get<{ Params: { runId: string }; Querystring: { scrub?: string } }>(
    "/runs/:runId/logs",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const logs = await readRunLogs(req.params.runId);
        const scrub = req.query.scrub !== "0";
        return {
          runId: logs.runId,
          scrubbed: scrub,
          files: logs.files.map((f) => ({
            path: f.path,
            content: scrub ? scrubPii(f.content) : f.content,
          })),
        };
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.get<{ Params: { runId: string }; Querystring: { scrub?: string } }>(
    "/runs/:runId/outputs",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const outs = await readRunOutputs(req.params.runId);
        const scrub = req.query.scrub !== "0";
        return {
          runId: outs.runId,
          scrubbed: scrub,
          files: outs.files.map((f) => ({
            path: f.path,
            content: scrub ? scrubPii(f.content) : f.content,
          })),
        };
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );
}
