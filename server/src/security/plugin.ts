import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { writeAudit } from "./audit.js";
import {
  authenticateApiKey,
  hasConfiguredKeys,
  roleAllows,
  type AuthPrincipal,
} from "./auth.js";
import type { Role } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: AuthPrincipal;
  }
}

function clientMeta(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

export async function registerSecurity(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    // Public endpoints
    const path = req.url.split("?")[0];
    if (path === "/health" || path === "/security/policy") {
      return;
    }

    const keyHeader =
      (req.headers["x-api-key"] as string | undefined) ??
      (req.headers.authorization as string | undefined);

    const principal = authenticateApiKey(keyHeader);

    if (config.authRequired || hasConfiguredKeys()) {
      // Once keys are configured, reject invalid/missing credentials even if a
      // developer has accidentally left AUTH_REQUIRED=false. Never fall back to admin.
      if (!principal) {
        await writeAudit({
          actor: "anonymous",
          action: "auth.denied",
          resourceType: "api",
          resourceId: path,
          success: false,
          ...clientMeta(req),
          detail: { reason: "missing_or_invalid_api_key" },
        });
        return reply.code(401).send({
          error: "Unauthorized — provide X-API-Key",
          code: "AUTH_REQUIRED",
          frameworks: ["NIST-CSF", "DPDP-IN", "SOC2-CC"],
        });
      }
      req.principal = principal;
    }

    // Unauthenticated access is allowed only for explicitly local development/desktop mode.
    // Network binding without authentication is rejected by startup configuration validation.
    if (!req.principal) {
      req.principal = {
        keyId: config.desktopApp ? "local-desktop" : "local-dev",
        role: config.desktopApp || config.nodeEnv !== "production" ? "admin" : "viewer",
      };
    }
  });
}

export function requireRole(
  min: "read" | "write" | "admin",
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role: Role = req.principal?.role ?? "viewer";
    if (!roleAllows(role, min)) {
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role,
        action: "auth.forbidden",
        resourceType: "api",
        resourceId: req.url,
        success: false,
        ...{
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        },
        detail: { required: min },
      });
      return reply.code(403).send({
        error: "Forbidden for this role",
        code: "RBAC_DENIED",
        role,
      });
    }
  };
}
