import {
  buildWorkspaceFromSteps,
  placeholderConnectors,
  type StudioTemplate,
  type TemplateVariable,
} from "@/core/templateTypes";
import { STANDARD_SEEDS } from "@/core/standardTemplateSeed";
import {
  connectorsForProducts,
  stepsForPattern,
} from "@/core/workflowPatterns";

const DEFAULT_VARS: TemplateVariable[] = [
  {
    key: "ENV",
    label: "Environment",
    example: "sandbox",
    description: "Never point templates at prod without review",
  },
  {
    key: "DATASET",
    label: "Dataset / schema",
    example: "demo_synthetic",
  },
];

function seedToTemplate(seed: (typeof STANDARD_SEEDS)[number]): StudioTemplate {
  const size = seed.size ?? "m";
  const steps = stepsForPattern(seed.pattern, seed.products, size);
  const connectors = placeholderConnectors(
    connectorsForProducts(seed.products),
  );
  return {
    id: seed.id,
    name: seed.name,
    description: seed.description,
    domain: seed.domain,
    products: seed.products,
    industry: seed.industry,
    origin: "standard",
    nodeCount: steps.reduce(
      (n, s) => n + 1 + (s.branches?.length ?? 0),
      0,
    ),
    tags: seed.tags,
    variables: DEFAULT_VARS,
    create: () =>
      buildWorkspaceFromSteps({
        name: seed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: `${seed.description} — synthetic template; replace connectors & secrets.`,
        steps,
        connectors,
        variables: DEFAULT_VARS,
      }),
  };
}

let cache: StudioTemplate[] | null = null;

export function getStandardTemplates(): StudioTemplate[] {
  if (!cache) cache = STANDARD_SEEDS.map(seedToTemplate);
  return cache;
}

export function getStandardTemplate(id: string): StudioTemplate | undefined {
  return getStandardTemplates().find((t) => t.id === id);
}

export const STANDARD_TEMPLATE_COUNT = STANDARD_SEEDS.length;

export const DOMAIN_LABELS: Record<string, string> = {
  de: "Data Engineering",
  ds: "Data Science",
  ai: "AI / Agents",
  bfsi: "BFSI",
  healthcare: "Healthcare / Pharma",
  etl: "ETL / ELT",
  mlops: "MLOps",
};
