/**
 * Exhaustive validation of:
 * - Core node registry ↔ schemas ↔ dropdown options
 * - LLM / Agent provider option sources
 * - Plugin catalog ↔ capabilities ↔ node specs ↔ generated schemas
 * - Simulated "create node" with defaultConfig + select defaults
 *
 * Run: node --import tsx scripts/validateStudioCatalog.ts
 */

// Minimal browser stubs for modules that touch localStorage
const g = globalThis as typeof globalThis & {
  localStorage?: Storage;
  window?: unknown;
};
if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}
if (!g.window) g.window = g;

import {
  AGENT_VENDORS,
  agentTypesForVendor,
  getAgentVendor,
} from "../src/core/agentVendors.ts";
import {
  defaultConfigForType,
  getNodeSchema,
  type NodeFieldDef,
  type NodeSchema,
} from "../src/core/nodeSchemas.ts";
import { CORE_NODE_REGISTRY } from "../src/core/nodeRegistry.ts";
import {
  LLM_PROVIDERS,
  getLlmProvider,
  modelsForProvider,
} from "../src/core/llmProviders.ts";
import { PLUGIN_CATALOG } from "../src/core/pluginCatalog.ts";
import { PLUGIN_CAPABILITIES } from "../src/core/pluginNodeCatalog.ts";
import { getPluginDrivenSchema } from "../src/core/pluginNodeSchemas.ts";

type Issue = { severity: "error" | "warn"; area: string; message: string };

const issues: Issue[] = [];
let checks = 0;

function ok(area: string, msg: string) {
  checks += 1;
  // quiet success — count only
  void area;
  void msg;
}

function err(area: string, message: string) {
  checks += 1;
  issues.push({ severity: "error", area, message });
}

function warn(area: string, message: string) {
  checks += 1;
  issues.push({ severity: "warn", area, message });
}

function resolveOptions(
  field: NodeFieldDef,
  config: Record<string, unknown>,
): Array<{ value: string; label: string }> {
  if (field.optionsFrom === "llmProviders") {
    return LLM_PROVIDERS.map((p) => ({ value: p.id, label: p.name }));
  }
  if (field.optionsFrom === "llmModels") {
    return modelsForProvider(String(config.provider ?? "openai"));
  }
  if (field.optionsFrom === "agentVendors") {
    return AGENT_VENDORS.map((v) => ({ value: v.id, label: v.name }));
  }
  if (field.optionsFrom === "agentTypes") {
    return agentTypesForVendor(String(config.agentVendor ?? "langgraph"));
  }
  return field.options ?? [];
}

function validateSchemaFields(
  area: string,
  schema: NodeSchema,
  sampleConfig: Record<string, unknown>,
) {
  const keys = new Set<string>();
  for (const field of schema.fields) {
    if (!field.key) err(area, `Field missing key`);
    if (!field.label) err(area, `Field ${field.key} missing label`);
    if (!field.section) err(area, `Field ${field.key} missing section`);
    if (keys.has(field.key)) err(area, `Duplicate field key “${field.key}”`);
    keys.add(field.key);
    ok(area, `field ${field.key}`);

    const needsOptions =
      field.kind === "select" ||
      field.kind === "format" ||
      Boolean(field.optionsFrom);

    if (needsOptions) {
      const opts = resolveOptions(field, sampleConfig);
      if (!opts.length) {
        err(
          area,
          `Dropdown “${field.key}” (${field.optionsFrom ?? field.kind}) has 0 options`,
        );
      } else {
        ok(area, `dropdown ${field.key} = ${opts.length}`);
        for (const o of opts) {
          if (!o.value) err(area, `Empty option value in ${field.key}`);
          if (!o.label) warn(area, `Empty option label in ${field.key} (${o.value})`);
        }
        // default / config value must be in list when set
        const cfgVal = sampleConfig[field.key];
        if (cfgVal != null && cfgVal !== "" && field.key !== "__inputs" && field.key !== "__outputs") {
          const hit = opts.some((o) => o.value === String(cfgVal));
          if (!hit && (field.kind === "select" || field.kind === "format" || field.optionsFrom)) {
            // customModel etc. are text overrides — skip non-select
            if (field.kind === "select" || field.kind === "format" || field.optionsFrom) {
              err(
                area,
                `Config ${field.key}=“${cfgVal}” not in dropdown options`,
              );
            }
          } else {
            ok(area, `config ${field.key} in options`);
          }
        }
      }
    }

    if (field.visibleWhen) {
      const ref = schema.fields.find((f) => f.key === field.visibleWhen!.key);
      if (!ref && !sampleConfig.hasOwnProperty(field.visibleWhen.key)) {
        // referenced key might only live in defaultConfig
        if (schema.defaultConfig?.[field.visibleWhen.key] === undefined) {
          warn(
            area,
            `visibleWhen “${field.key}” refs “${field.visibleWhen.key}” not found as field`,
          );
        }
      }
    }
  }
}

