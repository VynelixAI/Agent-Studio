import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { encryptSecret } from "../crypto.js";
import { secrets } from "../db.js";
import { writeAudit } from "../security/audit.js";
import { requireRole } from "../security/plugin.js";
import { assertSafeIdentifier, assertSafeSecretRef } from "../security/identifiers.js";
import {
  applyWorkspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listVersions,
  listWorkspaces,
} from "../services/workspaceService.js";
import type { WorkspaceDocument } from "../types.js";

export async function workspaceRoutes(app: FastifyInstance) {
  app.get(
    "/workspaces",
    { preHandler: requireRole("read") },
    async () => {
      const items = await listWorkspaces();
      return { items };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const ws = await getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      return ws;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/versions",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const ws = await getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      const items = await listVersions(req.params.id);
      return { items };
    },
  );

  app.post<{
    Body: {
      document: WorkspaceDocument;
      yaml: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
      privacy?: {
        purpose?: string;
        residency?: "US" | "IN" | "EU" | "GLOBAL";
        classification?: "public" | "internal" | "confidential" | "restricted";
        mayContainPersonalData?: boolean;
        retentionDays?: number;
      };
    };
  }>("/workspaces", { preHandler: requireRole("write") }, async (req, reply) => {
    try {
      const record = await createWorkspace({
        ...req.body,
        privacy: req.body.privacy ?? {
          purpose: "Agent workflow execution and data engineering orchestration",
          residency: config.dataResidency,
          classification: "confidential",
          mayContainPersonalData: true,
        },
      });
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "workspace.create",
        resourceType: "workspace",
        resourceId: record.workspaceId,
        residency: record.privacy?.residency ?? config.dataResidency,
        success: true,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        detail: { version: record.currentVersion },
      });
      return reply.code(201).send(record);
    } catch (err) {
      const e = err as { statusCode?: number; message: string; code?: string };
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "workspace.create",
        resourceType: "workspace",
        success: false,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        detail: { error: e.message },
      });
      return reply.code(e.statusCode ?? 500).send({
        error: e.message,
        code: e.code,
      });
    }
  });

  app.post<{
    Params: { id: string };
    Body: {
      mode: "override" | "new_version";
      document: WorkspaceDocument;
      yaml: string;
      secrets?: Array<{ secretRef: string; value: string; label?: string }>;
      note?: string;
      privacy?: {
        purpose?: string;
        residency?: "US" | "IN" | "EU" | "GLOBAL";
        classification?: "public" | "internal" | "confidential" | "restricted";
        mayContainPersonalData?: boolean;
        retentionDays?: number;
      };
    };
  }>(
    "/workspaces/:id/apply",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      if (req.body.mode !== "override" && req.body.mode !== "new_version") {
        return reply
          .code(400)
          .send({ error: "mode must be override | new_version" });
      }
      try {
        const result = await applyWorkspace({
          workspaceId: req.params.id,
          mode: req.body.mode,
          document: req.body.document,
          yaml: req.body.yaml,
          secrets: req.body.secrets,
          note: req.body.note,
          privacy: req.body.privacy,
        });
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: `workspace.apply.${req.body.mode}`,
          resourceType: "workspace",
          resourceId: req.params.id,
          residency:
            result.record.privacy?.residency ?? config.dataResidency,
          success: true,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: {
            previousVersion: result.previousVersion,
            version: result.record.currentVersion,
          },
        });
        return {
          workspace: result.record,
          previousVersion: result.previousVersion,
          appliedMode: req.body.mode,
        };
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: `workspace.apply.${req.body.mode}`,
          resourceType: "workspace",
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

  app.put<{
    Params: { id: string };
    Body: { secretRef: string; value: string; label?: string };
  }>(
    "/workspaces/:id/secrets",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      const workspaceId = assertSafeIdentifier(req.params.id, "workspace id");
      const secretRef = assertSafeSecretRef(req.body?.secretRef);
      const secretValue = req.body?.value;
      if (typeof secretValue !== "string" || secretValue.length > 200_000) {
        return reply.code(400).send({ error: "Secret value must be a string of at most 200000 characters", code: "INVALID_SECRET_VALUE" });
      }
      const ws = await getWorkspace(workspaceId);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      const now = new Date().toISOString();
      const enc = encryptSecret(secretValue);
      await secrets().updateOne(
        { workspaceId, secretRef },
        {
          $set: {
            workspaceId,
            secretRef,
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            tag: enc.tag,
            label: req.body?.label,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "secret.upsert",
        resourceType: "secret",
        resourceId: workspaceId,
        success: true,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        detail: { secretRef },
      });
      return { ok: true, secretRef };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/secrets",
    { preHandler: requireRole("admin") },
    async (req, reply) => {
      const ws = await getWorkspace(req.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });
      // Never return ciphertext to clients — metadata only
      const items = await secrets()
        .find(
          { workspaceId: req.params.id },
          { projection: { _id: 0, secretRef: 1, label: 1, updatedAt: 1 } },
        )
        .toArray();
      return { items };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/workspaces/:id",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      try {
        const result = await deleteWorkspace(req.params.id);
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "workspace.delete",
          resourceType: "workspace",
          resourceId: req.params.id,
          residency: config.dataResidency,
          success: true,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: result.deleted,
        });
        return result;
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "workspace.delete",
          resourceType: "workspace",
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
}
