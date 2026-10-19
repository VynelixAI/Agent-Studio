import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSecurityConfig, config, securityConfigErrors } from "./config.js";
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
import { runProcess } from "./services/processRunner.js";

const API_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const securityErrors = securityConfigErrors();
  if (securityErrors.length) {
    throw new Error(`Unsafe Agent Studio API configuration:\n- ${securityErrors.join("\n- ")}`);
  }

  if (config.runnerSandbox === "docker") {
    const imageCheck = await runProcess(
      "docker",
      ["image", "inspect", config.runnerDockerImage],
      { cwd: API_MODULE_DIR, timeoutMs: 10_000, maxStdoutChars: 2_000, maxStderrChars: 2_000 },
    );
    if (imageCheck.code !== 0) {
      throw new Error(
        `RUNNER_SANDBOX=docker requires Docker and image '${config.runnerDockerImage}'. ` +
          `Build it with: docker build -f server/sandbox/Dockerfile -t ${config.runnerDockerImage} server/sandbox. ` +
          imageCheck.stderr.trim(),
      );
    }
  }

  const app = Fastify({
    logger: true,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120_000,
    requestIdHeader: "x-request-id",
    genReqId: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false, // API JSON — CSP for UI is Vite/Tauri side
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const raw = String(config.corsOrigin ?? "").trim();
      // Non-browser clients commonly omit Origin. Browser origins remain allow-listed.
      if (!origin) {
        cb(null, true);
        return;
      }
      const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(config.apiHost.toLowerCase());
      if (raw === "*" && config.nodeEnv !== "production" && loopback) {
        cb(null, true);
        return;
      }
      const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      // Convenience for Vite preview/dev is intentionally disabled in production.
      if (config.nodeEnv !== "production") {
        try {
          const u = new URL(origin);
          if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.port === "1420") {
            cb(null, true);
            return;
          }
        } catch {
          /* ignore */
        }
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

  // Keep the unauthenticated health endpoint free of configuration details.
  app.get("/health", async () => ({
    ok: true,
    service: "agent-studio-api",
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
    app.log.info({ mongoDb: config.mongoDb }, "MongoDB connected");
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

  await app.listen({ port: config.port, host: config.apiHost });
  app.log.info(
    `Agent Studio API listening on ${config.apiHost}:${config.port} (residency=${config.dataResidency})`,
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