function simulateCreate(type: string, schema: NodeSchema | undefined) {
  const def = CORE_NODE_REGISTRY.find((n) => n.type === type);
  const config = {
    ...(schema?.defaultConfig ?? {}),
    ...defaultConfigForType(type),
  };
  // Apply first option defaults for option fields missing values
  if (schema) {
    for (const f of schema.fields) {
      if (f.key.startsWith("__")) continue;
      if (config[f.key] != null) continue;
      if (f.defaultValue !== undefined) config[f.key] = f.defaultValue;
      else if (f.optionsFrom || f.kind === "select" || f.kind === "format") {
        const opts = resolveOptions(f, config);
        if (opts[0]) config[f.key] = opts[0].value;
      }
    }
  }
  return { def, config, label: def?.label ?? type };
}

console.log("=== Agent Studio catalog validation ===\n");

// ── LLM providers ──────────────────────────────────────────
console.log("1) LLM providers & models");
if (!LLM_PROVIDERS.length) err("llm", "No LLM providers");
for (const p of LLM_PROVIDERS) {
  if (!p.id || !p.name) err("llm", `Provider missing id/name`);
  if (!p.models.length) err("llm", `${p.id} has no models`);
  else ok("llm", `${p.id}: ${p.models.length} models`);
  const again = getLlmProvider(p.id);
  if (!again) err("llm", `getLlmProvider(${p.id}) failed`);
  const models = modelsForProvider(p.id);
  if (models.length !== p.models.length) {
    err("llm", `${p.id} modelsForProvider mismatch`);
  }
}

// ── Agent vendors ──────────────────────────────────────────
console.log("2) Agent vendors & types");
for (const v of AGENT_VENDORS) {
  if (!v.agentTypes.length) err("agent", `${v.id} has no agent types`);
  else ok("agent", `${v.id}: ${v.agentTypes.length} types`);
  if (!getAgentVendor(v.id)) err("agent", `getAgentVendor(${v.id}) failed`);
  if (!agentTypesForVendor(v.id).length) {
    err("agent", `agentTypesForVendor(${v.id}) empty`);
  }
}

// ── Core nodes one-by-one ──────────────────────────────────
console.log("3) Core nodes (create + schema + dropdowns)");
const coreTypes = CORE_NODE_REGISTRY.map((n) => n.type);
for (const type of coreTypes) {
  const schema = getNodeSchema(type);
  if (!schema) {
    err("core", `No schema for core node “${type}”`);
    continue;
  }
  if (schema.type !== type) {
    err("core", `Schema type mismatch for ${type} (got ${schema.type})`);
  }
  const created = simulateCreate(type, schema);
  if (!created.def) err("core", `Registry miss for ${type}`);
  validateSchemaFields(`core:${type}`, schema, created.config);

  // Exercise provider/model dropdowns for llm
  if (type === "llm") {
    for (const p of LLM_PROVIDERS) {
      const cfg = { ...created.config, provider: p.id, model: p.models[0]?.id };
      const modelField = schema.fields.find((f) => f.key === "model");
      if (modelField) {
        const opts = resolveOptions(modelField, cfg);
        if (!opts.length) err("core:llm", `No models for provider ${p.id}`);
        else if (!opts.some((o) => o.value === p.models[0].id)) {
          err("core:llm", `Default model missing for ${p.id}`);
        } else ok("core:llm", `provider ${p.id} models ok`);
      }
      // language dropdown
      const lang = schema.fields.find((f) => f.key === "codeLanguage");
      if (lang) {
        const opts = resolveOptions(lang, { ...cfg, enableDynamicCode: true });
        if (opts.length < 2) err("core:llm", "codeLanguage needs python+javascript");
        else ok("core:llm", "codeLanguage options ok");
      }
    }
  }

  // Exercise agent vendor/type dropdowns
  if (type === "agent") {
    for (const v of AGENT_VENDORS) {
      const cfg = {
        ...created.config,
        agentVendor: v.id,
        agentType: v.agentTypes[0]?.id,
      };
      const typeField = schema.fields.find((f) => f.key === "agentType");
      if (typeField) {
        const opts = resolveOptions(typeField, cfg);
        if (!opts.length) err("core:agent", `No types for vendor ${v.id}`);
        else ok("core:agent", `vendor ${v.id} types ok`);
      }
    }
  }
}

