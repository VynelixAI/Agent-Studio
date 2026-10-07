import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { assertSecurityConfig, config } from "./config.js";
import { closeDb, connectDb } from "./db.js";
import { agentRoutes } from "./routes/agent.js";
import { setupRoutes } from "./routes/setup.js";
import { pluginRoutes } from "./routes/plugins.js";
import { runRoutes } from "./routes/runs.js";
import { securityRoutes } from "./routes/security.js";
import { chatRoutes } from "./routes/chat.js";
import { codeLabRoutes } from "./routes/codeLab.js";
import { codegenRoutes } from "./routes/codegen.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { registerSecurity } from "./security/plugin.js";

async function main() {
  const app = Fastify({
    logger: true,
    requestIdHeader: "x-request-id",
    genReqId: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false, // API JSON — CSP for UI is Vite/Tauri side
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const raw = String(config.corsOrigin || "*").trim();
      // No Origin (curl / same-origin) or wildcard → allow
      if (!origin || raw === "*" || raw === "true") {
        cb(null, true);
        return;
      }
      const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      // Dev convenience: any host on Vite port 1420
      try {
        const u = new URL(origin);
        if (u.port === "1420") {
          cb(null, true);
          return;
        }
      } catch {
        /* ignore */
      }
      cb(new Error(`CORS blocked for origin ${origin}`), false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  await registerSecurity(app);

  app.get("/health", async () => ({
    ok: true,
    service: "agent-studio-api",
    mongoDb: config.mongoDb,
    residencyDefault: config.dataResidency,
    authRequired: config.authRequired,
  }));

  await app.register(securityRoutes);
  await app.register(workspaceRoutes);
  await app.register(runRoutes);
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(setupRoutes);
  await app.register(codeLabRoutes);
  await app.register(codegenRoutes);
  await app.register(pluginRoutes);

  try {
    await connectDb();
    app.log.info(`MongoDB connected → ${config.mongoUri} / ${config.mongoDb}`);
  } catch (err) {
    app.log.error(err);
    app.log.error(
      "Failed to connect to MongoDB. Start it with: docker compose up -d mongo",
    );
    process.exit(1);
  }

  for (const w of assertSecurityConfig()) {
    app.log.warn(`security: ${w}`);
  }

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `Agent Studio API on http://localhost:${config.port} (residency=${config.dataResidency})`,
  );

  const shutdown = async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
