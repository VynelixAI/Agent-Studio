import type { FastifyInstance } from "fastify";
import { requireRole } from "../security/plugin.js";
import { readStudioSetup, saveStudioSetup, type LlmKind, type MongoMode } from "../services/studioSetup.js";

export async function setupRoutes(app: FastifyInstance) {
  app.get("/studio/setup", { preHandler: requireRole("read") }, async () => readStudioSetup());

  app.put<{
    Body: {
      workspacePath?: string;
      llmKind?: LlmKind;
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      mongoMode?: MongoMode;
      databaseName?: string;
      databaseUri?: string;
    };
  }>("/studio/setup", { preHandler: requireRole("write") }, async (req, reply) => {
    try {
      const body = req.body ?? {};
      const saved = await saveStudioSetup({
        workspacePath: String(body.workspacePath || "~/AgentStudio"),
        llmKind: body.llmKind === "licensed" ? "licensed" : "opensource",
        provider: String(body.provider || ""),
        model: String(body.model || ""),
        baseUrl: String(body.baseUrl || ""),
        apiKey: body.apiKey,
        mongoMode: body.mongoMode === "remote" ? "remote" : "local",
        databaseName: String(body.databaseName || "vynelix_agent_studio"),
        databaseUri: String(body.databaseUri || ""),
      });
      return saved;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "Could not save setup" });
    }
  });
}