// Schemas without registry entry — spot-check known rich schemas exist
for (const type of ["llm", "agent", "notify.email", "mongodb.read"]) {
  if (!getNodeSchema(type) && !getPluginDrivenSchema(type)) {
    if (type === "mongodb.read" && !getNodeSchema(type)) {
      warn("schema", `mongodb.read rich schema missing (plugin schema still used)`);
    } else if (type !== "mongodb.read") {
      err("schema", `Expected schema for ${type}`);
    }
  } else {
    ok("schema", `schema present for ${type}`);
  }
}

{
  const mongo = getNodeSchema("mongodb.read");
  if (mongo) {
    const limitField = mongo.fields.find((f) => f.key === "limit");
    if (limitField?.defaultValue === 100) {
      err(
        "schema",
        "mongodb.read must not default limit to 100 (empty = read all matching)",
      );
    } else {
      ok("schema", "mongodb.read limit is optional (read-all default)");
    }
    if (
      mongo.defaultConfig &&
      "limit" in mongo.defaultConfig &&
      mongo.defaultConfig.limit != null
    ) {
      err("schema", "mongodb.read defaultConfig must omit limit");
    }
    if (!mongo.fields.some((f) => f.key === "mode")) {
      err("schema", "mongodb.read missing query mode field");
    } else {
      ok("schema", "mongodb.read has query mode");
    }
    if (!mongo.fields.some((f) => f.key === "filter" || f.key === "projection")) {
      err("schema", "mongodb.read missing filter/projection");
    } else {
      ok("schema", "mongodb.read filter + projection present");
    }
  }

  // Plugin-driven structured DB queries share the same contract
  for (const type of [
    "postgresql.query",
    "mysql.query",
    "snowflake.query",
    "bigquery.query",
    "duckdb.query",
    "elasticsearch.search",
  ]) {
    const s = getPluginDrivenSchema(type);
    if (!s) {
      err("schema", `missing plugin schema for ${type}`);
      continue;
    }
    const lim = s.fields.find((f) => f.key === "limit");
    if (lim?.defaultValue != null) {
      err("schema", `${type} must not set a default limit (read-all)`);
    } else {
      ok("schema", `${type} optional limit`);
    }
    if (!s.fields.some((f) => f.key === "filter") || !s.fields.some((f) => f.key === "projection")) {
      err("schema", `${type} missing filter/projection`);
    } else {
      ok("schema", `${type} filter + projection`);
    }
  }
}

// ── Plugins ────────────────────────────────────────────────
console.log("4) Plugins + unlocked nodes");
const catalogIds = new Set(PLUGIN_CATALOG.map((p) => p.id));
const capIds = new Set(Object.keys(PLUGIN_CAPABILITIES));

for (const id of catalogIds) {
  if (!capIds.has(id)) {
    err("plugin", `Catalog plugin “${id}” has no PLUGIN_CAPABILITIES entry`);
  }
}
for (const id of capIds) {
  if (!catalogIds.has(id)) {
    warn("plugin", `Capability “${id}” not in PLUGIN_CATALOG`);
  }
}

