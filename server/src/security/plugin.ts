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
      // If keys configured OR auth required, enforce on protected routes
      if (config.authRequired && !principal) {
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
      if (principal) {
        req.principal = principal;
      } else if (config.authRequired) {
        return reply.code(401).send({ error: "Unauthorized", code: "AUTH_REQUIRED" });
      }
    }

    // When auth not required and no key, treat as local-dev operator
    if (!req.principal) {
      req.principal = { keyId: "local-dev", role: "admin" };
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
