import type { FastifyInstance } from "fastify";
import { assertSecurityConfig, config } from "../config.js";
import { listAudit, writeAudit } from "../security/audit.js";
import { hasConfiguredKeys } from "../security/auth.js";
import { getSecurityPolicy } from "../security/policy.js";
import { requireRole } from "../security/plugin.js";
import { purgeExpired } from "../security/retention.js";

export async function securityRoutes(app: FastifyInstance) {
  app.get("/security/policy", async () => {
    const warnings = assertSecurityConfig();
    return {
      ...getSecurityPolicy(),
      contacts: {
        privacy: config.privacyContact,
        security: config.securityContact,
      },
      warnings,
      authConfigured: hasConfiguredKeys(),
      disclaimer:
        "Controls are aligned to US (NIST/SOC2/CCPA) and India (DPDP/CERT-In/IT Act) expectations. This is not a legal certification.",
    };
  });

  app.get(
    "/security/audit",
    { preHandler: requireRole("admin") },
    async (req) => {
      const q = req.query as { limit?: string; resourceId?: string };
      const items = await listAudit({
        limit: q.limit ? Number(q.limit) : 100,
        resourceId: q.resourceId,
      });
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "audit.read",
        resourceType: "audit",
        success: true,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return { items };
    },
  );

  app.post(
    "/security/retention/purge",
    { preHandler: requireRole("admin") },
    async (req) => {
      const result = await purgeExpired();
      await writeAudit({
        actor: req.principal?.keyId ?? "unknown",
        role: req.principal?.role,
        action: "retention.purge",
        resourceType: "system",
        success: true,
        detail: result,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return result;
    },
  );
}
