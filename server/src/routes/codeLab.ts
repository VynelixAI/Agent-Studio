import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { writeAudit } from "../security/audit.js";
import { requireRole } from "../security/plugin.js";
import {
  executeAuthoredCode,
  type NotebookCell,
} from "../services/codeLabService.js";
import { getWorkspace } from "../services/workspaceService.js";

export async function codeLabRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/code",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const ws = await getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      const lab = (ws as { codeLab?: unknown }).codeLab ?? {
        pythonSource: "",
        notebookCells: [],
      };
      return { workspaceId: req.params.id, codeLab: lab };
    },
  );

  app.put<{
    Params: { id: string };
    Body: {
      pythonSource?: string;
      notebookCells?: NotebookCell[];
    };
  }>(
    "/workspaces/:id/code",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      const ws = await getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      const { workspaces } = await import("../db.js");
      await workspaces().updateOne(
        { workspaceId: req.params.id },
        {
          $set: {
            "codeLab.pythonSource": req.body.pythonSource ?? "",
            "codeLab.notebookCells": req.body.notebookCells ?? [],
            "codeLab.updatedAt": new Date().toISOString(),
          },
        },
      );
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "codelab.save",
        resourceType: "workspace",
        resourceId: req.params.id,
        success: true,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return { ok: true };
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      mode: "python" | "notebook";
      pythonSource?: string;
      notebookCells?: NotebookCell[];
      cellId?: string;
      document?: import("../types.js").WorkspaceDocument;
      secrets?: Array<{ secretRef: string; value: string }>;
    };
  }>(
    "/workspaces/:id/code/execute",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      if (req.body.mode !== "python" && req.body.mode !== "notebook") {
        return reply.code(400).send({ error: "mode must be python | notebook" });
      }
      try {
        const result = await executeAuthoredCode({
          workspaceId: req.params.id,
          mode: req.body.mode,
          pythonSource: req.body.pythonSource,
          notebookCells: req.body.notebookCells,
          cellId: req.body.cellId,
          document: req.body.document,
          secrets: req.body.secrets,
          persistCodeLab: false,
        });
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "codelab.execute",
          resourceType: "run",
          resourceId: result.runId,
          residency: config.dataResidency,
          success: result.status === "succeeded",
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: { mode: result.mode, exitCode: result.exitCode },
        });
        return reply.code(201).send(result);
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );
}
