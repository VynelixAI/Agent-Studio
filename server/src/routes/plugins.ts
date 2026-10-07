import type { FastifyInstance } from "fastify";
import {
  installPluginPackage,
  listInstalledPlugins,
  uninstallPlugin,
  type PluginInstallRequest,
} from "../services/pluginService.js";

export async function pluginRoutes(app: FastifyInstance) {
  app.get("/plugins", async () => {
    const items = await listInstalledPlugins();
    return { items };
  });

  app.post<{ Body: PluginInstallRequest }>("/plugins/install", async (req, reply) => {
    const body = req.body;
    if (!body?.pluginId || !body?.name || !body?.connectorType || !Array.isArray(body.nodes)) {
      return reply.code(400).send({
        error: "pluginId, name, connectorType, and nodes[] are required",
      });
    }
    const result = await installPluginPackage(body);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/plugins/:id", async (req) => {
    const ok = await uninstallPlugin(req.params.id);
    return { ok, pluginId: req.params.id };
  });
}
