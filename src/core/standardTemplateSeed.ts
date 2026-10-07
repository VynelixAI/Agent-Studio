/**
 * 100+ Standard template definitions (metadata + pattern).
 * Graphs are built at load time — synthetic fixtures only, no secrets/PHI.
 */

import type { TemplateDomain } from "@/core/templateTypes";
import type { PatternId } from "@/core/workflowPatterns";

export type Size = "s" | "m" | "l";

export interface StandardSeed {
  id: string;
  name: string;
  description: string;
  domain: TemplateDomain;
  products: string[];
  industry?: string;
  pattern: PatternId;
  size?: Size;
  tags?: string[];
}

/** Compact catalog — expanded to full StudioTemplate in standardTemplates.ts */
export const STANDARD_SEEDS: StandardSeed[] = [
  // ── Data Engineering / Modern stack ─────────────────────
  { id: "std-airbyte-snowflake-dbt", name: "Airbyte → Snowflake → dbt", description: "EL + warehouse models with dbt test gate", domain: "de", products: ["Airbyte", "Snowflake", "dbt"], pattern: "elt_ingest_transform_load", size: "m", tags: ["elt", "modern-data-stack"] },
  { id: "std-fivetran-bq-dbt", name: "Fivetran → BigQuery → dbt", description: "SaaS EL into BQ curated marts", domain: "de", products: ["Fivetran", "BigQuery", "dbt"], pattern: "dbt_warehouse", size: "m" },
  { id: "std-airbyte-databricks-dbt", name: "Airbyte → Databricks → dbt", description: "Lakehouse ingest + dbt on Databricks SQL", domain: "de", products: ["Airbyte", "Databricks", "dbt"], pattern: "elt_ingest_transform_load", size: "l" },
  { id: "std-airflow-elt", name: "Airflow-orchestrated ELT", description: "Airflow DAG wrapping extract → dbt → load", domain: "etl", products: ["Airflow", "Airbyte", "dbt", "Snowflake"], pattern: "orchestrated_dag", size: "l" },
  { id: "std-prefect-elt", name: "Prefect ELT flow", description: "Prefect-triggered sync + transform + lake write", domain: "etl", products: ["Prefect", "Airbyte", "S3", "dbt"], pattern: "orchestrated_dag", size: "m" },
  { id: "std-dagster-assets", name: "Dagster asset materialize", description: "Software-defined assets via Dagster + dbt", domain: "etl", products: ["Dagster", "dbt", "Snowflake"], pattern: "orchestrated_dag", size: "m" },
  { id: "std-medallion-databricks", name: "Medallion lakehouse (Databricks)", description: "Bronze → Silver Spark → Gold SQL", domain: "de", products: ["Databricks", "Spark", "S3", "Airbyte"], pattern: "lakehouse_medallion", size: "l" },
  { id: "std-kafka-flink-snowflake", name: "Kafka → Flink → Snowflake", description: "Streaming ETL with Flink and warehouse sink", domain: "de", products: ["Kafka", "Flink", "Snowflake", "Redis"], pattern: "streaming_kafka", size: "l" },
  { id: "std-mongo-cdc-360", name: "Mongo CDC → Customer 360", description: "Change streams curated into serving profile", domain: "de", products: ["MongoDB", "Snowflake", "dbt"], pattern: "cdc_stream_curate", size: "m" },
  { id: "std-postgres-cdc-kafka", name: "Postgres CDC → Kafka", description: "Operational CDC fan-out pattern", domain: "de", products: ["PostgreSQL", "Kafka", "S3"], pattern: "cdc_stream_curate", size: "m" },
  { id: "std-s3-spark-curate", name: "S3 landing → Spark curate", description: "Object landing zone with Spark SQL silver", domain: "de", products: ["S3", "Spark", "Databricks"], pattern: "lakehouse_medallion", size: "m" },
  { id: "std-ge-quality-gate", name: "Great Expectations quality gate", description: "Validate before promote to warehouse", domain: "de", products: ["Great Expectations", "Airbyte", "Snowflake"], pattern: "dq_ge_gate", size: "s" },
  { id: "std-nifi-ingest", name: "NiFi-style ingest (API)", description: "Webhook/file ingest with transform and S3", domain: "de", products: ["S3", "MongoDB"], pattern: "elt_ingest_transform_load", size: "s", tags: ["nifi-pattern"] },
  { id: "std-redshift-spectrum", name: "Redshift ELT + dbt", description: "Classic warehouse ELT on Redshift", domain: "de", products: ["Airbyte", "Redshift", "dbt"], pattern: "dbt_warehouse", size: "m" },
  { id: "std-mysql-to-bq", name: "MySQL → BigQuery", description: "CDC/batch from MySQL into BQ", domain: "de", products: ["MySQL", "BigQuery", "Airbyte"], pattern: "cdc_stream_curate", size: "m" },
  { id: "std-gcs-bq-load", name: "GCS → BigQuery load", description: "Cloud storage staged load pattern", domain: "de", products: ["BigQuery", "Airbyte", "dbt"], pattern: "elt_ingest_transform_load", size: "s" },
  { id: "std-azure-blob-synapse", name: "Azure Blob → warehouse", description: "Blob landing to curated warehouse path", domain: "de", products: ["S3", "Snowflake", "dbt"], pattern: "lakehouse_medallion", size: "m", tags: ["azure"] },
  { id: "std-trino-federated", name: "Trino federated query + land", description: "Federated read then persist curated set", domain: "de", products: ["S3", "dbt", "Snowflake"], pattern: "elt_ingest_transform_load", size: "s", tags: ["trino"] },
  { id: "std-clickhouse-events", name: "ClickHouse event curate", description: "High-volume events into analytic store", domain: "de", products: ["Kafka", "S3", "dbt"], pattern: "streaming_kafka", size: "m", tags: ["clickhouse"] },
  { id: "std-duckdb-local-elt", name: "DuckDB local ELT", description: "Laptop-scale extract → notebook → parquet", domain: "de", products: ["S3", "PostgreSQL"], pattern: "notebook_experiment", size: "s", tags: ["duckdb"] },
  { id: "std-reverse-etl-crm", name: "Reverse ETL to CRM", description: "Warehouse audiences pushed to CRM API", domain: "etl", products: ["Snowflake", "dbt"], pattern: "reverse_etl", size: "m" },
  { id: "std-airbyte-postgres-s3", name: "Airbyte → Postgres → S3 archive", description: "OLTP sync with cold archive", domain: "de", products: ["Airbyte", "PostgreSQL", "S3"], pattern: "elt_ingest_transform_load", size: "m" },
  { id: "std-informatica-style-cdc", name: "Enterprise CDC + stewardship", description: "CDC with DQ, HITL steward, audit (Informatica-style)", domain: "de", products: ["Kafka", "Snowflake", "Great Expectations", "dbt"], pattern: "cdc_stream_curate", size: "l", tags: ["governance", "lineage"] },
  { id: "std-lineage-audit-pack", name: "Lineage-ready audit pack", description: "Extract → transform → GE → warehouse + audit log", domain: "de", products: ["Airbyte", "dbt", "Snowflake", "Great Expectations"], pattern: "dq_ge_gate", size: "l", tags: ["governance"] },

  // ── Data Science / ML ───────────────────────────────────
  { id: "std-ds-feature-store", name: "Feature store batch + online", description: "Offline S3 + Redis online features", domain: "ds", products: ["S3", "Redis", "PostgreSQL", "Spark"], pattern: "feature_pipeline", size: "l" },
  { id: "std-ds-notebook-eda", name: "Notebook EDA → artifact", description: "Explore, train stub, gate, store artifact", domain: "ds", products: ["S3", "MongoDB"], pattern: "notebook_experiment", size: "m" },
  { id: "std-ds-train-register", name: "Train → evaluate → register", description: "Scheduled retrain with human promote", domain: "mlops", products: ["S3", "Great Expectations", "PostgreSQL"], pattern: "model_train_register", size: "l" },
  { id: "std-ds-databricks-notebook", name: "Databricks notebook job", description: "Warehouse pull into Databricks notebook path", domain: "ds", products: ["Databricks", "S3", "dbt"], pattern: "notebook_experiment", size: "m" },
  { id: "std-ds-snowflake-features", name: "Snowflake feature mart", description: "dbt features materialized for DS", domain: "ds", products: ["Snowflake", "dbt", "Airbyte"], pattern: "feature_pipeline", size: "m" },
  { id: "std-ds-drift-monitor", name: "Drift monitor + alert", description: "Score batch, DQ, notify on drift", domain: "mlops", products: ["S3", "Great Expectations", "PostgreSQL"], pattern: "model_train_register", size: "m", tags: ["monitoring"] },
  { id: "std-ds-ab-eval", name: "Offline A/B eval pipeline", description: "Pull exposures, notebook eval, publish metrics", domain: "ds", products: ["BigQuery", "S3"], pattern: "notebook_experiment", size: "m" },
  { id: "std-ds-spark-ml-prep", name: "Spark ML prep", description: "Spark SQL feature prep to lake", domain: "ds", products: ["Spark", "S3", "Databricks"], pattern: "feature_pipeline", size: "m" },
  { id: "std-ds-kafka-features", name: "Streaming features (Kafka)", description: "Event → features → Redis online", domain: "ds", products: ["Kafka", "Redis", "Flink", "S3"], pattern: "feature_pipeline", size: "l" },
  { id: "std-ds-ge-training-gate", name: "Training data GE gate", description: "Block train if data DQ fails", domain: "mlops", products: ["Great Expectations", "S3", "PostgreSQL"], pattern: "dq_ge_gate", size: "s" },
  { id: "std-ds-batch-score", name: "Batch scoring pipeline", description: "Load features, python score, write predictions", domain: "mlops", products: ["Snowflake", "S3"], pattern: "feature_pipeline", size: "m" },
  { id: "std-ds-embedding-export", name: "Embedding export job", description: "Corpus → embed → vector store", domain: "ds", products: ["MongoDB", "S3"], pattern: "rag_ingest_retrieve", size: "m", tags: ["embeddings"] },

  // ── AI / Agents / RAG ───────────────────────────────────
  { id: "std-ai-rag-mongo", name: "RAG ingest + answer (Mongo)", description: "Chunk, embed, retrieve, grounded LLM", domain: "ai", products: ["MongoDB", "S3"], pattern: "rag_ingest_retrieve", size: "m", tags: ["langchain", "rag"] },
  { id: "std-ai-llm-enrich", name: "LLM enrichment + route", description: "Classify inbound records and branch", domain: "ai", products: ["MongoDB"], pattern: "llm_enrich_route", size: "m" },
  { id: "std-ai-multi-agent", name: "Multi-agent research team", description: "Planner + parallel specialists + HITL", domain: "ai", products: ["S3"], pattern: "multi_agent_research", size: "l", tags: ["langgraph", "crewai"] },
  { id: "std-ai-support-agent", name: "Support agent with tools", description: "Webhook → agent → CRM writeback", domain: "ai", products: ["PostgreSQL", "MongoDB"], pattern: "llm_enrich_route", size: "m" },
  { id: "std-ai-doc-qa", name: "Document Q&A desk", description: "Ingest docs, RAG, clinician/analyst style HITL optional", domain: "ai", products: ["MongoDB", "S3"], pattern: "rag_ingest_retrieve", size: "l" },
  { id: "std-ai-prompt-eval", name: "Prompt eval harness", description: "Batch prompts, score, gate promote", domain: "ai", products: ["S3", "Great Expectations"], pattern: "model_train_register", size: "m", tags: ["evals"] },
  { id: "std-ai-kafka-enrich", name: "Stream LLM enrich", description: "Kafka events enriched by LLM then produced", domain: "ai", products: ["Kafka", "Redis", "MongoDB"], pattern: "llm_enrich_route", size: "l" },
  { id: "std-ai-databricks-rag", name: "Databricks + RAG hybrid", description: "Lake features + vector retrieve + LLM", domain: "ai", products: ["Databricks", "MongoDB", "S3"], pattern: "rag_ingest_retrieve", size: "l" },
  { id: "std-ai-agent-orchestration", name: "Agent + sub-workflow", description: "Supervisor agent pattern with tools", domain: "ai", products: ["MongoDB"], pattern: "multi_agent_research", size: "m" },
  { id: "std-ai-content-moderation", name: "Content moderation pipeline", description: "LLM classify + human escalate", domain: "ai", products: ["S3", "MongoDB"], pattern: "llm_enrich_route", size: "m" },
  { id: "std-ai-code-assistant-etl", name: "Code-assist ETL review", description: "PR/diff summary agent + human approve", domain: "ai", products: ["S3", "Git"], pattern: "multi_agent_research", size: "s", tags: ["devtools"] },
  { id: "std-ai-meeting-notes", name: "Meeting notes → CRM", description: "Transcript → LLM → structured CRM push", domain: "ai", products: ["PostgreSQL"], pattern: "llm_enrich_route", size: "s" },

  // ── BFSI ────────────────────────────────────────────────
  { id: "std-bfsi-kyc-cdd", name: "KYC / CDD onboarding", description: "Vendor KYC + risk + compliance HITL (synthetic)", domain: "bfsi", products: ["MongoDB", "PostgreSQL"], industry: "banking", pattern: "kyc_cdd", size: "l", tags: ["kyc", "cdd"] },
  { id: "std-bfsi-aml", name: "AML transaction monitoring", description: "Rules + anomaly + SAR draft + analyst", domain: "bfsi", products: ["Kafka", "PostgreSQL", "MongoDB"], industry: "banking", pattern: "aml_monitoring", size: "l", tags: ["aml"] },
  { id: "std-bfsi-fraud-features", name: "Fraud feature pipeline", description: "Auth velocity features to online/offline store", domain: "bfsi", products: ["Kafka", "Redis", "Snowflake", "Great Expectations"], industry: "banking", pattern: "fraud_features", size: "m", tags: ["fraud"] },
  { id: "std-bfsi-credit-risk", name: "Credit risk mart", description: "Core sync → dbt risk models → desk notify", domain: "bfsi", products: ["Airbyte", "Snowflake", "dbt", "Great Expectations"], industry: "banking", pattern: "credit_risk_mart", size: "l", tags: ["credit-risk"] },
  { id: "std-bfsi-claims", name: "Insurance claims intake", description: "FNOL → extract → fraud screen → adjuster", domain: "bfsi", products: ["PostgreSQL", "S3"], industry: "insurance", pattern: "claims_intake", size: "l", tags: ["claims"] },
  { id: "std-bfsi-customer-360", name: "BFSI Customer 360", description: "CRM + core → identity → serving profile", domain: "bfsi", products: ["Airbyte", "dbt", "Snowflake", "MongoDB"], industry: "banking", pattern: "customer_360", size: "l", tags: ["c360"] },
  { id: "std-bfsi-card-auth-stream", name: "Card auth streaming score", description: "Kafka auth → features → decision stub", domain: "bfsi", products: ["Kafka", "Redis", "Flink"], industry: "banking", pattern: "streaming_kafka", size: "m", tags: ["fraud"] },
  { id: "std-bfsi-policy-admin", name: "Policy admin sync", description: "Policy systems ELT into warehouse marts", domain: "bfsi", products: ["Airbyte", "Snowflake", "dbt"], industry: "insurance", pattern: "dbt_warehouse", size: "m" },
  { id: "std-bfsi-trade-surveillance", name: "Trade surveillance batch", description: "Trades ingest → rules → HITL escalate", domain: "bfsi", products: ["Kafka", "Snowflake", "MongoDB"], industry: "capital-markets", pattern: "aml_monitoring", size: "l", tags: ["surveillance"] },
  { id: "std-bfsi-loan-origination", name: "Loan origination enrichment", description: "Application webhook → bureau stub → decision", domain: "bfsi", products: ["PostgreSQL", "MongoDB"], industry: "banking", pattern: "kyc_cdd", size: "m", tags: ["lending"] },
  { id: "std-bfsi-payments-recon", name: "Payments reconciliation", description: "Multi-source recon with GE gate", domain: "bfsi", products: ["Airbyte", "Snowflake", "Great Expectations", "dbt"], industry: "banking", pattern: "dq_ge_gate", size: "m", tags: ["payments"] },
  { id: "std-bfsi-wealth-360", name: "Wealth Customer 360", description: "Custody + CRM unified profile", domain: "bfsi", products: ["Airbyte", "dbt", "Snowflake", "MongoDB"], industry: "wealth", pattern: "customer_360", size: "m" },
  { id: "std-bfsi-actuarial-mart", name: "Actuarial mart (dbt)", description: "Policy/claims marts for actuarial", domain: "bfsi", products: ["Snowflake", "dbt", "Airbyte"], industry: "insurance", pattern: "dbt_warehouse", size: "m" },
  { id: "std-bfsi-sanctions-screen", name: "Sanctions screening flow", description: "Name screen API + HITL false-positive review", domain: "bfsi", products: ["MongoDB"], industry: "banking", pattern: "kyc_cdd", size: "s", tags: ["sanctions"] },
  { id: "std-bfsi-open-banking-elt", name: "Open banking ELT", description: "Consented account data into lakehouse", domain: "bfsi", products: ["Airbyte", "S3", "dbt", "Snowflake"], industry: "banking", pattern: "lakehouse_medallion", size: "m", tags: ["open-banking"] },

  // ── Healthcare / Pharma ─────────────────────────────────
  { id: "std-hc-phi-deid", name: "PHI de-identification", description: "Detect/redact PHI → privacy officer → safe zone", domain: "healthcare", products: ["S3", "Great Expectations"], industry: "healthcare", pattern: "phi_deid", size: "m", tags: ["hipaa", "synthetic-only"] },
  { id: "std-hc-clinical-hitl", name: "Clinical summary HITL", description: "LLM draft + clinician approve (synthetic notes)", domain: "healthcare", products: ["MongoDB"], industry: "healthcare", pattern: "clinical_hitl", size: "m", tags: ["hitl"] },
  { id: "std-hc-trial-validate", name: "Clinical trial validate", description: "EDC extract → GxP checks → data manager", domain: "healthcare", products: ["PostgreSQL", "Great Expectations", "S3"], industry: "pharma", pattern: "trial_validate", size: "l", tags: ["gxp"] },
  { id: "std-hc-safety-signal", name: "Pharmacovigilance signal", description: "AE stream → coding assist → physician escalate", domain: "healthcare", products: ["Kafka", "MongoDB"], industry: "pharma", pattern: "safety_signal", size: "l", tags: ["pv"] },
  { id: "std-hc-consent-analytics", name: "Consent-aware analytics", description: "Purpose check before cohort aggregate", domain: "healthcare", products: ["PostgreSQL", "MongoDB", "S3"], industry: "healthcare", pattern: "consent_analytics", size: "m", tags: ["consent", "dpdp"] },
  { id: "std-hc-claims-adjudication", name: "Medical claims adjudication stub", description: "Claims ingest → rules → HITL", domain: "healthcare", products: ["PostgreSQL", "S3"], industry: "healthcare", pattern: "claims_intake", size: "m", tags: ["claims"] },
  { id: "std-hc-fhir-ingest", name: "FHIR-style ingest (synthetic)", description: "API extract → normalize → lake", domain: "healthcare", products: ["Airbyte", "S3", "Snowflake", "dbt"], industry: "healthcare", pattern: "elt_ingest_transform_load", size: "m", tags: ["fhir"] },
  { id: "std-hc-imaging-meta", name: "Imaging metadata curate", description: "File meta → de-ID → research lake", domain: "healthcare", products: ["S3", "Great Expectations"], industry: "healthcare", pattern: "phi_deid", size: "s" },
  { id: "std-hc-rpm-stream", name: "Remote patient monitoring stream", description: "Device events → aggregate → alert", domain: "healthcare", products: ["Kafka", "Redis", "MongoDB"], industry: "healthcare", pattern: "streaming_kafka", size: "m" },
  { id: "std-hc-provider-360", name: "Provider 360", description: "Credentialing + claims → profile", domain: "healthcare", products: ["Airbyte", "dbt", "Snowflake", "MongoDB"], industry: "healthcare", pattern: "customer_360", size: "m" },
  { id: "std-hc-lab-dq", name: "Lab results DQ gate", description: "Lab feed validated before EHR land", domain: "healthcare", products: ["PostgreSQL", "Great Expectations", "S3"], industry: "healthcare", pattern: "dq_ge_gate", size: "s" },
  { id: "std-hc-prior-auth-agent", name: "Prior-auth assist agent", description: "LLM extract + human approve (synthetic)", domain: "healthcare", products: ["MongoDB", "PostgreSQL"], industry: "healthcare", pattern: "clinical_hitl", size: "m", tags: ["ai"] },
  { id: "std-pharma-manufacturing-dq", name: "Pharma batch release DQ", description: "Manufacturing metrics GE + HITL release", domain: "healthcare", products: ["Great Expectations", "PostgreSQL", "S3"], industry: "pharma", pattern: "trial_validate", size: "m", tags: ["gxp"] },
  { id: "std-pharma-ctms-sync", name: "CTMS sync ELT", description: "Trial systems into warehouse", domain: "healthcare", products: ["Airbyte", "Snowflake", "dbt"], industry: "pharma", pattern: "dbt_warehouse", size: "m" },
  { id: "std-hc-hipaa-audit-pack", name: "HIPAA-oriented audit pack", description: "Access path with consent + audit logs (synthetic)", domain: "healthcare", products: ["PostgreSQL", "MongoDB", "S3"], industry: "healthcare", pattern: "consent_analytics", size: "l", tags: ["hipaa"] },

  // ── Extra coverage to push 100+ across products ─────────
  { id: "std-airbyte-mysql-snowflake", name: "Airbyte MySQL → Snowflake", description: "Classic DB replication ELT", domain: "de", products: ["Airbyte", "MySQL", "Snowflake", "dbt"], pattern: "elt_ingest_transform_load", size: "m" },
  { id: "std-airbyte-salesforce-bq", name: "Salesforce → BigQuery (Airbyte)", description: "CRM EL into BQ + dbt", domain: "etl", products: ["Airbyte", "BigQuery", "dbt"], pattern: "dbt_warehouse", size: "m", tags: ["crm"] },
  { id: "std-fivetran-snowflake", name: "Fivetran → Snowflake", description: "Managed EL into Snowflake", domain: "de", products: ["Fivetran", "Snowflake", "dbt"], pattern: "elt_ingest_transform_load", size: "s" },
  { id: "std-airflow-ge-dbt", name: "Airflow + GE + dbt", description: "Orchestrated quality-gated transforms", domain: "etl", products: ["Airflow", "Great Expectations", "dbt", "Snowflake"], pattern: "orchestrated_dag", size: "l" },
  { id: "std-prefect-dbt-bq", name: "Prefect + dbt on BigQuery", description: "Prefect flow for BQ marts", domain: "etl", products: ["Prefect", "BigQuery", "dbt"], pattern: "orchestrated_dag", size: "m" },
  { id: "std-kafka-redis-cache", name: "Kafka → Redis hot path", description: "Low-latency cache updater", domain: "de", products: ["Kafka", "Redis"], pattern: "streaming_kafka", size: "s" },
  { id: "std-elasticsearch-index", name: "Curate → Elasticsearch index", description: "Search index build from warehouse extract", domain: "de", products: ["Snowflake", "S3"], pattern: "elt_ingest_transform_load", size: "s", tags: ["elasticsearch"] },
  { id: "std-neo4j-entity-graph", name: "Entity resolution → Neo4j", description: "Graph load of resolved entities", domain: "de", products: ["PostgreSQL", "S3"], pattern: "customer_360", size: "m", tags: ["neo4j"] },
  { id: "std-cassandra-iot", name: "IoT → Cassandra pattern", description: "High write IoT curate pattern", domain: "de", products: ["Kafka", "S3"], pattern: "streaming_kafka", size: "m", tags: ["cassandra"] },
  { id: "std-temporal-long-running", name: "Temporal long-running workflow", description: "Human + system steps with durable wait", domain: "etl", products: ["PostgreSQL", "MongoDB"], pattern: "kyc_cdd", size: "m", tags: ["temporal"] },
  { id: "std-airbyte-hubspot-postgres", name: "HubSpot → Postgres", description: "Marketing EL into operational DB", domain: "etl", products: ["Airbyte", "PostgreSQL", "dbt"], pattern: "elt_ingest_transform_load", size: "s" },
  { id: "std-shop-orders-lake", name: "Commerce orders lakehouse", description: "Orders → bronze/silver/gold", domain: "de", products: ["Airbyte", "Databricks", "S3", "dbt"], pattern: "lakehouse_medallion", size: "l", tags: ["commerce"] },
  { id: "std-hr-workforce-mart", name: "HR workforce mart", description: "HRIS sync to analytics mart", domain: "etl", products: ["Airbyte", "Snowflake", "dbt"], pattern: "dbt_warehouse", size: "m", tags: ["hr"] },
  { id: "std-finops-cloud-cost", name: "FinOps cloud cost ELT", description: "Billing export → dbt cost mart", domain: "de", products: ["S3", "BigQuery", "dbt"], pattern: "dbt_warehouse", size: "m", tags: ["finops"] },
  { id: "std-security-siem-land", name: "Security log landing", description: "Log stream → lake with DQ", domain: "de", products: ["Kafka", "S3", "Great Expectations"], pattern: "streaming_kafka", size: "m", tags: ["security"] },
  { id: "std-marketing-attribution", name: "Marketing attribution mart", description: "Ad + web events into attribution models", domain: "ds", products: ["BigQuery", "dbt", "Airbyte"], pattern: "dbt_warehouse", size: "m" },
  { id: "std-churn-model", name: "Churn model train", description: "Features → train → register", domain: "mlops", products: ["Snowflake", "S3", "Great Expectations"], pattern: "model_train_register", size: "m" },
  { id: "std-recommend-features", name: "Recommendations features", description: "Behavioral features to online store", domain: "ds", products: ["Kafka", "Redis", "S3"], pattern: "feature_pipeline", size: "m" },
  { id: "std-llm-ticket-triage", name: "Ticket triage LLM", description: "Support tickets classified and routed", domain: "ai", products: ["MongoDB", "PostgreSQL"], pattern: "llm_enrich_route", size: "s" },
  { id: "std-contract-review-agent", name: "Contract review agent", description: "Doc ingest → LLM → legal HITL", domain: "ai", products: ["S3", "MongoDB"], pattern: "multi_agent_research", size: "m", tags: ["legal"] },
  { id: "std-bfsi-liquidity-mart", name: "Liquidity risk mart", description: "Treasury data dbt mart", domain: "bfsi", products: ["Snowflake", "dbt", "Airbyte"], industry: "banking", pattern: "credit_risk_mart", size: "m" },
  { id: "std-bfsi-card-disputes", name: "Card dispute workflow", description: "Dispute intake → evidence → HITL", domain: "bfsi", products: ["PostgreSQL", "MongoDB"], industry: "banking", pattern: "claims_intake", size: "m" },
  { id: "std-hc-referral-routing", name: "Care referral routing", description: "Referral event → LLM triage → HITL", domain: "healthcare", products: ["MongoDB"], industry: "healthcare", pattern: "clinical_hitl", size: "s" },
  { id: "std-hc-inventory-rx", name: "Pharmacy inventory ELT", description: "Rx inventory to warehouse", domain: "healthcare", products: ["Airbyte", "Snowflake", "dbt"], industry: "pharma", pattern: "dbt_warehouse", size: "s" },
  { id: "std-ai-rag-bq", name: "RAG with warehouse context", description: "BQ facts + vector retrieve + LLM", domain: "ai", products: ["BigQuery", "MongoDB", "S3"], pattern: "rag_ingest_retrieve", size: "l" },
  { id: "std-de-scd2-dbt", name: "SCD2 dimensions (dbt)", description: "Slowly changing dims via dbt", domain: "de", products: ["dbt", "Snowflake", "Airbyte"], pattern: "dbt_warehouse", size: "m", tags: ["scd2"] },
  { id: "std-de-late-arriving", name: "Late-arriving facts repair", description: "Reprocess window with DQ gate", domain: "de", products: ["Airflow", "Snowflake", "Great Expectations", "dbt"], pattern: "orchestrated_dag", size: "m" },
  { id: "std-mlops-shadow-mode", name: "Shadow-mode scoring", description: "Score in shadow, compare, alert", domain: "mlops", products: ["Kafka", "S3", "Redis"], pattern: "feature_pipeline", size: "m" },
  { id: "std-ai-kb-refresh", name: "Knowledge base refresh", description: "Nightly RAG re-index", domain: "ai", products: ["MongoDB", "S3", "Airbyte"], pattern: "rag_ingest_retrieve", size: "m" },
  { id: "std-etl-api-pagination", name: "API pagination extract", description: "REST paginate → transform → S3", domain: "etl", products: ["S3", "PostgreSQL"], pattern: "elt_ingest_transform_load", size: "s" },
  { id: "std-de-cost-aware-compaction", name: "Lake compaction job", description: "Spark compact small files + audit", domain: "de", products: ["Spark", "S3", "Databricks"], pattern: "lakehouse_medallion", size: "s" },
  { id: "std-bfsi-reg-report", name: "Regulatory report extract", description: "Mart → validated extract → notify", domain: "bfsi", products: ["Snowflake", "Great Expectations", "dbt"], industry: "banking", pattern: "dq_ge_gate", size: "m", tags: ["regulatory"] },
  { id: "std-hc-research-cohort", name: "Research cohort builder", description: "Consented cohort export aggregate-only", domain: "healthcare", products: ["PostgreSQL", "S3", "MongoDB"], industry: "healthcare", pattern: "consent_analytics", size: "m" },
  { id: "std-ai-eval-rag", name: "RAG eval harness", description: "Golden Q&A eval + promote gate", domain: "ai", products: ["MongoDB", "S3", "Great Expectations"], pattern: "model_train_register", size: "m", tags: ["evals", "rag"] },
  { id: "std-de-mongo-notebook-s3", name: "Mongo → Notebook → S3 (standard)", description: "Classic DE cleanup publish pattern", domain: "de", products: ["MongoDB", "S3"], pattern: "elt_ingest_transform_load", size: "s", tags: ["featured"] },
];
