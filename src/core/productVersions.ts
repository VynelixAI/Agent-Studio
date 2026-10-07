/**
 * Product line for a canvas node.
 * Choosing a version writes the settings that product uses at that line
 * (the same keys the runners already read) and shows only the options that line needs.
 */

export type ProductPersona = "data-eng" | "ai-eng" | "devops" | "system-eng";

export const PERSONA_LABEL: Record<ProductPersona, string> = {
  "data-eng": "Data Eng",
  "ai-eng": "AI Eng",
  devops: "DevOps",
  "system-eng": "System Eng",
};

export interface VersionOption {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  kind?: "text" | "password" | "select";
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
}

export interface ProductVersion {
  id: string;
  label: string;
  hint: string;
  /** Written onto node.config when this version is chosen. Only keys the runner reads. */
  config: Record<string, unknown>;
  options?: VersionOption[];
}

export interface ProductProfile {
  id: string;
  name: string;
  persona: ProductPersona;
  blurb: string;
  match: (type: string) => boolean;
  versions: ProductVersion[];
}

const sel = (
  key: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  help?: string,
): VersionOption => ({
  key,
  label,
  kind: "select",
  options,
  help,
  defaultValue: options[0]?.value,
});

const text = (key: string, label: string, placeholder?: string, help?: string): VersionOption => ({
  key,
  label,
  kind: "text",
  placeholder,
  help,
});

const secret = (key: string, label: string, placeholder?: string, help?: string): VersionOption => ({
  key,
  label,
  kind: "password",
  placeholder,
  help,
});

function profile(
  id: string,
  name: string,
  persona: ProductPersona,
  blurb: string,
  roots: string[],
  versions: ProductVersion[],
): ProductProfile {
  return {
    id,
    name,
    persona,
    blurb,
    match: (type) =>
      roots.some((p) => type === p || type.startsWith(`${p}.`) || type.startsWith(`${p}_`)),
    versions,
  };
}

