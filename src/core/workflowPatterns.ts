/**
 * Pattern recipes → 5–20 node workflows for Standard templates.
 * Uses real product node types from the plugin catalog (install plugins to unlock).
 */

import type { TemplateStep } from "@/core/templateTypes";

export type PatternId =
  | "elt_ingest_transform_load"
  | "cdc_stream_curate"
  | "lakehouse_medallion"
  | "dbt_warehouse"
  | "orchestrated_dag"
  | "streaming_kafka"
  | "feature_pipeline"
  | "notebook_experiment"
  | "model_train_register"
  | "rag_ingest_retrieve"
  | "llm_enrich_route"
  | "multi_agent_research"
  | "kyc_cdd"
  | "aml_monitoring"
  | "fraud_features"
  | "credit_risk_mart"
  | "claims_intake"
  | "customer_360"
  | "phi_deid"
  | "clinical_hitl"
  | "trial_validate"
  | "safety_signal"
  | "consent_analytics"
  | "dq_ge_gate"
  | "reverse_etl";

type Size = "s" | "m" | "l";

const SIZE_EXTRA: Record<Size, TemplateStep[]> = {
  s: [],
  m: [
    { type: "great_expectations.validate", label: "DQ checkpoint", connectorType: "great_expectations" },
    { type: "log", label: "Audit trail" },
  ],
  l: [
    { type: "great_expectations.validate", label: "DQ checkpoint", connectorType: "great_expectations" },
    { type: "if", label: "DQ gate" },
    { type: "human_approval", label: "Steward review" },
    { type: "notify.email", label: "Ops alert" },
    { type: "log", label: "Audit trail" },
  ],
};

function withSize(base: TemplateStep[], size: Size): TemplateStep[] {
  const extra = SIZE_EXTRA[size];
  if (!extra.length) return base;
  // Insert extras before final sink/log if present
  const out = [...base];
  const last = out[out.length - 1];
  if (last && (last.type === "log" || last.type.includes("write") || last.type.includes("unload"))) {
    out.splice(out.length - 1, 0, ...extra);
    return out;
  }
  return [...out, ...extra];
}

