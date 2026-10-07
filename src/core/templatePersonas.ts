import type { TemplateDomain } from "@/core/templateTypes";

/** Persona buckets sit on top of the existing domain tags. No template is removed. */
export type TemplatePersona = "data-eng" | "ai-eng" | "devops" | "system-eng";

export const PERSONA_LABELS: Record<TemplatePersona, string> = {
  "data-eng": "Data Eng",
  "ai-eng": "AI Eng",
  devops: "DevOps",
  "system-eng": "System Eng",
};

const DEVOPS = /airflow|prefect|dagster|dbt|nifi|temporal|great_expectations|mlops/;
const SYSTEM = /kafka|flink|spark|redis|nifi|kubernetes|infra/;

export function personaFor(input: {
  domain: TemplateDomain | string;
  products?: string[];
  tags?: string[];
}): TemplatePersona {
  const blob = `${input.domain} ${(input.products ?? []).join(" ")} ${(input.tags ?? []).join(" ")}`.toLowerCase();
  if (DEVOPS.test(blob)) return "devops";
  if (SYSTEM.test(blob)) return "system-eng";
  if (input.domain === "ai" || input.domain === "ds" || input.domain === "mlops") return "ai-eng";
  return "data-eng";
}

export function whatItDoes(input: {
  description: string;
  products?: string[];
  nodeCount?: number;
}): string {
  const products = (input.products ?? []).slice(0, 4).join(", ");
  const size = input.nodeCount ? ` It places ${input.nodeCount} nodes on the canvas.` : "";
  const uses = products ? ` It uses ${products}.` : "";
  return `${input.description.trim()}${uses}${size}`;
}