export const PRODUCT_PROFILES: ProductProfile[] = [
  profile("airflow", "Apache Airflow", "devops", "The REST path and the auth this node uses follow the Airflow major version.", ["airflow"], [
    {
      id: "3",
      label: "Airflow 3.x",
      hint: "REST /api/v2. Token or JWT.",
      config: { apiVersion: "3" },
      options: [secret("token", "API token", "eyJ…", "Sent as Authorization: Bearer")],
    },
    {
      id: "2",
      label: "Airflow 2.x",
      hint: "REST /api/v1. Username and password.",
      config: { apiVersion: "2" },
      options: [text("username", "Username"), secret("password", "Password")],
    },
    {
      id: "1",
      label: "Airflow 1.10",
      hint: "Experimental API.",
      config: { apiVersion: "1" },
      options: [text("username", "Username"), secret("password", "Password")],
    },
  ]),
  profile("prefect", "Prefect", "devops", "Cloud needs an API key and a workspace URL. A self-hosted server uses /api on the UI host.", ["prefect"], [
    {
      id: "cloud",
      label: "Prefect Cloud",
      hint: "Account and workspace in the API URL.",
      config: {},
      options: [
        text("apiUrl", "API URL", "https://api.prefect.cloud/api/accounts/…/workspaces/…"),
        secret("apiKey", "API key", "pnu_…"),
        text("accountId", "Account ID"),
        text("workspaceId", "Workspace ID"),
      ],
    },
    {
      id: "3",
      label: "Prefect 3 server",
      hint: "Self-hosted. /api is added when the URL does not already end with it.",
      config: {},
      options: [text("apiUrl", "Server URL", "http://127.0.0.1:4200"), secret("apiKey", "API key", "Optional on a private server")],
    },
    {
      id: "2",
      label: "Prefect 2 server",
      hint: "Self-hosted 2.x. Variable values are stored as strings.",
      config: {},
      options: [text("apiUrl", "Server URL", "http://127.0.0.1:4200")],
    },
  ]),
  profile("dagster", "Dagster", "devops", "Cloud calls are authorized with a token. Open source talks to the webserver GraphQL endpoint.", ["dagster"], [
    {
      id: "cloud",
      label: "Dagster Cloud",
      hint: "Token plus the job to launch.",
      config: { mode: "cloud" },
      options: [secret("token", "Cloud API token"), text("jobName", "Job name"), text("graphqlUrl", "GraphQL URL", "https://….dagster.cloud/graphql")],
    },
    {
      id: "oss",
      label: "Dagster Open Source",
      hint: "GraphQL on your webserver.",
      config: {},
      options: [
        text("graphqlUrl", "GraphQL URL", "http://127.0.0.1:3000/graphql"),
        text("repositoryName", "Repository", "__repository__"),
        text("repositoryLocation", "Code location"),
        text("jobName", "Job name"),
      ],
    },
  ]),
  profile("dbt", "dbt", "data-eng", "Core and Fusion are local CLIs. Cloud runs a job by id.", ["dbt"], [
    {
      id: "1",
      label: "dbt Core 1.x",
      hint: "dbt CLI. Flags follow dbt --version.",
      config: { mode: "core", dbtPath: "dbt" },
      options: [text("projectDir", "Project directory", "./dbt_project"), text("profilesDir", "Profiles directory", "~/.dbt")],
    },
    {
      id: "fusion",
      label: "dbt Fusion",
      hint: "dbtf CLI.",
      config: { mode: "core", dbtPath: "dbtf" },
      options: [text("projectDir", "Project directory", "./dbt_project"), text("profilesDir", "Profiles directory", "~/.dbt")],
    },
    {
      id: "cloud",
      label: "dbt Cloud",
      hint: "Triggers a Cloud job.",
      config: { mode: "cloud" },
      options: [
        text("baseUrl", "Cloud host", "https://cloud.getdbt.com"),
        text("accountId", "Account ID"),
        secret("apiToken", "API token"),
        text("jobId", "Job ID"),
      ],
    },
  ]),
  profile("nifi", "Apache NiFi", "system-eng", "NiFi 2 uses parameter contexts. NiFi 1 uses the variable registry.", ["nifi"], [
    {
      id: "2",
      label: "NiFi 2.x",
      hint: "Parameter contexts.",
      config: { nifiVersion: "2" },
      options: [text("baseUrl", "NiFi API URL", "https://nifi.example.com/nifi-api"), text("processGroupId", "Process group ID", "root")],
    },
    {
      id: "1",
      label: "NiFi 1.x",
      hint: "Variable registry.",
      config: { nifiVersion: "1" },
      options: [text("baseUrl", "NiFi API URL", "https://nifi.example.com/nifi-api"), text("processGroupId", "Process group ID", "root")],
    },
  ]),
  profile("temporal", "Temporal", "devops", "Cloud connects with an API key. A self-hosted frontend can use mTLS.", ["temporal"], [
    {
      id: "cloud",
      label: "Temporal Cloud",
      hint: "API key and namespace.",
      config: {},
      options: [
        text("address", "Frontend address", "namespace.tmprl.cloud:7233"),
        text("namespace", "Namespace"),
        secret("apiKey", "API key"),
      ],
    },
    {
      id: "oss",
      label: "Temporal server",
      hint: "Self-hosted gRPC. Add cert and key for mTLS.",
      config: {},
      options: [
        text("address", "Frontend address", "localhost:7233"),
        text("namespace", "Namespace", "default"),
        text("tlsCert", "Client cert", "Optional path or PEM"),
        secret("tlsKey", "Client key"),
      ],
    },
  ]),
  profile("spark", "Apache Spark", "data-eng", "Spark Connect uses an sc:// URL. A classic master uses spark:// and the standalone REST port.", ["spark"], [
    {
      id: "connect",
      label: "Spark Connect",
      hint: "Spark 3.4+ and 4.x. Master must start with sc://.",
      config: {},
      options: [text("master", "Connect URL", "sc://host:15002"), secret("token", "Auth token", "Optional")],
    },
    {
      id: "standalone",
      label: "Spark standalone",
      hint: "spark:// master. Job status uses the REST URL.",
      config: {},
      options: [
        text("master", "Master URL", "spark://host:7077"),
        text("restUrl", "REST URL", "http://host:6066"),
        sel("deployMode", "Deploy mode", [
          { value: "client", label: "Client" },
          { value: "cluster", label: "Cluster" },
        ]),
      ],
    },
  ]),
  profile("flink", "Apache Flink", "data-eng", "Jobs go to the JobManager REST API. Newer clusters accept an adaptive rescale; older ones use the classic call.", ["flink"], [
    {
      id: "1.18",
      label: "Flink 1.18+",
      hint: "Adaptive scheduler when the cluster supports it.",
      config: {},
      options: [text("restUrl", "JobManager URL", "http://host:8081"), text("parallelism", "Parallelism", "4"), text("jobJar", "Job JAR")],
    },
    {
      id: "1.13",
      label: "Flink 1.13–1.17",
      hint: "Classic job rescale.",
      config: {},
      options: [text("restUrl", "JobManager URL", "http://host:8081"), text("parallelism", "Parallelism", "4"), text("jobJar", "Job JAR")],
    },
  ]),
  profile("kafka", "Apache Kafka", "system-eng", "Security is part of the client config. Kafka 3 clusters usually want SASL_SSL or SSL. Older brokers often stay on PLAINTEXT.", ["kafka"], [
    {
      id: "3",
      label: "Kafka 3.x",
      hint: "Current client protocol.",
      config: { securityProtocol: "SASL_SSL" },
      options: [
        text("bootstrapServers", "Bootstrap servers", "broker:9092"),
        sel("securityProtocol", "Security protocol", [
          { value: "SASL_SSL", label: "SASL_SSL" },
          { value: "SSL", label: "SSL" },
          { value: "PLAINTEXT", label: "PLAINTEXT" },
        ]),
        sel("saslMechanism", "SASL mechanism", [
          { value: "PLAIN", label: "PLAIN" },
          { value: "SCRAM-SHA-256", label: "SCRAM-SHA-256" },
          { value: "SCRAM-SHA-512", label: "SCRAM-SHA-512" },
        ]),
      ],
    },
    {
      id: "2",
      label: "Kafka 2.x",
      hint: "Same client, older broker.",
      config: { securityProtocol: "PLAINTEXT" },
      options: [
        text("bootstrapServers", "Bootstrap servers", "broker:9092"),
        sel("securityProtocol", "Security protocol", [
          { value: "PLAINTEXT", label: "PLAINTEXT" },
          { value: "SASL_PLAINTEXT", label: "SASL_PLAINTEXT" },
          { value: "SASL_SSL", label: "SASL_SSL" },
        ]),
      ],
    },
  ]),
  profile("postgresql", "PostgreSQL", "data-eng", "The driver talks to Postgres 14 through current servers with the same node. Name the server line so the connection options match what you run.", ["postgresql", "postgres"], [
    {
      id: "16",
      label: "Postgres 16+",
      hint: "Current server.",
      config: {},
      options: [text("host", "Host", "db.example.com"), text("port", "Port", "5432"), text("database", "Database"), text("username", "Username")],
    },
    {
      id: "14",
      label: "Postgres 14 / 15",
      hint: "Still common for warehouses and app databases.",
      config: {},
      options: [text("host", "Host"), text("port", "Port", "5432"), text("database", "Database"), text("username", "Username")],
    },
  ]),
  profile("mysql", "MySQL", "data-eng", "CDC finds the binlog by itself: MySQL 8.4 uses SHOW BINARY LOG STATUS, older servers use SHOW MASTER STATUS.", ["mysql"], [
    {
      id: "8.4",
      label: "MySQL 8.4+",
      hint: "Binary log status statement.",
      config: {},
      options: [text("host", "Host", "localhost"), text("port", "Port", "3306"), text("database", "Database"), text("logFile", "Binlog file", "Optional override")],
    },
    {
      id: "8.0",
      label: "MySQL 5.7 / 8.0",
      hint: "SHOW MASTER STATUS.",
      config: {},
      options: [text("host", "Host"), text("port", "Port", "3306"), text("database", "Database"), text("logFile", "Binlog file", "Optional override")],
    },
  ]),
  profile("mongodb", "MongoDB", "data-eng", "A single host connects directly. A replica set needs the set name, or discovery will fail on newer drivers.", ["mongodb"], [
    {
      id: "single",
      label: "Single host",
      hint: "Local, or one host. directConnection is set for you.",
      config: {},
      options: [text("host", "Host", "127.0.0.1"), text("port", "Port", "27017"), text("database", "Database"), text("authSource", "Auth database", "admin")],
    },
    {
      id: "replica",
      label: "Replica set",
      hint: "Host list plus the replica set name.",
      config: {},
      options: [
        text("host", "Hosts", "host1:27017,host2:27017"),
        text("replicaSet", "Replica set name", "rs0"),
        text("database", "Database"),
        text("authSource", "Auth database", "admin"),
      ],
    },
  ]),
  profile("snowflake", "Snowflake", "data-eng", "Account, warehouse, database, schema, and role are the settings a warehouse query needs.", ["snowflake"], [
    {
      id: "current",
      label: "Current account",
      hint: "Username and password on the connector, plus these session settings.",
      config: {},
      options: [
        text("account", "Account", "org-account"),
        text("warehouse", "Warehouse"),
        text("database", "Database"),
        text("schema", "Schema", "PUBLIC"),
        text("role", "Role", "ACCOUNTADMIN"),
      ],
    },
  ]),
  profile("bigquery", "BigQuery", "data-eng", "The job runs in a GCP project. A service-account JSON usually carries the project; you can set it here too.", ["bigquery"], [
    {
      id: "sa",
      label: "Service account",
      hint: "JSON key on the connector.",
      config: {},
      options: [text("projectId", "Project", "Optional if the key has project_id"), text("dataset", "Dataset")],
    },
  ]),
  profile("elasticsearch", "Elasticsearch", "data-eng", "Elasticsearch 8 and OpenSearch take an API key. Elasticsearch 7 still uses basic auth.", ["elasticsearch", "opensearch"], [
    {
      id: "8",
      label: "Elasticsearch 8 / OpenSearch",
      hint: "API key.",
      config: {},
      options: [text("url", "Cluster URL", "https://localhost:9200"), secret("apiKey", "API key", "id:secret")],
    },
    {
      id: "7",
      label: "Elasticsearch 7",
      hint: "Username and password.",
      config: {},
      options: [text("url", "Cluster URL", "https://localhost:9200"), text("username", "Username", "elastic"), secret("password", "Password")],
    },
  ]),
  profile("redis", "Redis", "system-eng", "Redis 6 and later can use an ACL username. Redis 5 uses a password only.", ["redis"], [
    {
      id: "6",
      label: "Redis 6+",
      hint: "ACL user.",
      config: {},
      options: [text("host", "Host", "localhost"), text("port", "Port", "6379"), text("username", "ACL username", "default")],
    },
    {
      id: "5",
      label: "Redis 5",
      hint: "Password only. No ACL username.",
      config: {},
      options: [text("host", "Host", "localhost"), text("port", "Port", "6379")],
    },
  ]),
  profile("s3", "Amazon S3", "data-eng", "AWS uses the regional endpoint. MinIO and other S3-compatible stores need your own endpoint.", ["s3"], [
    {
      id: "aws",
      label: "Amazon S3",
      hint: "Region and bucket. Credentials stay on the connector.",
      config: {},
      options: [text("bucket", "Bucket"), text("region", "Region", "us-east-1")],
    },
    {
      id: "minio",
      label: "MinIO / compatible",
      hint: "Custom endpoint. Checksums are relaxed for MinIO, Ceph, and R2.",
      config: {},
      options: [text("endpoint", "Endpoint", "http://minio:9000"), text("bucket", "Bucket"), text("region", "Region", "us-east-1")],
    },
  ]),
  profile("gcs", "Google Cloud Storage", "data-eng", "Objects live in a bucket in a GCP project.", ["gcs"], [
    {
      id: "gcs",
      label: "GCS",
      hint: "Service account on the connector.",
      config: {},
      options: [text("projectId", "Project"), text("bucket", "Bucket")],
    },
  ]),
  profile("azure_blob", "Azure Blob", "data-eng", "The account URL and container identify the store.", ["azure_blob"], [
    {
      id: "blob",
      label: "Azure Blob",
      hint: "Connection string or account on the connector.",
      config: {},
      options: [text("accountUrl", "Account URL", "https://account.blob.core.windows.net"), text("container", "Container")],
    },
  ]),
  profile("airbyte", "Airbyte", "data-eng", "Cloud and current OSS use the public API. Older OSS servers use the config API.", ["airbyte"], [
    {
      id: "public",
      label: "Public API",
      hint: "Cloud or /api/public/v1.",
      config: {},
      options: [
        text("apiUrl", "API URL", "https://api.airbyte.com/v1"),
        text("clientId", "Client ID"),
        secret("clientSecret", "Client secret"),
        text("workspaceId", "Workspace ID"),
      ],
    },
    {
      id: "config",
      label: "Config API",
      hint: "Older OSS /api/v1.",
      config: {},
      options: [text("apiUrl", "API URL", "http://localhost:8000/api/v1"), text("workspaceId", "Workspace ID"), secret("clientSecret", "API key")],
    },
  ]),
  profile("great_expectations", "Great Expectations", "data-eng", "Point this node at the GX project. The runner accepts the current result object and the 0.18 shape.", ["great_expectations"], [
    {
      id: "1",
      label: "GX 1.x",
      hint: "Current result API.",
      config: {},
      options: [text("contextRoot", "GX project root", "./gx")],
    },
    {
      id: "0.18",
      label: "GX 0.18",
      hint: "Older result object.",
      config: {},
      options: [text("contextRoot", "GX project root", "./great_expectations")],
    },
  ]),
  profile("clickhouse", "ClickHouse", "data-eng", "Cloud is HTTPS. A self-hosted server is usually HTTP on port 8123.", ["clickhouse"], [
    {
      id: "cloud",
      label: "ClickHouse Cloud",
      hint: "HTTPS host.",
      config: {},
      options: [text("host", "Host", "xxx.clickhouse.cloud"), text("port", "Port", "8443"), text("database", "Database")],
    },
    {
      id: "oss",
      label: "Self-hosted",
      hint: "HTTP interface.",
      config: {},
      options: [text("host", "Host", "127.0.0.1"), text("port", "HTTP port", "8123"), text("database", "Database")],
    },
  ]),
  profile("trino", "Trino", "data-eng", "Queries go to the coordinator, then a catalog and schema.", ["trino", "presto"], [
    {
      id: "trino",
      label: "Trino coordinator",
      hint: "Federated SQL.",
      config: {},
      options: [text("host", "Coordinator", "localhost"), text("catalog", "Catalog", "hive"), text("schema", "Schema", "default")],
    },
  ]),
  profile("databricks", "Databricks", "data-eng", "SQL uses a warehouse HTTP path. Notebooks and volumes use the workspace host and a token.", ["databricks"], [
    {
      id: "sql",
      label: "SQL warehouse",
      hint: "Host, HTTP path, and token.",
      config: {},
      options: [
        text("host", "Workspace host", "adb-xxxx.azuredatabricks.net"),
        text("httpPath", "HTTP path", "/sql/1.0/warehouses/…"),
        text("catalog", "Catalog", "main"),
        text("schema", "Schema", "default"),
        secret("token", "Access token"),
      ],
    },
    {
      id: "workspace",
      label: "Workspace jobs",
      hint: "Notebooks and volumes.",
      config: {},
      options: [text("host", "Workspace host"), secret("token", "Access token"), text("catalog", "Catalog", "main")],
    },
  ]),
  profile("redshift", "Amazon Redshift", "data-eng", "Queries use the cluster endpoint. COPY and UNLOAD need an IAM role.", ["redshift"], [
    {
      id: "query",
      label: "Query",
      hint: "Cluster endpoint.",
      config: {},
      options: [text("host", "Cluster endpoint"), text("database", "Database"), text("port", "Port", "5439")],
    },
    {
      id: "copy",
      label: "COPY / UNLOAD",
      hint: "Adds the IAM role the statement uses.",
      config: {},
      options: [text("host", "Cluster endpoint"), text("database", "Database"), text("iamRole", "IAM role ARN", "arn:aws:iam::…")],
    },
  ]),
  profile("neo4j", "Neo4j", "data-eng", "Aura uses a neo4j+s URI. A local server uses bolt://.", ["neo4j"], [
    {
      id: "aura",
      label: "Neo4j Aura",
      hint: "Encrypted bolt URI.",
      config: {},
      options: [text("uri", "Bolt URI", "neo4j+s://xxxx.databases.neo4j.io"), text("database", "Database", "neo4j")],
    },
    {
      id: "local",
      label: "Self-hosted",
      hint: "bolt:// on port 7687.",
      config: {},
      options: [text("uri", "Bolt URI", "bolt://localhost:7687"), text("database", "Database", "neo4j")],
    },
  ]),
  profile("cassandra", "Cassandra", "data-eng", "Contact points and the keyspace identify the cluster.", ["cassandra"], [
    {
      id: "current",
      label: "Cassandra / Astra",
      hint: "Comma-separated contact points.",
      config: {},
      options: [text("host", "Contact points", "127.0.0.1"), text("keyspace", "Keyspace"), text("port", "Port", "9042")],
    },
  ]),
  profile("duckdb", "DuckDB", "data-eng", "A file path is local DuckDB. A MotherDuck URL starts with md:.", ["duckdb"], [
    {
      id: "local",
      label: "Local file",
      hint: "A .duckdb file on disk.",
      config: {},
      options: [text("path", "Database path", "./analytics.duckdb")],
    },
    {
      id: "motherduck",
      label: "MotherDuck",
      hint: "md: database name.",
      config: {},
      options: [text("path", "MotherDuck database", "md:my_db"), secret("token", "MotherDuck token")],
    },
  ]),
  profile("llm", "LLM", "ai-eng", "Pick where the model runs. Provider, model, and endpoint are filled for that choice.", ["llm"], [
    { id: "openai", label: "OpenAI", hint: "Licensed cloud.", config: { provider: "openai", model: "gpt-4o-mini" } },
    { id: "anthropic", label: "Claude", hint: "Licensed cloud.", config: { provider: "anthropic", model: "claude-sonnet-4-5" } },
    { id: "gemini", label: "Gemini", hint: "Licensed cloud.", config: { provider: "google_genai", model: "gemini-2.0-flash" } },
    { id: "grok", label: "Grok", hint: "Licensed cloud.", config: { provider: "xai", model: "grok-3" } },
    {
      id: "ollama",
      label: "Ollama",
      hint: "Open source, on this machine.",
      config: { provider: "ollama", model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1" },
    },
  ]),
  profile("agent", "Agent", "ai-eng", "The vendor decides the package, the secret, and whether the agent runs locally or over HTTP.", ["agent"], [
    { id: "langgraph", label: "LangGraph", hint: "Local graph agent.", config: { agentVendor: "langgraph" } },
    { id: "crewai", label: "CrewAI", hint: "Role-based crew.", config: { agentVendor: "crewai" } },
    { id: "openai", label: "OpenAI tools", hint: "Cloud tools agent.", config: { agentVendor: "openai_assistants" } },
    { id: "local", label: "Local code", hint: "Your own Python entrypoint.", config: { agentVendor: "local_code" } },
  ]),
  profile("rag", "Retrieval", "ai-eng", "The grounding model follows the provider you pick. Collection and top-k stay in the sections below.", ["rag"], [
    { id: "openai", label: "OpenAI", hint: "Grounded answer with gpt-4o-mini.", config: { provider: "openai", model: "gpt-4o-mini" } },
    {
      id: "local",
      label: "Local",
      hint: "Ollama on this machine.",
      config: { provider: "ollama", model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1" },
    },
  ]),
  profile("embedding", "Embeddings", "ai-eng", "The embedding model follows the provider you pick.", ["embedding"], [
    { id: "openai", label: "OpenAI", hint: "text-embedding-3-small.", config: { provider: "openai", model: "text-embedding-3-small" } },
    {
      id: "local",
      label: "Local",
      hint: "Ollama embeddings on this machine.",
      config: { provider: "ollama", model: "nomic-embed-text", baseUrl: "http://127.0.0.1:11434/v1" },
    },
  ]),
];

export function productForNodeType(type: string): ProductProfile | undefined {
  return PRODUCT_PROFILES.find((p) => p.match(type));
}

export function versionById(profile: ProductProfile, id: string | undefined): ProductVersion | undefined {
  if (!id) return undefined;
  return profile.versions.find((v) => v.id === id);
}

function ownedKeys(version: ProductVersion): Set<string> {
  const keys = new Set(Object.keys(version.config));
  for (const opt of version.options ?? []) keys.add(opt.key);
  return keys;
}

export function applyProductVersion(
  current: Record<string, unknown> | undefined,
  product: ProductProfile,
  versionId: string,
): Record<string, unknown> {
  const version = versionById(product, versionId);
  if (!version) return { ...(current ?? {}) };
  const next: Record<string, unknown> = { ...(current ?? {}) };
  const keep = ownedKeys(version);
  for (const other of product.versions) {
    if (other.id === version.id) continue;
    for (const key of ownedKeys(other)) {
      if (!keep.has(key)) delete next[key];
    }
  }
  Object.assign(next, version.config);
  for (const opt of version.options ?? []) {
    if (next[opt.key] === undefined && opt.defaultValue !== undefined) {
      next[opt.key] = opt.defaultValue;
    }
  }
  next.productVersion = version.id;
  next.productId = product.id;
  return next;
}