export function stepsForPattern(
  pattern: PatternId,
  products: string[],
  size: Size = "m",
): TemplateStep[] {
  const p = products.map((x) => x.toLowerCase());
  const has = (name: string) => p.some((x) => x.includes(name));

  const src = has("airbyte")
    ? ({ type: "airbyte.trigger_sync", label: "Airbyte sync", connectorType: "airbyte" } as TemplateStep)
    : has("fivetran")
      ? ({ type: "rest", label: "Fivetran sync API", config: { method: "POST", url: "{{FIVETRAN_SYNC_URL}}" } } as TemplateStep)
      : has("kafka")
        ? ({ type: "kafka.consume", label: "Kafka consume", connectorType: "kafka" } as TemplateStep)
        : has("mongo")
          ? ({ type: "mongodb.read", label: "Mongo extract", connectorType: "mongodb" } as TemplateStep)
          : has("postgres")
            ? ({ type: "postgres.read", label: "Postgres extract", connectorType: "postgresql" } as TemplateStep)
            : ({ type: "file.source", label: "File / landing zone", connectorType: "file" } as TemplateStep);

  const warehouse = has("snowflake")
    ? ({ type: "snowflake.load", label: "Snowflake load", connectorType: "snowflake" } as TemplateStep)
    : has("databricks")
      ? ({ type: "databricks.sql", label: "Databricks SQL", connectorType: "databricks" } as TemplateStep)
      : has("bigquery")
        ? ({ type: "bigquery.load", label: "BigQuery load", connectorType: "bigquery" } as TemplateStep)
        : has("redshift")
          ? ({ type: "redshift.copy", label: "Redshift COPY", connectorType: "redshift" } as TemplateStep)
          : ({ type: "s3.write", label: "S3 lake write", connectorType: "s3" } as TemplateStep);

  const orch = has("airflow")
    ? ({ type: "airflow.trigger_dag", label: "Airflow DAG", connectorType: "airflow" } as TemplateStep)
    : has("prefect")
      ? ({ type: "prefect.trigger_flow", label: "Prefect flow", connectorType: "prefect" } as TemplateStep)
      : has("dagster")
        ? ({ type: "dagster.launch_run", label: "Dagster run", connectorType: "dagster" } as TemplateStep)
        : null;

  const recipes: Record<PatternId, TemplateStep[]> = {
    elt_ingest_transform_load: [
      { type: "trigger.schedule", label: "Nightly schedule" },
      src,
      { type: "transform", label: "Landing normalize" },
      { type: "python", label: "Schema align" },
      ...(has("dbt")
        ? [{ type: "dbt.run", label: "dbt models", connectorType: "dbt" } as TemplateStep]
        : [{ type: "notebook", label: "Cleanup notebook" } as TemplateStep]),
      warehouse,
      { type: "log", label: "Pipeline audit" },
    ],
    cdc_stream_curate: [
      { type: "trigger.manual", label: "Start CDC" },
      has("mongo")
        ? { type: "mongodb.changestream", label: "Mongo CDC", connectorType: "mongodb" }
        : has("mysql")
          ? { type: "mysql.cdc", label: "MySQL CDC", connectorType: "mysql" }
          : { type: "kafka.consume", label: "CDC topic", connectorType: "kafka" },
      { type: "transform", label: "Normalize events" },
      { type: "if", label: "PII scrub gate" },
      { type: "python", label: "Curate entity keys" },
      warehouse,
      { type: "mongodb.write", label: "Serving store", connectorType: "mongodb" },
      { type: "log", label: "CDC audit" },
    ],
    lakehouse_medallion: [
      { type: "trigger.schedule", label: "Medallion schedule" },
      src,
      { type: "s3.write", label: "Bronze landing", connectorType: "s3" },
      { type: "spark.sql", label: "Silver Spark", connectorType: "spark" },
      { type: "transform", label: "Conform dims" },
      { type: "databricks.sql", label: "Gold tables", connectorType: "databricks" },
      { type: "great_expectations.validate", label: "Gold DQ", connectorType: "great_expectations" },
      { type: "log", label: "Medallion audit" },
    ],
    dbt_warehouse: [
      { type: "trigger.schedule", label: "dbt cadence" },
      src,
      warehouse,
      { type: "dbt.run", label: "dbt run", connectorType: "dbt" },
      { type: "dbt.test", label: "dbt test", connectorType: "dbt" },
      { type: "dbt.build", label: "dbt build", connectorType: "dbt" },
      { type: "great_expectations.validate", label: "Mart DQ", connectorType: "great_expectations" },
      { type: "notify.email", label: "Analyst notify" },
    ],
    orchestrated_dag: [
      { type: "trigger.schedule", label: "Orchestrator tick" },
      ...(orch ? [orch] : [{ type: "airflow.trigger_dag", label: "Airflow DAG", connectorType: "airflow" }]),
      src,
      { type: "transform", label: "Prep" },
      { type: "dbt.run", label: "Transform", connectorType: "dbt" },
      warehouse,
      { type: "airflow.task_status", label: "Wait tasks", connectorType: "airflow" },
      { type: "log", label: "Orchestration audit" },
    ],
    streaming_kafka: [
      { type: "trigger.manual", label: "Stream start" },
      { type: "kafka.consume", label: "Consume events", connectorType: "kafka" },
      { type: "flink.submit", label: "Flink job", connectorType: "flink" },
      { type: "transform", label: "Window aggregate" },
      { type: "redis.set", label: "Hot cache", connectorType: "redis" },
      warehouse,
      { type: "kafka.produce", label: "Downstream topic", connectorType: "kafka" },
      { type: "log", label: "Stream audit" },
    ],
    feature_pipeline: [
      { type: "trigger.schedule", label: "Feature refresh" },
      src,
      { type: "python", label: "Feature engineering" },
      { type: "notebook", label: "EDA / drift check" },
      { type: "transform", label: "Point-in-time join" },
      { type: "s3.write", label: "Feature store path", connectorType: "s3" },
      { type: "redis.set", label: "Online features", connectorType: "redis" },
      { type: "log", label: "Feature audit" },
    ],
    notebook_experiment: [
      { type: "trigger.manual", label: "Experiment start" },
      src,
      { type: "notebook", label: "Explore" },
      { type: "python", label: "Train stub" },
      { type: "if", label: "Metric gate" },
      { type: "s3.write", label: "Artifact store", connectorType: "s3" },
      { type: "log", label: "Experiment log" },
    ],
    model_train_register: [
      { type: "trigger.schedule", label: "Retrain schedule" },
      src,
      { type: "python", label: "Train model" },
      { type: "notebook", label: "Eval report" },
      { type: "great_expectations.validate", label: "Data DQ", connectorType: "great_expectations" },
      { type: "if", label: "Promote?" },
      { type: "human_approval", label: "ML owner sign-off" },
      { type: "s3.write", label: "Register artifact", connectorType: "s3" },
      { type: "notify.email", label: "Model registry notify" },
    ],
    rag_ingest_retrieve: [
      { type: "trigger.manual", label: "Ingest docs" },
      { type: "file.source", label: "Document corpus" },
      { type: "python", label: "Chunk + clean" },
      { type: "embedding", label: "Embed" },
      { type: "mongodb.write", label: "Vector store", connectorType: "mongodb" },
      { type: "rag", label: "Retrieve" },
      { type: "llm", label: "Grounded answer" },
      { type: "log", label: "RAG audit" },
    ],
    llm_enrich_route: [
      { type: "trigger.webhook", label: "Inbound event" },
      src,
      { type: "llm", label: "Classify / enrich" },
      { type: "switch", label: "Route by label", branches: ["High risk", "Standard", "Drop"] },
      { type: "agent", label: "Tool-using agent" },
      { type: "mongodb.write", label: "Persist enrichment", connectorType: "mongodb" },
      { type: "notify.email", label: "Notify owners" },
    ],
    multi_agent_research: [
      { type: "trigger.chat", label: "Research request" },
      { type: "agent", label: "Planner agent" },
      { type: "parallel", label: "Fan-out research", branches: ["Web/docs", "Structured data", "Code/notebook"] },
      { type: "llm", label: "Synthesize" },
      { type: "human_approval", label: "Analyst review" },
      { type: "file.sink", label: "Write brief" },
      { type: "log", label: "Research audit" },
    ],
    kyc_cdd: [
      { type: "trigger.webhook", label: "Onboarding event" },
      { type: "rest", label: "KYC vendor API", config: { url: "{{KYC_VENDOR_URL}}" } },
      { type: "mongodb.read", label: "Prior CDD", connectorType: "mongodb" },
      { type: "python", label: "Risk score (synthetic)" },
      { type: "llm", label: "Narrative summary" },
      { type: "if", label: "EDD required?" },
      { type: "human_approval", label: "Compliance HITL" },
      { type: "mongodb.write", label: "CDD case file", connectorType: "mongodb" },
      { type: "log", label: "KYC audit" },
    ],
    aml_monitoring: [
      { type: "trigger.schedule", label: "AML batch" },
      { type: "kafka.consume", label: "Txn stream sample", connectorType: "kafka" },
      { type: "postgres.read", label: "Customer dims", connectorType: "postgresql" },
      { type: "python", label: "Rules + anomaly" },
      { type: "if", label: "Alert threshold" },
      { type: "llm", label: "SAR narrative draft" },
      { type: "human_approval", label: "AML analyst" },
      { type: "mongodb.write", label: "Case management", connectorType: "mongodb" },
      { type: "notify.email", label: "Escalation" },
      { type: "log", label: "AML audit" },
    ],
    fraud_features: [
      { type: "trigger.manual", label: "Fraud feature job" },
      { type: "kafka.consume", label: "Auth events", connectorType: "kafka" },
      { type: "python", label: "Velocity features" },
      { type: "redis.set", label: "Online store", connectorType: "redis" },
      { type: "snowflake.load", label: "Offline store", connectorType: "snowflake" },
      { type: "great_expectations.validate", label: "Feature DQ", connectorType: "great_expectations" },
      { type: "log", label: "Fraud feature audit" },
    ],
    credit_risk_mart: [
      { type: "trigger.schedule", label: "Risk mart" },
      { type: "airbyte.trigger_sync", label: "Core banking sync", connectorType: "airbyte" },
      { type: "snowflake.load", label: "Raw risk zone", connectorType: "snowflake" },
      { type: "dbt.run", label: "Risk models", connectorType: "dbt" },
      { type: "dbt.test", label: "Risk tests", connectorType: "dbt" },
      { type: "python", label: "PD/LGD stub" },
      { type: "great_expectations.validate", label: "Mart DQ", connectorType: "great_expectations" },
      { type: "notify.email", label: "Risk desk" },
    ],
    claims_intake: [
      { type: "trigger.webhook", label: "FNOL intake" },
      { type: "file.source", label: "Claim attachments" },
      { type: "llm", label: "Extract claim fields" },
      { type: "python", label: "Coverage check stub" },
      { type: "if", label: "Fraud screen" },
      { type: "human_approval", label: "Adjuster review" },
      { type: "postgres.write", label: "Claims system", connectorType: "postgresql" },
      { type: "notify.email", label: "Customer update" },
      { type: "log", label: "Claims audit" },
    ],
    customer_360: [
      { type: "trigger.schedule", label: "360 refresh" },
      { type: "airbyte.trigger_sync", label: "CRM + core sync", connectorType: "airbyte" },
      { type: "transform", label: "Identity resolve" },
      { type: "dbt.run", label: "360 models", connectorType: "dbt" },
      { type: "snowflake.query", label: "Publish views", connectorType: "snowflake" },
      { type: "mongodb.write", label: "Serving profile", connectorType: "mongodb" },
      { type: "log", label: "360 audit" },
    ],
    phi_deid: [
      { type: "trigger.manual", label: "De-ID job" },
      { type: "file.source", label: "Clinical extract (synthetic)" },
      { type: "python", label: "PHI detect + redact" },
      { type: "great_expectations.validate", label: "De-ID DQ", connectorType: "great_expectations" },
      { type: "human_approval", label: "Privacy officer" },
      { type: "s3.write", label: "Safe lake zone", connectorType: "s3" },
      { type: "log", label: "De-ID audit" },
    ],
    clinical_hitl: [
      { type: "trigger.webhook", label: "Encounter event" },
      { type: "mongodb.read", label: "Chart notes (synthetic)", connectorType: "mongodb" },
      { type: "llm", label: "Clinical summary draft" },
      { type: "human_approval", label: "Clinician HITL" },
      { type: "if", label: "Release?" },
      { type: "mongodb.write", label: "Approved summary", connectorType: "mongodb" },
      { type: "notify.email", label: "Care team" },
      { type: "log", label: "Clinical audit" },
    ],
    trial_validate: [
      { type: "trigger.schedule", label: "Trial batch" },
      { type: "postgres.read", label: "EDC extract", connectorType: "postgresql" },
      { type: "great_expectations.validate", label: "GxP checks", connectorType: "great_expectations" },
      { type: "python", label: "Protocol rules" },
      { type: "if", label: "Query needed?" },
      { type: "human_approval", label: "Data manager" },
      { type: "s3.write", label: "Clean SDTM stub", connectorType: "s3" },
      { type: "log", label: "Trial audit" },
    ],
    safety_signal: [
      { type: "trigger.schedule", label: "Safety scan" },
      { type: "kafka.consume", label: "AE cases stream", connectorType: "kafka" },
      { type: "llm", label: "MedDRA code assist" },
      { type: "python", label: "Signal detect stub" },
      { type: "if", label: "Escalate?" },
      { type: "human_approval", label: "Safety physician" },
      { type: "notify.email", label: "PV mailbox" },
      { type: "mongodb.write", label: "Signal case", connectorType: "mongodb" },
      { type: "log", label: "Safety audit" },
    ],
    consent_analytics: [
      { type: "trigger.manual", label: "Consent-aware run" },
      { type: "postgres.read", label: "Consent ledger", connectorType: "postgresql" },
      { type: "if", label: "Purpose allowed?" },
      { type: "mongodb.read", label: "Analytics cohort", connectorType: "mongodb" },
      { type: "python", label: "Aggregate (no re-ID)" },
      { type: "s3.write", label: "Aggregate only", connectorType: "s3" },
      { type: "log", label: "Consent audit" },
    ],
    dq_ge_gate: [
      { type: "trigger.schedule", label: "DQ gate" },
      src,
      { type: "great_expectations.validate", label: "Checkpoint", connectorType: "great_expectations" },
      { type: "if", label: "Pass?" },
      warehouse,
      { type: "notify.email", label: "Fail page" },
      { type: "log", label: "DQ audit" },
    ],
    reverse_etl: [
      { type: "trigger.schedule", label: "Activation sync" },
      warehouse,
      { type: "dbt.run", label: "Audience models", connectorType: "dbt" },
      { type: "python", label: "Map to CRM fields" },
      { type: "rest", label: "Push to CRM", config: { url: "{{CRM_API}}" } },
      { type: "log", label: "Reverse ETL audit" },
    ],
  };

  return withSize(recipes[pattern], size);
}

