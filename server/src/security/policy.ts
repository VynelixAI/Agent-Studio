import { config } from "../config.js";
import type { SecurityPolicySnapshot } from "./types.js";

/**
 * Controls mapped to US + India expectations.
 * This is an engineering control matrix — not a legal certification claim.
 */
export function getSecurityPolicy(): SecurityPolicySnapshot {
  return {
    authRequired: config.authRequired,
    dataResidencyDefault: config.dataResidency,
    auditRetentionDays: config.auditRetentionDays,
    runRetentionDays: config.runRetentionDays,
    encryptionAtRest: "AES-256-GCM",
    secretsInYaml: "reference-only",
    frameworks: [
      {
        id: "NIST-CSF-2.0",
        region: "US",
        title: "NIST Cybersecurity Framework",
        controlsImplemented: [
          "Identify: asset inventory (workspaces, connectors, runs)",
          "Protect: API key auth, RBAC, AES-256-GCM secrets, rate limits, security headers",
          "Detect: audit trail for apply/run/secret changes",
          "Respond: security contact + audit export",
          "Recover: versioned workspace YAML snapshots",
        ],
      },
      {
        id: "SOC2-aligned",
        region: "US",
        title: "SOC 2 Trust Services (aligned practices)",
        controlsImplemented: [
          "Security: encryption at rest for secrets, least-privilege roles",
          "Availability: health checks, retention policies",
          "Confidentiality: secretRef-only YAML, redacted audit logs",
          "Privacy: purpose + residency metadata on workspaces",
          "Processing integrity: versioned apply (override vs new_version)",
        ],
      },
      {
        id: "CCPA-CPRA-ready",
        region: "US",
        title: "CCPA / CPRA readiness (US privacy)",
        controlsImplemented: [
          "Data inventory via workspace classification",
          "Deletion / retention windows for runs & audit",
          "Access logging for personal-data-adjacent operations",
        ],
      },
      {
        id: "DPDP-2023",
        region: "IN",
        title: "India Digital Personal Data Protection Act, 2023",
        controlsImplemented: [
          "Purpose limitation fields on workspaces",
          "Data fiduciary contact (PRIVACY_CONTACT)",
          "Storage limitation via retention days",
          "Security safeguards: encryption, access control, audit",
          "Residency preference default IN (configurable)",
        ],
      },
      {
        id: "CERT-In",
        region: "IN",
        title: "CERT-In cybersecurity directions (aligned)",
        controlsImplemented: [
          "Audit logs with timestamps for security-relevant events",
          "Incident contact (SECURITY_CONTACT)",
          "Log retention configurable (≥90d recommended)",
        ],
      },
      {
        id: "IT-Act-2000",
        region: "IN",
        title: "IT Act 2000 / reasonable security practices",
        controlsImplemented: [
          "Reasonable security practices: encryption, auth, audit",
          "Access control and secret hygiene",
        ],
      },
    ],
  };
}
