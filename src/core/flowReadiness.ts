/**
 * Pre-run flight check.
 * Mandatory options block a clean run. Good-to-have options are the ones
 * that product version usually wants, and the flow can still start without them.
 */

import { getNodeDef } from "@/core/nodeRegistry";
import { getNodeSchema, type NodeFieldDef } from "@/core/nodeSchemas";
import { getPluginDrivenSchema } from "@/core/pluginNodeSchemas";
import {
  applyProductVersion,
  productForNodeType,
  versionById,
  type VersionOption,
} from "@/core/productVersions";
import { validateWorkspace } from "@/core/validate";
import type { FlowNode, WorkspaceDocument } from "@/types/workspace";

export type ReadinessVerdict = "ready" | "risky" | "blocked";

export interface OptionFinding {
  key: string;
  label: string;
  rank: "mandatory" | "good";
  status: "missing" | "set";
  detail: string;
}

export interface NodeReadiness {
  nodeId: string;
  label: string;
  type: string;
  product?: string;
  versionLabel?: string;
  verdict: ReadinessVerdict;
  options: OptionFinding[];
  challenges: string[];
}

export interface FlowFix {
  id: string;
  nodeId: string;
  title: string;
  detail: string;
  config: Record<string, unknown>;
}

export interface FlowReadiness {
  verdict: ReadinessVerdict;
  headline: string;
  willRun: boolean;
  challenges: string[];
  nodes: NodeReadiness[];
  fixes: FlowFix[];
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function shown(field: NodeFieldDef, config: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const current = String(config[field.visibleWhen.key] ?? "");
  const equals = field.visibleWhen.equals;
  return Array.isArray(equals) ? equals.includes(current) : current === equals;
}

function secretLike(opt: VersionOption): boolean {
  if (opt.kind === "password") return true;
  return /token|apikey|password|secret|privatekey/i.test(opt.key);
}

function schemaFor(type: string) {
  return getNodeSchema(type) ?? getPluginDrivenSchema(type);
}

function assessNode(node: FlowNode, connectorIds: Set<string>): NodeReadiness {
  const config = node.config ?? {};
  const def = getNodeDef(node.type);
  const schema = schemaFor(node.type);
  const product = productForNodeType(node.type);
  const version = product ? versionById(product, String(config.productVersion ?? "")) : undefined;
  const options: OptionFinding[] = [];
  const challenges: string[] = [];
  const label = node.label ?? def?.label ?? node.type;

  if (product && !version) {
    options.push({
      key: "productVersion",
      label: "Product version",
      rank: "mandatory",
      status: "missing",
      detail: `Choose a ${product.name} version. The options for that line are filled from that choice.`,
    });
    challenges.push(`${label} has no product version yet.`);
  }

  if (version) {
    for (const opt of version.options ?? []) {
      if (!blank(config[opt.key])) {
        options.push({
          key: opt.key,
          label: opt.label,
          rank: secretLike(opt) ? "mandatory" : "good",
          status: "set",
          detail: opt.help ?? `${version.label} uses ${opt.label}.`,
        });
        continue;
      }
      const mandatory = secretLike(opt);
      options.push({
        key: opt.key,
        label: opt.label,
        rank: mandatory ? "mandatory" : "good",
        status: "missing",
        detail: mandatory
          ? `${version.label} needs ${opt.label} before this node can authenticate.`
          : `${opt.label} is worth setting for ${version.label}. The node can still start without it.`,
      });
      if (mandatory) challenges.push(`${label} is missing ${opt.label}.`);
    }
  }

  const needsConnector = schema?.requiresConnector ?? def?.requiresConnector;
  if (needsConnector) {
    if (!node.connector) {
      options.push({
        key: "connector",
        label: "Connector",
        rank: "mandatory",
        status: "missing",
        detail: "Pick the saved connection this node should use.",
      });
      challenges.push(`${label} has no connector.`);
    } else if (!connectorIds.has(node.connector)) {
      options.push({
        key: "connector",
        label: "Connector",
        rank: "mandatory",
        status: "missing",
        detail: `Connector “${node.connector}” is not on this workspace.`,
      });
      challenges.push(`${label} points at a missing connector.`);
    }
  }

  for (const field of schema?.fields ?? []) {
    if (!field.required || field.key.startsWith("__")) continue;
    if (!shown(field, config)) continue;
    if (options.some((opt) => opt.key === field.key)) continue;
    const missing = blank(config[field.key]);
    options.push({
      key: field.key,
      label: field.label,
      rank: "mandatory",
      status: missing ? "missing" : "set",
      detail: missing
        ? `${field.label} is required for this node.`
        : `${field.label} is set.`,
    });
    if (missing) challenges.push(`${label} is missing ${field.label}.`);
  }

  const missingMandatory = options.some((opt) => opt.rank === "mandatory" && opt.status === "missing");
  const missingGood = options.some((opt) => opt.rank === "good" && opt.status === "missing");
  const verdict: ReadinessVerdict = missingMandatory ? "blocked" : missingGood ? "risky" : "ready";
  return {
    nodeId: node.id,
    label,
    type: node.type,
    product: product?.name,
    versionLabel: version?.label,
    verdict,
    options,
    challenges,
  };
}

function fixesFor(doc: WorkspaceDocument, nodes: NodeReadiness[]): FlowFix[] {
  const fixes: FlowFix[] = [];
  for (const item of nodes) {
    const node = doc.flow.nodes.find((n) => n.id === item.nodeId);
    if (!node) continue;
    const product = productForNodeType(node.type);
    const missingVersion = item.options.some(
      (opt) => opt.key === "productVersion" && opt.status === "missing",
    );
    if (product && missingVersion && product.versions[0]) {
      const version = product.versions[0];
      fixes.push({
        id: `version-${node.id}`,
        nodeId: node.id,
        title: `Use ${version.label} on ${item.label}`,
        detail: version.hint,
        config: applyProductVersion(node.config, product, version.id),
      });
    }
  }
  return fixes;
}

export function assessFlow(doc: WorkspaceDocument): FlowReadiness {
  const connectorIds = new Set(doc.connectors.map((c) => c.id));
  const nodes = doc.flow.nodes.map((node) => assessNode(node, connectorIds));
  const structural = validateWorkspace(doc);
  const challenges = [
    ...structural.map((issue) => issue.message),
    ...nodes.flatMap((node) => node.challenges),
  ];
  const unique = [...new Set(challenges)];
  const blocked =
    structural.some((issue) => issue.severity === "error") ||
    nodes.some((node) => node.verdict === "blocked");
  const risky = nodes.some((node) => node.verdict === "risky") || structural.some((i) => i.severity === "warning");
  const verdict: ReadinessVerdict = blocked ? "blocked" : risky ? "risky" : "ready";
  const headline =
    doc.flow.nodes.length === 0
      ? "Add a node before this flow can run."
      : verdict === "blocked"
        ? "This flow will hit a missing option before it can finish."
        : verdict === "risky"
          ? "This flow can run. A few options are good to have first."
          : "This flow looks ready to run.";
  return {
    verdict: doc.flow.nodes.length === 0 ? "blocked" : verdict,
    headline,
    willRun: doc.flow.nodes.length > 0 && !blocked,
    challenges: unique,
    nodes,
    fixes: fixesFor(doc, nodes),
  };
}

export function formatFlightBrief(report: FlowReadiness): string {
  const lines = [
    report.headline,
    report.willRun ? "Expected result: the flow can start." : "Expected result: the flow will not get through cleanly.",
  ];
  for (const node of report.nodes) {
    const missing = node.options.filter((opt) => opt.status === "missing");
    if (!missing.length) continue;
    const mandatory = missing.filter((opt) => opt.rank === "mandatory").map((opt) => opt.label);
    const good = missing.filter((opt) => opt.rank === "good").map((opt) => opt.label);
    lines.push(
      `${node.label}${node.versionLabel ? ` (${node.versionLabel})` : ""}: mandatory ${mandatory.join(", ") || "none"}; good to have ${good.join(", ") || "none"}.`,
    );
  }
  if (report.challenges.length) {
    lines.push(`Challenges: ${report.challenges.slice(0, 8).join(" ")}`);
  }
  return lines.join("\n");
}