export function connectorsForProducts(products: string[]) {
  const map: Record<string, { type: string; label: string; pluginId?: string }> = {
    airbyte: { type: "airbyte", label: "Airbyte" },
    fivetran: { type: "rest", label: "Fivetran API" },
    dbt: { type: "dbt", label: "dbt" },
    airflow: { type: "airflow", label: "Airflow" },
    prefect: { type: "prefect", label: "Prefect" },
    dagster: { type: "dagster", label: "Dagster" },
    snowflake: { type: "snowflake", label: "Snowflake" },
    databricks: { type: "databricks", label: "Databricks" },
    bigquery: { type: "bigquery", label: "BigQuery" },
    redshift: { type: "redshift", label: "Redshift" },
    kafka: { type: "kafka", label: "Kafka" },
    spark: { type: "spark", label: "Spark" },
    flink: { type: "flink", label: "Flink" },
    mongodb: { type: "mongodb", label: "MongoDB" },
    postgres: { type: "postgresql", label: "PostgreSQL", pluginId: "postgresql" },
    postgresql: { type: "postgresql", label: "PostgreSQL" },
    mysql: { type: "mysql", label: "MySQL" },
    s3: { type: "s3", label: "Amazon S3" },
    redis: { type: "redis", label: "Redis" },
    great_expectations: { type: "great_expectations", label: "Great Expectations" },
    ge: { type: "great_expectations", label: "Great Expectations" },
  };
  const seen = new Set<string>();
  const out: Array<{ type: string; label: string; pluginId?: string }> = [];
  for (const raw of products) {
    const key = raw.toLowerCase().replace(/\s+/g, "_");
    const hit =
      map[key] ||
      Object.entries(map).find(([k]) => key.includes(k))?.[1];
    if (hit && !seen.has(hit.type)) {
      seen.add(hit.type);
      out.push(hit);
    }
  }
  // Always include GE for regulated templates often
  if (!seen.has("great_expectations") && products.length > 2) {
    out.push(map.great_expectations);
  }
  return out;
}
