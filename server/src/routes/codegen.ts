import type { FastifyInstance } from "fastify";
import { requireRole } from "../security/plugin.js";
import { enhanceNodeClasses } from "../services/codegenService.js";

export async function codegenRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: {
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      nodes?: Array<{
        id: string;
        type: string;
        label?: string;
        source: string;
      }>;
    };
  }>(
    "/workspaces/:id/codegen",
    { preHandler: requireRole("write") },
    async (req, reply) => {
      const apiKey = String(req.body.apiKey || "").trim();
      if (!apiKey) {
        return reply.code(400).send({
          error: "codegen API key is required (separate from connector secrets)",
        });
      }
      const nodes = Array.isArray(req.body.nodes) ? req.body.nodes : [];
      if (!nodes.length) {
        return reply.code(400).send({ error: "nodes[] required" });
      }
      try {
        const polished = await enhanceNodeClasses({
          provider: String(req.body.provider || "openai"),
          model: String(req.body.model || "gpt-4.1-mini"),
          baseUrl: String(req.body.baseUrl || "https://api.openai.com/v1"),
          apiKey,
          nodes: nodes.slice(0, 24).map((n) => ({
            id: String(n.id),
            type: String(n.type),
            label: String(n.label || n.id),
            source: String(n.source || ""),
          })),
        });
        return { nodes: polished };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: message });
      }
    },
  );
}
