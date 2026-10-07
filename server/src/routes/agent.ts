import type { FastifyInstance } from "fastify";
import { BRAIN_PROVIDERS, askBrain } from "../services/brainService.js";
import {
  appendChat,
  listExecutions,
  publicBrain,
  readBrain,
  readChat,
  readExecution,
  readLog,
  readMemory,
  writeBrain,
} from "../services/localWorkspace.js";
import { requireRole } from "../security/plugin.js";

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agent/providers", { preHandler: requireRole("read") }, async () => ({
    items: BRAIN_PROVIDERS.map(({ id, label, baseUrl, model, needsKey }) => ({
      id,
      label,
      baseUrl,
      model,
      needsKey,
    })),
  }));

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/agent/memory",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        return await readMemory(req.params.id);
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/agent/executions",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const items = await listExecutions(req.params.id);
        return { items };
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string; executionId: string } }>(
    "/workspaces/:id/agent/executions/:executionId",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const snap = await readExecution(req.params.id, req.params.executionId);
        if (!snap) return reply.code(404).send({ error: "Execution not found" });
        return snap;
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { kind?: string; q?: string } }>(
    "/workspaces/:id/agent/logs",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      const kind = req.query.kind === "failure" ? "failure" : "success";
      try {
        return await readLog(req.params.id, kind, req.query.q);
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/agent/brain",
    { preHandler: requireRole("read") },
    async (req, reply) => {
      try {
        const [brain, turns] = await Promise.all([
          readBrain(req.params.id),
          readChat(req.params.id),
        ]);
        return { brain: publicBrain(brain), turns };
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.put<{
    Params: { id: string };
    Body: { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
  }>(
    "/workspaces/:id/agent/brain",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      try {
        const saved = await writeBrain(req.params.id, req.body ?? {});
        return { brain: publicBrain(saved) };
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { message?: string; graphSummary?: string };
  }>(
    "/workspaces/:id/agent/chat",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      const message = String(req.body?.message ?? "").trim();
      if (!message) return reply.code(400).send({ error: "message is required" });
      const ts = new Date().toISOString();
      try {
        const result = await askBrain({
          workspaceId: req.params.id,
          message,
          graphSummary: req.body?.graphSummary,
        });
        const turns = await appendChat(req.params.id, [
          { role: "user", content: message, ts },
          { role: "assistant", content: result.reply, ts: new Date().toISOString() },
        ]);
        return { reply: result.reply, provider: result.provider, model: result.model, turns };
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );
}

function sendErr(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  const e = err as { statusCode?: number; message?: string };
  return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "Agent request failed" });
}