for (const plugin of PLUGIN_CATALOG) {
  if (!plugin.fields?.length) err("plugin", `${plugin.id} has no connector fields`);
  else ok("plugin", `${plugin.id} connector fields=${plugin.fields.length}`);

  const groups = new Set(plugin.fields.map((f) => f.group));
  if (!groups.has("connection") && !groups.has("auth")) {
    warn("plugin", `${plugin.id} missing connection/auth field groups`);
  }

  const cap = PLUGIN_CAPABILITIES[plugin.id];
  if (!cap) continue;

  if (cap.nodes.length < 5) {
    warn("plugin", `${plugin.id} has only ${cap.nodes.length} nodes (want 5–10)`);
  } else if (cap.nodes.length > 12) {
    warn("plugin", `${plugin.id} has ${cap.nodes.length} nodes (high)`);
  } else {
    ok("plugin", `${plugin.id} nodes=${cap.nodes.length}`);
  }

  const nodeTypes = new Set<string>();
  for (const node of cap.nodes) {
    if (!node.type.startsWith(plugin.id) && !node.type.startsWith(plugin.connectorType)) {
      // airflow uses airflow.* which matches id
      if (!node.type.startsWith(plugin.id.replace(/_/g, ""))) {
        warn(
          "plugin",
          `${plugin.id} node “${node.type}” prefix may not match plugin id`,
        );
      }
    }
    if (nodeTypes.has(node.type)) {
      err("plugin", `${plugin.id} duplicate node type ${node.type}`);
    }
    nodeTypes.add(node.type);

    if (!node.label || !node.description || !node.kind) {
      err("plugin", `${plugin.id}/${node.type} missing label/description/kind`);
    }

    // Generated schema + dropdowns
    const gen = getPluginDrivenSchema(node.type);
    if (!gen) {
      // findPluginNodeSpec should find it
      err("plugin", `No generated schema for ${node.type}`);
      continue;
    }
    const created = simulateCreate(node.type, gen);
    validateSchemaFields(`plugin-node:${node.type}`, gen, created.config);

    // unlocks list in catalog should mention some nodes (optional legacy)
    ok("plugin", `node ${node.type} schema ok`);
  }
}

// Cross-check: every capability node unique globally
console.log("5) Global uniqueness");
const allPluginTypes = Object.values(PLUGIN_CAPABILITIES).flatMap((c) =>
  c.nodes.map((n) => n.type),
);
const seen = new Map<string, string>();
for (const [pid, cap] of Object.entries(PLUGIN_CAPABILITIES)) {
  for (const n of cap.nodes) {
    if (seen.has(n.type)) {
      err(
        "unique",
        `Node type “${n.type}” in both ${seen.get(n.type)} and ${pid}`,
      );
    } else {
      seen.set(n.type, pid);
      ok("unique", n.type);
    }
  }
}

// Core vs plugin collision
for (const t of allPluginTypes) {
  if (CORE_NODE_REGISTRY.some((n) => n.type === t)) {
    err("unique", `Plugin node “${t}” collides with core registry`);
  }
}

// ── Report ─────────────────────────────────────────────────
const errors = issues.filter((i) => i.severity === "error");
const warns = issues.filter((i) => i.severity === "warn");

console.log("\n=== Summary ===");
console.log(`Checks: ${checks}`);
console.log(`Core nodes: ${coreTypes.length}`);
console.log(`LLM providers: ${LLM_PROVIDERS.length}`);
console.log(`Agent vendors: ${AGENT_VENDORS.length}`);
console.log(`Plugins: ${PLUGIN_CATALOG.length}`);
console.log(`Plugin nodes: ${allPluginTypes.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warns.length}`);

if (errors.length) {
  console.log("\n--- ERRORS ---");
  for (const i of errors) console.log(`[${i.area}] ${i.message}`);
}
if (warns.length) {
  console.log("\n--- WARNINGS ---");
  for (const i of warns) console.log(`[${i.area}] ${i.message}`);
}

if (errors.length) {
  process.exitCode = 1;
} else {
  console.log("\nAll critical validations passed.");
}
