export type Role = "admin" | "operator" | "viewer";

export interface AuditEvent {
  id: string;
  ts: string;
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
  /** Framework tags for reporting */
  frameworks: string[];
}

export interface SecurityPolicySnapshot {
  authRequired: boolean;
  dataResidencyDefault: string;
  auditRetentionDays: number;
  runRetentionDays: number;
  encryptionAtRest: "AES-256-GCM";
  secretsInYaml: "reference-only";
  frameworks: Array<{
    id: string;
    region: "US" | "IN" | "BOTH";
    title: string;
    controlsImplemented: string[];
  }>;
}
