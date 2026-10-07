import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { writeAudit } from "../security/audit.js";
import { requireRole } from "../security/plugin.js";
import {
  deleteChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
} from "../services/chatService.js";

export async function chatRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: {
      message?: string;
      question?: string;
      sessionId?: string;
      document?: import("../types.js").WorkspaceDocument;
      yaml?: string;
      secrets?: Array<{ secretRef: string; value: string }>;
    };
  }>(
    "/workspaces/:id/chat",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      try {
        const message = String(req.body?.message ?? req.body?.question ?? "").trim();
        const result = await sendChatMessage({
          workspaceId: req.params.id,
          message,
          sessionId: req.body?.sessionId,
          document: req.body?.document,
          yaml: req.body?.yaml,
          secrets: req.body?.secrets,
        });
        await writeAudit({
          actor: req.principal?.keyId ?? "unknown",
          role: req.principal?.role,
          action: "chat.message",
          resourceType: "chat_session",
          resourceId: result.session.sessionId,
          residency: config.dataResidency,
          success: result.run.status === "succeeded",
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          detail: { workspaceId: req.params.id, runId: result.run.runId },
        });
        return reply.code(201).send({
          sessionId: result.session.sessionId,
          reply: result.reply,
          runId: result.run.runId,
          status: result.run.status,
          messages: result.session.messages,
        });
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/chat/sessions",
    { preHandler: requireRole("read") },
    async (req) => {
      const items = await listChatSessions(req.params.id);
      return { items };
    },
  );

  app.get<{ Params: { id: string; sessionId: string } }>(
    "/workspaces/:id/chat/sessions/:sessionId",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const session = await getChatSession(req.params.id, req.params.sessionId);
      if (!session) return reply.code(404).send({ error: "Session not found" });
      return session;
    },
  );

  app.delete<{ Params: { id: string; sessionId: string } }>(
    "/workspaces/:id/chat/sessions/:sessionId",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      const ok = await deleteChatSession(req.params.id, req.params.sessionId);
      if (!ok) return reply.code(404).send({ error: "Session not found" });
      return { ok: true };
    },
  );
}
