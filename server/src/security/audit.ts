import { nanoid } from "nanoid";
import { auditLogs } from "../db.js";
import type { AuditEvent, Role } from "./types.js";

const US_IN_TAGS = [
  "NIST-CSF",
  "SOC2-CC",
  "DPDP-IN",
  "CERT-In",
  "IT-Act-IN",
];

export async function writeAudit(input: {
  actor: string;
  role?: Role;
  action: string;
  resourceType: string;
  resourceId?: string;
  residency?: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  detail?: Record<string, unknown>;
  frameworks?: string[];
}): Promise<void> {
  const event: AuditEvent = {
    id: `aud_${nanoid(12)}`,
    ts: new Date().toISOString(),
    actor: input.actor,
    role: input.role,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    residency: input.residency,
    ip: input.ip,
    userAgent: input.userAgent,
    success: input.success,
    detail: scrubDetail(input.detail),
    frameworks: input.frameworks ?? US_IN_TAGS,
  };

  try {
    await auditLogs().insertOne(event);
  } catch {
    // Avoid breaking request path if audit write fails; log to stderr
    console.error("[audit] failed to persist", event.id, event.action);
  }
}

/** Never persist secrets / tokens in audit detail */
function scrubDetail(
  detail?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const blocked = /secret|password|token|authorization|apikey|api_key|ciphertext/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (blocked.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = `${v.slice(0, 500)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function listAudit(opts: {
  limit?: number;
  resourceId?: string;
}): Promise<AuditEvent[]> {
  const q: Record<string, unknown> = {};
  if (opts.resourceId) q.resourceId = opts.resourceId;
  return auditLogs()
    .find(q, { projection: { _id: 0 } })
    .sort({ ts: -1 })
    .limit(opts.limit ?? 100)
    .toArray();
}
