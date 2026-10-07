/**
 * Lightweight PII / sensitive-pattern scrubbing for logs & exports.
 * Complements DPDP (IN) and US privacy expectations.
 */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "phone_in", re: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g },
  { name: "phone_us", re: /\b(?:\+1[\s-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g },
  { name: "aadhaar", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { name: "ssn_us", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "pan_in", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  {
    name: "bearer",
    re: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
  },
];

export function scrubPii(text: string): string {
  let out = text;
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export interface PrivacyMeta {
  /** DPDP purpose of processing */
  purpose?: string;
  /** US/IN data residency preference */
  residency?: "US" | "IN" | "EU" | "GLOBAL";
  classification?: DataClassification;
  /** Whether personal data may be present in stage cache / logs */
  mayContainPersonalData?: boolean;
  /** Retention override (days) */
  retentionDays?: number;
}
