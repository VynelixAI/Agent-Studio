/**
 * Per-node inspector schemas for Agent Studio.
 * Each node collects Input → Processing → Output fields appropriate to its type
 * (not a generic JSON blob for every component).
 */

export type NodeFieldKind =
  | "text"
  | "number"
  | "select"
  | "checkbox"
  | "textarea"
  | "code"
  | "template"
  | "json"
  | "stage"
  | "format"
  | "cron"
  | "secretRef";

export type NodeFieldSection = "input" | "processing" | "output";

export type CodeLanguage =
  | "python"
  | "javascript"
  | "sql"
  | "json"
  | "yaml"
  | "cypher"
  | "jinja"
  | "text"
  | "html";

export interface NodeFieldDef {
  /** Config key, or "__inputs" / "__outputs" for stage wiring */
  key: string;
  label: string;
  kind: NodeFieldKind;
  section: NodeFieldSection;
  help?: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Dynamic option source (resolved in inspector) */
  optionsFrom?:
    | "llmProviders"
    | "llmModels"
    | "agentVendors"
    | "agentTypes"
    | "savedNotebooks";
  /** Show field only when another config key matches */
  visibleWhen?: { key: string; equals: string | string[] };
  language?: CodeLanguage;
  rows?: number;
  defaultValue?: unknown;
}

export interface NodeSchema {
  type: string;
  summary: string;
  acceptsStageInputs?: boolean;
  producesStageOutputs?: boolean;
  requiresConnector?: boolean;
  /** Limit connector dropdown to these types (prefix match ok) */
  connectorTypes?: string[];
  fields: NodeFieldDef[];
  defaultConfig?: Record<string, unknown>;
  defaultOutputs?: string[];
}

const FORMAT_OPTIONS = [
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "text", label: "Text" },
  { value: "raw", label: "Raw / binary" },
];

const stageIn = (
  key = "__inputs",
  label = "Upstream stages",
  help = "Multi-select canvas node labels; stored as stage keys in YAML",
): NodeFieldDef => ({
  key,
  label,
  kind: "stage",
  section: "input",
  help,
  placeholder: "Select upstream nodes…",
});

const stageOut = (
  key = "__outputs",
  label = "Output stage key",
  help = "Stage cache key(s) written for downstream nodes",
): NodeFieldDef => ({
  key,
  label,
  kind: "stage",
  section: "output",
  help,
  placeholder: "stage.result",
});

const outFormat = (defaultValue = "json"): NodeFieldDef => ({
  key: "outputFormat",
  label: "Output format",
  kind: "format",
  section: "output",
  options: FORMAT_OPTIONS,
  defaultValue,
  help: "How results are serialized into the stage / run artifact",
});

function schema(
  type: string,
  summary: string,
  partial: Omit<NodeSchema, "type" | "summary">,
): NodeSchema {
  return { type, summary, ...partial };
}

export const NODE_SCHEMAS: Record<string, NodeSchema> = {
  // ── Triggers ─────────────────────────────────────────────
  "trigger.manual": schema("trigger.manual", "Start on demand from Studio or API", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.trigger"],
    defaultConfig: { payloadFormat: "json" },
    fields: [
      {
        key: "payloadExample",
        label: "Optional start payload (JSON)",
        kind: "json",
        section: "input",
        rows: 5,
        placeholder: '{\n  "number": 10,\n  "question": "What is React?"\n}',
        help: "JSON object passed as the first trigger row. Field names (e.g. number, question) are available to downstream IF conditions.",
      },
      {
        key: "payloadFormat",
        label: "Payload format",
        kind: "format",
        section: "processing",
        options: FORMAT_OPTIONS,
        defaultValue: "json",
      },
      stageOut("__outputs", "Emit as stage", "Manual payload lands in this stage"),
      outFormat("json"),
    ],
  }),

  "trigger.schedule": schema("trigger.schedule", "Cron / interval schedule", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.trigger"],
    defaultConfig: { cron: "0 * * * *", timezone: "UTC" },
    fields: [
      {
        key: "cron",
        label: "Cron expression",
        kind: "cron",
        section: "input",
        required: true,
        placeholder: "0 */6 * * *",
        help: "Standard 5-field cron",
      },
      {
        key: "timezone",
        label: "Timezone",
        kind: "text",
        section: "input",
        placeholder: "UTC",
      },
      {
        key: "catchUp",
        label: "Catch up missed runs",
        kind: "checkbox",
        section: "processing",
        defaultValue: false,
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "trigger.webhook": schema("trigger.webhook", "HTTP inbound entry", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.webhook"],
    defaultConfig: { method: "POST", path: "/hooks/run", bodyFormat: "json" },
    fields: [
      {
        key: "path",
        label: "Path",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "/hooks/ingest",
      },
      {
        key: "method",
        label: "HTTP method",
        kind: "select",
        section: "input",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "GET", label: "GET" },
        ],
      },
      {
        key: "authHeader",
        label: "Expected auth header name",
        kind: "text",
        section: "processing",
        placeholder: "X-Webhook-Secret",
      },
      {
        key: "secretRef",
        label: "Verify secret",
        kind: "secretRef",
        section: "processing",
        placeholder: "secret://webhook_verify",
      },
      {
        key: "bodyFormat",
        label: "Request body format",
        kind: "format",
        section: "processing",
        options: FORMAT_OPTIONS,
        defaultValue: "json",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "trigger.chat": schema("trigger.chat", "Chat start — user message from the Studio chat panel or /chat API", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.chat"],
    defaultConfig: { systemHint: "You are a helpful assistant.", parseIntent: false },
    fields: [
      {
        key: "systemHint",
        label: "System hint for this conversation",
        kind: "textarea",
        section: "input",
        rows: 3,
        placeholder: "You are a helpful assistant for this workflow…",
        help: "Copied onto the trigger row as systemHint and used when the LLM has no systemPrompt.",
      },
      {
        key: "parseIntent",
        label: "Parse intent to structured JSON",
        kind: "checkbox",
        section: "processing",
        defaultValue: false,
        help: "When on, the trigger row includes intentHint for downstream IF / LLM routers.",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "trigger.error": schema("trigger.error", "Re-enter on failure path", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.error"],
    fields: [
      stageIn("__inputs", "Error context stages"),
      {
        key: "matchNode",
        label: "Match failed node id / pattern",
        kind: "text",
        section: "processing",
        placeholder: "mongodb_*|code_*",
      },
      {
        key: "maxRentries",
        label: "Max re-entries",
        kind: "number",
        section: "processing",
        defaultValue: 3,
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  // ── AI ───────────────────────────────────────────────────
  llm: schema("llm", "Prompt → model completion (LangChain providers)", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.llm"],
    defaultConfig: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 1,
      maxTokens: 2048,
      memoryType: "window",
      memoryWindow: 10,
      responseFormat: "text",
      outputFormat: "text",
      secretRef: "secret://openai",
      enableDynamicCode: true,
      codeLanguage: "python",
      codeMode: "from_intent",
    },
    fields: [
      stageIn(),
      {
        key: "provider",
        label: "Provider (LangChain)",
        kind: "select",
        section: "input",
        required: true,
        optionsFrom: "llmProviders",
        defaultValue: "openai",
        help: "Popular providers from LangChain docs — package + auth fields adapt to selection",
      },
      {
        key: "model",
        label: "Model",
        kind: "select",
        section: "input",
        required: true,
        optionsFrom: "llmModels",
        help: "Latest curated models for the selected provider",
      },
      {
        key: "customModel",
        label: "Custom model id (override)",
        kind: "text",
        section: "input",
        placeholder: "Leave empty to use dropdown model",
        help: "Use any new model id immediately (LangChain: pass model name as string)",
      },
      {
        key: "secretRef",
        label: "API key secret",
        kind: "secretRef",
        section: "input",
        placeholder: "secret://openai",
        help: "Encrypted secretRef — never plaintext in YAML",
      },
      {
        key: "langchainPackage",
        label: "LangChain package",
        kind: "text",
        section: "input",
        placeholder: "langchain-openai",
        help: "Filled from provider; used by remote runners / requirements",
      },
      // Provider-specific connection fields (toggled in inspector)
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        section: "input",
        placeholder: "https://api.openai.com/v1",
        visibleWhen: {
          key: "provider",
          equals: [
            "openai",
            "deepseek",
            "nvidia",
            "openrouter",
            "ollama",
            "sambanova",
            "litellm",
          ],
        },
      },
      {
        key: "organization",
        label: "Organization id",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "openai" },
      },
      {
        key: "project",
        label: "GCP project",
        kind: "text",
        section: "input",
        required: true,
        visibleWhen: { key: "provider", equals: "google_vertex" },
      },
      {
        key: "location",
        label: "Vertex location",
        kind: "text",
        section: "input",
        placeholder: "us-central1",
        visibleWhen: { key: "provider", equals: "google_vertex" },
      },
      {
        key: "azureEndpoint",
        label: "Azure endpoint",
        kind: "text",
        section: "input",
        required: true,
        visibleWhen: { key: "provider", equals: "azure_openai" },
      },
      {
        key: "azureDeployment",
        label: "Azure deployment name",
        kind: "text",
        section: "input",
        required: true,
        visibleWhen: { key: "provider", equals: "azure_openai" },
      },
      {
        key: "apiVersion",
        label: "Azure API version",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "azure_openai" },
      },
      {
        key: "region",
        label: "AWS region",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "aws_bedrock" },
      },
      {
        key: "awsSecretRef",
        label: "AWS credentials secret",
        kind: "secretRef",
        section: "input",
        visibleWhen: { key: "provider", equals: "aws_bedrock" },
      },
      {
        key: "host",
        label: "Databricks host",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "databricks" },
      },
      {
        key: "endpointName",
        label: "Serving endpoint",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "databricks" },
      },
      {
        key: "url",
        label: "watsonx URL",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "ibm_watsonx" },
      },
      {
        key: "projectId",
        label: "watsonx project id",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "ibm_watsonx" },
      },
      {
        key: "endpointUrl",
        label: "HF inference endpoint",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "huggingface" },
      },
      {
        key: "httpReferer",
        label: "OpenRouter HTTP-Referer",
        kind: "text",
        section: "input",
        visibleWhen: { key: "provider", equals: "openrouter" },
      },
      {
        key: "maxTokens",
        label: "Max tokens",
        kind: "number",
        section: "processing",
        defaultValue: 2048,
        help: "Sent as max_tokens (or max_completion_tokens for GPT-5). OpenRouter defaults to 2048 so the request does not claim the model ceiling (65536).",
      },
      {
        key: "systemPrompt",
        label: "System prompt",
        kind: "template",
        section: "processing",
        rows: 4,
        language: "text",
        placeholder: "You are a data engineer assistant…",
      },
      {
        key: "userPrompt",
        label: "User prompt template",
        kind: "template",
        section: "processing",
        rows: 6,
        language: "jinja",
        required: true,
        placeholder:
          "{{query}}",
        help: "Jinja-style refs. Use {{query}} / {{question}} for the current chat message. Upstream stages are appended automatically.",
      },
      {
        key: "memoryType",
        label: "Conversation memory",
        kind: "select",
        section: "processing",
        defaultValue: "window",
        options: [
          { value: "none", label: "None (single turn)" },
          { value: "window", label: "Buffer window (last N turns)" },
          { value: "buffer", label: "Full buffer" },
          { value: "summary", label: "Window (summary-style trim)" },
        ],
        help: "Like Flowise memory: prior chat turns in this session are prepended to the model messages.",
      },
      {
        key: "memoryWindow",
        label: "Memory window (turns)",
        kind: "number",
        section: "processing",
        defaultValue: 10,
        visibleWhen: { key: "memoryType", equals: ["window", "summary"] },
        help: "Number of user/assistant turns to keep.",
      },
      {
        key: "temperature",
        label: "Temperature",
        kind: "number",
        section: "processing",
        defaultValue: 1,
        help: "Omitted for GPT-5 / o-series (those models only accept the default temperature of 1).",
      },
      {
        key: "topP",
        label: "Top P",
        kind: "number",
        section: "processing",
        placeholder: "1",
        help: "Nucleus sampling. Sent as top_p on OpenAI-compatible providers.",
      },
      {
        key: "stopSequences",
        label: "Stop sequences",
        kind: "text",
        section: "processing",
        placeholder: "END, ###",
        help: "Comma-separated stop strings forwarded to the provider.",
      },
      {
        key: "responseFormat",
        label: "Model response shape",
        kind: "select",
        section: "processing",
        options: [
          { value: "text", label: "Free text" },
          { value: "json", label: "JSON object" },
        ],
        help: "JSON object sends response_format={type:json_object} (Flowise ChatOpenAI json mode).",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        kind: "number",
        section: "processing",
        defaultValue: 120,
      },
      {
        key: "enableDynamicCode",
        label: "Enable dynamic code (Python / JavaScript)",
        kind: "checkbox",
        section: "processing",
        defaultValue: true,
        help: "Run custom pre/post logic around the model call — or generate it from a text description",
      },
      {
        key: "codeLanguage",
        label: "Code language",
        kind: "select",
        section: "processing",
        options: [
          { value: "python", label: "Python" },
          { value: "javascript", label: "JavaScript" },
        ],
        defaultValue: "python",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      {
        key: "codeMode",
        label: "Code source",
        kind: "select",
        section: "processing",
        options: [
          { value: "manual", label: "Write code myself" },
          { value: "from_intent", label: "Generate from text description" },
        ],
        defaultValue: "from_intent",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      {
        key: "intentText",
        label: "Describe what the code should do",
        kind: "textarea",
        section: "processing",
        rows: 4,
        placeholder:
          "e.g. Summarize Mongo stage rows as JSON with keys summary, risks, next_actions",
        help: "When you type here, use Generate code — or leave empty and paste code below",
        visibleWhen: { key: "codeMode", equals: "from_intent" },
      },
      {
        key: "dynamicCode",
        label: "Dynamic code",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 14,
        placeholder: "# run(stages, ctx) → result",
        help: "Executed by the runner. ctx['llm_complete'](messages) is injected for generated code. Switch language above; Generate fills a stub from your description.",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      stageOut(),
      outFormat("text"),
    ],
  }),

  "chat.reply": schema("chat.reply", "Direct reply — assistant message returned to the Chat panel", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.reply"],
    defaultConfig: { outputFormat: "json" },
    fields: [
      stageIn("__inputs", "LLM / Agent / RAG stage to speak"),
      {
        key: "replyField",
        label: "Reply field",
        kind: "text",
        section: "processing",
        defaultValue: "summary",
        placeholder: "summary",
        help: "Field on the upstream row/result to send as the assistant message (summary, reply, content, text).",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  agent: schema("agent", "Vendor agent frameworks + remote products → YAML output", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.agent"],
    defaultConfig: {
      agentVendor: "langgraph",
      agentType: "react",
      provider: "openai",
      model: "gpt-4o-mini",
      maxSteps: 8,
      memoryType: "window",
      memoryWindow: 10,
      returnIntermediateSteps: true,
      tools: "calculator, lookup_stage, rag_search, current_time",
      outputFormat: "yaml",
      writeYamlOutput: true,
      yamlOutputPath: "outputs/agent_result.yaml",
      executionMode: "local",
      enableDynamicCode: true,
      codeLanguage: "python",
      codeMode: "from_intent",
    },
    fields: [
      stageIn(),
      {
        key: "agentVendor",
        label: "Agent vendor / framework",
        kind: "select",
        section: "input",
        required: true,
        optionsFrom: "agentVendors",
        defaultValue: "langgraph",
        help: "LangGraph, CrewAI, AutoGen, OpenAI Assistants, Azure, Databricks, Bedrock, custom remote…",
      },
      {
        key: "agentType",
        label: "Agent type",
        kind: "select",
        section: "input",
        required: true,
        optionsFrom: "agentTypes",
        help: "Types available for the selected vendor",
      },
      {
        key: "agentPackage",
        label: "Package",
        kind: "text",
        section: "input",
        placeholder: "langgraph",
        help: "Filled from vendor — used in remote requirements",
      },
      {
        key: "executionMode",
        label: "Where to run",
        kind: "select",
        section: "input",
        options: [
          { value: "local", label: "Local (Studio run folder)" },
          { value: "remote", label: "Remote product / API" },
          { value: "hybrid", label: "Local code → remote tools" },
        ],
        defaultValue: "local",
      },
      {
        key: "remoteUrl",
        label: "Remote agent URL",
        kind: "text",
        section: "input",
        placeholder: "https://… or http://remote-host:port",
        visibleWhen: {
          key: "executionMode",
          equals: ["remote", "hybrid"],
        },
        help: "Connect to agent product running on a remote system",
      },
      {
        key: "assistantId",
        label: "Assistant / agent / graph id",
        kind: "text",
        section: "input",
        placeholder: "asst_… / agent / graph id",
        visibleWhen: {
          key: "agentVendor",
          equals: [
            "langgraph",
            "openai_assistants",
            "azure_ai_agents",
            "crewai",
            "aws_bedrock_agents",
          ],
        },
      },
      {
        key: "threadId",
        label: "Thread / session id",
        kind: "text",
        section: "input",
        visibleWhen: {
          key: "agentVendor",
          equals: ["langgraph", "openai_assistants"],
        },
      },
      {
        key: "crewId",
        label: "Crew / deployment id",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "crewai" },
      },
      {
        key: "projectEndpoint",
        label: "Azure project endpoint",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "azure_ai_agents" },
      },
      {
        key: "agentName",
        label: "Azure agent name",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "azure_ai_agents" },
      },
      {
        key: "host",
        label: "Databricks host",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "databricks_agents" },
      },
      {
        key: "endpointName",
        label: "Serving endpoint",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "databricks_agents" },
      },
      {
        key: "region",
        label: "AWS region",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "aws_bedrock_agents" },
      },
      {
        key: "agentAliasId",
        label: "Bedrock agent alias id",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "aws_bedrock_agents" },
      },
      {
        key: "project",
        label: "GCP project",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "google_adk" },
      },
      {
        key: "location",
        label: "GCP location",
        kind: "text",
        section: "input",
        visibleWhen: { key: "agentVendor", equals: "google_adk" },
      },
      {
        key: "httpMethod",
        label: "HTTP method",
        kind: "select",
        section: "input",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
        ],
        visibleWhen: { key: "agentVendor", equals: "custom_remote" },
      },
      {
        key: "provider",
        label: "Underlying LLM provider",
        kind: "select",
        section: "input",
        optionsFrom: "llmProviders",
        defaultValue: "openai",
        help: "Model backend used by the agent framework",
      },
      {
        key: "model",
        label: "Model",
        kind: "select",
        section: "input",
        optionsFrom: "llmModels",
      },
      {
        key: "customModel",
        label: "Custom model id (override)",
        kind: "text",
        section: "input",
      },
      {
        key: "secretRef",
        label: "API / agent secret",
        kind: "secretRef",
        section: "input",
        placeholder: "secret://agent_vendor",
      },
      {
        key: "systemPrompt",
        label: "System / role prompt",
        kind: "template",
        section: "processing",
        rows: 4,
      },
      {
        key: "tools",
        label: "Allowed tools (comma ids)",
        kind: "text",
        section: "processing",
        placeholder: "calculator, lookup_stage, rag_search, current_time, rest_get, mongo_query",
        help: "Built-ins run in the local ReAct loop: calculator, lookup_stage, rag_search, current_time, rest_get, mongo_query, sql_query. Use none to skip tools.",
      },
      {
        key: "maxSteps",
        label: "Max reasoning steps",
        kind: "number",
        section: "processing",
        defaultValue: 8,
      },
      {
        key: "memoryType",
        label: "Conversation memory",
        kind: "select",
        section: "processing",
        defaultValue: "window",
        options: [
          { value: "none", label: "None (single turn)" },
          { value: "window", label: "Buffer window (last N turns)" },
          { value: "buffer", label: "Full buffer" },
          { value: "summary", label: "Window (summary-style trim)" },
        ],
        help: "Prior Chat panel turns are prepended, same as the LLM node.",
      },
      {
        key: "memoryWindow",
        label: "Memory window (turns)",
        kind: "number",
        section: "processing",
        defaultValue: 10,
        visibleWhen: { key: "memoryType", equals: ["window", "summary"] },
      },
      {
        key: "returnIntermediateSteps",
        label: "Return intermediate tool steps",
        kind: "checkbox",
        section: "processing",
        defaultValue: true,
        help: "Keep the ReAct trace (tool calls + observations) on the stage payload.",
      },
      {
        key: "enableDynamicCode",
        label: "Enable dynamic code (Python / JavaScript)",
        kind: "checkbox",
        section: "processing",
        defaultValue: true,
        help: "Local agent loop / adapters — or generate from a text description",
      },
      {
        key: "codeLanguage",
        label: "Code language",
        kind: "select",
        section: "processing",
        options: [
          { value: "python", label: "Python" },
          { value: "javascript", label: "JavaScript" },
        ],
        defaultValue: "python",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      {
        key: "codeMode",
        label: "Code source",
        kind: "select",
        section: "processing",
        options: [
          { value: "manual", label: "Write code myself" },
          { value: "from_intent", label: "Generate from text description" },
        ],
        defaultValue: "from_intent",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      {
        key: "intentText",
        label: "Describe the agent goal / behavior",
        kind: "textarea",
        section: "processing",
        rows: 4,
        placeholder:
          "e.g. Enrich each lead via REST, classify score, call remote CrewAI if confidence low",
        visibleWhen: { key: "codeMode", equals: "from_intent" },
      },
      {
        key: "dynamicCode",
        label: "Dynamic agent code",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 14,
        placeholder: "# run(stages, ctx) / remote invoke adapter",
        help: "ctx['agent_step'](messages, tools) and ctx['llm_complete'](messages) are injected at run time.",
        visibleWhen: { key: "enableDynamicCode", equals: "true" },
      },
      {
        key: "writeYamlOutput",
        label: "Write result YAML file",
        kind: "checkbox",
        section: "output",
        defaultValue: true,
        help: "Persists agent output under the run folder for remote copy / audit",
      },
      {
        key: "yamlOutputPath",
        label: "YAML output path (relative to run root)",
        kind: "text",
        section: "output",
        placeholder: "outputs/agent_result.yaml",
        defaultValue: "outputs/agent_result.yaml",
        visibleWhen: { key: "writeYamlOutput", equals: "true" },
      },
      stageOut(),
      {
        key: "outputFormat",
        label: "Output format",
        kind: "format",
        section: "output",
        options: [
          { value: "yaml", label: "YAML" },
          { value: "json", label: "JSON" },
          { value: "text", label: "Text" },
          { value: "raw", label: "Raw" },
        ],
        defaultValue: "yaml",
      },
    ],
  }),

  sub_workflow: schema("sub_workflow", "Call another workflow team", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.subflow"],
    fields: [
      stageIn("__inputs", "Inputs passed to child"),
      {
        key: "workspaceRef",
        label: "Child workspace id / name",
        kind: "text",
        section: "processing",
        required: true,
        placeholder: "ws_enrichment",
      },
      {
        key: "waitForCompletion",
        label: "Wait for completion",
        kind: "checkbox",
        section: "processing",
        defaultValue: true,
      },
      {
        key: "inputMapping",
        label: "Input mapping (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 5,
        placeholder: "child_users: stage.users\n",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  rag: schema("rag", "Retrieve + ground generation", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    requiresConnector: false,
    connectorTypes: ["mongodb"],
    defaultOutputs: ["stage.rag"],
    defaultConfig: { topK: 5, retrieveMode: "auto", outputFormat: "json" },
    fields: [
      stageIn("__inputs", "Query / context stages"),
      {
        key: "queryTemplate",
        label: "Query template",
        kind: "template",
        section: "input",
        rows: 3,
        required: true,
        placeholder: "{{query}}",
        help: "{{query}} / {{question}} resolve to the current Chat message. Upstream embedding vectors enable cosine retrieve.",
      },
      {
        key: "collection",
        label: "Vector collection",
        kind: "text",
        section: "processing",
        required: true,
        placeholder: "embeddings",
      },
      {
        key: "topK",
        label: "Top K",
        kind: "number",
        section: "processing",
        defaultValue: 5,
      },
      {
        key: "retrieveMode",
        label: "Retrieve mode",
        kind: "select",
        section: "processing",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "Auto (vector if embeddings present)" },
          { value: "keyword", label: "Keyword" },
          { value: "vector", label: "Vector (cosine)" },
        ],
      },
      {
        key: "provider",
        label: "Grounding / embed provider",
        kind: "select",
        section: "processing",
        optionsFrom: "llmProviders",
        defaultValue: "openai",
        help: "Used to embed the query (vector mode) and to generate the grounded answer.",
      },
      {
        key: "model",
        label: "Grounding model",
        kind: "text",
        section: "processing",
        placeholder: "gpt-4o-mini",
      },
      {
        key: "secretRef",
        label: "API key secret",
        kind: "secretRef",
        section: "processing",
        placeholder: "secret://openai",
      },
      {
        key: "groundPrompt",
        label: "Grounding prompt",
        kind: "template",
        section: "processing",
        rows: 5,
        placeholder: "Answer using only:\n{{ contexts }}",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  embedding: schema("embedding", "Embed texts / chunks", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.vectors"],
    defaultConfig: {
      provider: "openai",
      model: "text-embedding-3-small",
      chunkSize: 512,
      chunkOverlap: 64,
      outputFormat: "json",
      secretRef: "secret://openai",
    },
    fields: [
      stageIn(),
      {
        key: "textField",
        label: "Text field / expression",
        kind: "text",
        section: "input",
        placeholder: "content",
        required: true,
      },
      {
        key: "provider",
        label: "Provider",
        kind: "select",
        section: "input",
        optionsFrom: "llmProviders",
        defaultValue: "openai",
      },
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        section: "input",
        placeholder: "https://api.openai.com/v1",
      },
      {
        key: "model",
        label: "Embedding model",
        kind: "text",
        section: "processing",
        required: true,
      },
      {
        key: "chunkSize",
        label: "Chunk size",
        kind: "number",
        section: "processing",
        defaultValue: 512,
      },
      {
        key: "chunkOverlap",
        label: "Chunk overlap",
        kind: "number",
        section: "processing",
        defaultValue: 64,
      },
      {
        key: "secretRef",
        label: "API key secret",
        kind: "secretRef",
        section: "processing",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  tool: schema("tool", "Deterministic tool call (calculator, HTTP, stage lookup, python)", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.tool"],
    defaultConfig: {
      toolKind: "calculator",
      outputFormat: "json",
    },
    fields: [
      stageIn("__inputs", "Optional context stages"),
      {
        key: "toolKind",
        label: "Tool",
        kind: "select",
        section: "input",
        required: true,
        defaultValue: "calculator",
        options: [
          { value: "calculator", label: "Calculator" },
          { value: "lookup_stage", label: "Lookup stage rows" },
          { value: "rag_search", label: "Keyword search stages" },
          { value: "rest_get", label: "HTTP GET" },
          { value: "current_time", label: "Current UTC time" },
          { value: "mongo_query", label: "Filter upstream rows" },
          { value: "python", label: "Custom Python" },
        ],
        help: "Flowise Custom Tool analog — runs in-process, no model required.",
      },
      {
        key: "expression",
        label: "Expression",
        kind: "text",
        section: "processing",
        placeholder: "2 * (3 + 4)",
        visibleWhen: { key: "toolKind", equals: "calculator" },
      },
      {
        key: "url",
        label: "URL",
        kind: "text",
        section: "processing",
        placeholder: "https://httpbin.org/json",
        visibleWhen: { key: "toolKind", equals: "rest_get" },
      },
      {
        key: "stageKey",
        label: "Stage key substring",
        kind: "text",
        section: "processing",
        placeholder: "mongo",
        visibleWhen: { key: "toolKind", equals: "lookup_stage" },
      },
      {
        key: "query",
        label: "Search query",
        kind: "text",
        section: "processing",
        visibleWhen: { key: "toolKind", equals: "rag_search" },
      },
      {
        key: "field",
        label: "Field",
        kind: "text",
        section: "processing",
        visibleWhen: { key: "toolKind", equals: "mongo_query" },
      },
      {
        key: "value",
        label: "Value",
        kind: "text",
        section: "processing",
        visibleWhen: { key: "toolKind", equals: "mongo_query" },
      },
      {
        key: "arguments",
        label: "Extra arguments (JSON)",
        kind: "json",
        section: "processing",
        rows: 4,
        placeholder: "{}",
      },
      {
        key: "dynamicCode",
        label: "Python tool body",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 10,
        placeholder: 'def run(stages, ctx):\n    return {"ok": True}',
        visibleWhen: { key: "toolKind", equals: "python" },
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  // ── Data / Mongo ────────────────────────────────────────
  "mongodb.read": schema("mongodb.read", "Find into stage (all matching rows by default)", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    producesStageOutputs: true,
    defaultOutputs: ["stage.mongo"],
    defaultConfig: { mode: "collection", outputFormat: "yaml" },
    fields: [
      {
        key: "mode",
        label: "Query mode",
        kind: "select",
        section: "input",
        defaultValue: "collection",
        options: [
          { value: "collection", label: "Collection" },
          { value: "table", label: "Table (alias)" },
          { value: "aggregation", label: "Aggregation pipeline" },
          { value: "sql", label: "SQL (SQL connectors)" },
        ],
        help: "Collection/table use Filter + Projection. Aggregation uses pipeline (filter applied as $match when set).",
      },
      {
        key: "database",
        label: "Database",
        kind: "text",
        section: "input",
        placeholder: "ops",
      },
      {
        key: "collection",
        label: "Collection / table",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "users",
        visibleWhen: { key: "mode", equals: ["collection", "table", "aggregation"] },
      },
      {
        key: "sql",
        label: "SQL",
        kind: "code",
        language: "sql",
        section: "input",
        rows: 4,
        placeholder: "SELECT * FROM users WHERE status = 'active'",
        visibleWhen: { key: "mode", equals: "sql" },
        help: "For MongoDB use collection/aggregation modes. SQL mode is for SQL connector plugins.",
      },
      {
        key: "pipeline",
        label: "Aggregation pipeline (JSON)",
        kind: "json",
        section: "processing",
        rows: 6,
        placeholder: '[\n  { "$group": { "_id": "$status", "n": { "$sum": 1 } } }\n]',
        visibleWhen: { key: "mode", equals: "aggregation" },
      },
      {
        key: "filter",
        label: "Filter (JSON)",
        kind: "json",
        section: "processing",
        rows: 5,
        placeholder: '{\n  "status": "active"\n}',
        help: "Applied on the server/driver first. Leave empty to match all documents.",
      },
      {
        key: "projection",
        label: "Projection (JSON)",
        kind: "json",
        section: "processing",
        rows: 3,
        placeholder: '{ "email": 1, "status": 1 }',
        help: "Applied after filter. Include/exclude fields returned into the stage dataset.",
      },
      {
        key: "sort",
        label: "Sort (JSON)",
        kind: "json",
        section: "processing",
        rows: 2,
        placeholder: '{ "updatedAt": -1 }',
      },
      {
        key: "limit",
        label: "Limit",
        kind: "number",
        section: "processing",
        placeholder: "Optional — leave empty to read all matching rows",
        help: "Use Filter and Projection to narrow columns/rows. Empty limit = all matches.",
      },
      stageOut(),
      outFormat("yaml"),
    ],
  }),

  "mongodb.write": schema("mongodb.write", "Insert / upsert documents", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    acceptsStageInputs: true,
    defaultConfig: { mode: "insert", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "database",
        label: "Database",
        kind: "text",
        section: "input",
      },
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "mode",
        label: "Write mode",
        kind: "select",
        section: "processing",
        options: [
          { value: "insert", label: "Insert" },
          { value: "upsert", label: "Upsert" },
          { value: "replace", label: "Replace" },
        ],
      },
      {
        key: "upsertKey",
        label: "Upsert key fields",
        kind: "text",
        section: "processing",
        placeholder: "_id, email",
      },
      {
        key: "documentTemplate",
        label: "Document mapping (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 6,
        placeholder: "email: \"{{ row.email }}\"\nstatus: enriched\n",
      },
      {
        key: "writeReceiptStage",
        label: "Write receipt stage (optional)",
        kind: "stage",
        section: "output",
        placeholder: "stage.write_receipt",
      },
      outFormat("json"),
    ],
  }),

  "mongodb.update": schema("mongodb.update", "Update / delete by filter", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    acceptsStageInputs: true,
    defaultConfig: { operation: "updateMany", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "operation",
        label: "Operation",
        kind: "select",
        section: "processing",
        options: [
          { value: "updateOne", label: "updateOne" },
          { value: "updateMany", label: "updateMany" },
          { value: "deleteOne", label: "deleteOne" },
          { value: "deleteMany", label: "deleteMany" },
        ],
      },
      {
        key: "filter",
        label: "Filter (JSON)",
        kind: "json",
        section: "processing",
        rows: 4,
        required: true,
      },
      {
        key: "update",
        label: "Update doc (JSON)",
        kind: "json",
        section: "processing",
        rows: 4,
        placeholder: '{ "$set": { "enriched": true } }',
      },
      stageOut("__outputs", "Result stage", "Matched / modified counts"),
      outFormat("json"),
    ],
  }),

  "mongodb.aggregate": schema("mongodb.aggregate", "Aggregation pipeline → columnar stage", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    producesStageOutputs: true,
    defaultOutputs: ["stage.agg"],
    defaultConfig: { mode: "aggregation", outputFormat: "yaml" },
    fields: [
      {
        key: "mode",
        label: "Query mode",
        kind: "select",
        section: "input",
        defaultValue: "aggregation",
        options: [{ value: "aggregation", label: "Aggregation" }],
      },
      {
        key: "database",
        label: "Database",
        kind: "text",
        section: "input",
      },
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "filter",
        label: "Filter → $match (JSON)",
        kind: "json",
        section: "processing",
        rows: 3,
        placeholder: '{ "status": "active" }',
        help: "Prepended as $match when set. Applied before pipeline stages.",
      },
      {
        key: "pipeline",
        label: "Aggregation pipeline (JSON array)",
        kind: "json",
        section: "processing",
        rows: 10,
        required: true,
        placeholder: '[\n  { "$group": { "_id": "$country", "n": { "$sum": 1 } } }\n]',
      },
      {
        key: "projection",
        label: "Projection (JSON)",
        kind: "json",
        section: "processing",
        rows: 2,
        placeholder: '{ "n": 1 }',
        help: "Optional $project appended after pipeline when set.",
      },
      {
        key: "limit",
        label: "Limit",
        kind: "number",
        section: "processing",
        placeholder: "Optional — leave empty to read all matching rows",
        help: "Use Filter and Projection to narrow columns/rows. Empty limit = all matches.",
      },
      {
        key: "allowDiskUse",
        label: "Allow disk use",
        kind: "checkbox",
        section: "processing",
        defaultValue: false,
      },
      stageOut(),
      outFormat("yaml"),
    ],
  }),

  "mongodb.changestream": schema("mongodb.changestream", "CDC change stream", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    producesStageOutputs: true,
    defaultOutputs: ["stage.cdc"],
    defaultConfig: { fullDocument: "updateLookup", outputFormat: "json" },
    fields: [
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "pipeline",
        label: "Stream pipeline filter (JSON)",
        kind: "json",
        section: "processing",
        rows: 4,
        placeholder: '[{ "$match": { "operationType": { "$in": ["insert", "update"] } } }]',
      },
      {
        key: "fullDocument",
        label: "Full document",
        kind: "select",
        section: "processing",
        options: [
          { value: "default", label: "Default" },
          { value: "updateLookup", label: "updateLookup" },
          { value: "whenAvailable", label: "whenAvailable" },
        ],
      },
      {
        key: "resumeTokenStage",
        label: "Resume token stage",
        kind: "text",
        section: "processing",
        placeholder: "stage.cdc_token",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "mongodb.schema": schema("mongodb.schema", "Sample schema & fields → columnar", {
    requiresConnector: true,
    connectorTypes: ["mongodb"],
    producesStageOutputs: true,
    defaultOutputs: ["stage.schema"],
    defaultConfig: { mode: "collection", sampleSize: 50, outputFormat: "yaml" },
    fields: [
      {
        key: "database",
        label: "Database",
        kind: "text",
        section: "input",
      },
      {
        key: "collection",
        label: "Collection",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "filter",
        label: "Filter (JSON)",
        kind: "json",
        section: "processing",
        rows: 3,
        placeholder: "{}",
        help: "Optional sample filter before schema inference.",
      },
      {
        key: "projection",
        label: "Projection (JSON)",
        kind: "json",
        section: "processing",
        rows: 2,
      },
      {
        key: "sampleSize",
        label: "Sample size",
        kind: "number",
        section: "processing",
        defaultValue: 50,
        help: "Docs to sample for column inference.",
      },
      {
        key: "limit",
        label: "Limit",
        kind: "number",
        section: "processing",
        placeholder: "Optional — overrides sample size when set",
        help: "Empty = use sample size above.",
      },
      stageOut(),
      outFormat("yaml"),
    ],
  }),

  "stage.load": schema("stage.load", "Load named stage into context", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.loaded"],
    fields: [
      {
        key: "stageKey",
        label: "Stage to load",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "stage.mongo",
        help: "Named stage cache key. Also merges any canvas-wired upstream stages.",
      },
      {
        key: "alias",
        label: "Alias in context",
        kind: "text",
        section: "processing",
        placeholder: "df",
      },
      {
        key: "filter",
        label: "Row filter (JSON equality)",
        kind: "json",
        section: "processing",
        rows: 3,
        placeholder: '{"status":"active"}',
      },
      {
        key: "projection",
        label: "Keep columns (JSON list or {col:1})",
        kind: "json",
        section: "processing",
        rows: 3,
      },
      {
        key: "limit",
        label: "Limit",
        kind: "number",
        section: "processing",
        help: "Empty = all matching rows",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "stage.pass": schema("stage.pass", "Handover dataset unchanged", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    fields: [
      stageIn("__inputs", "Pass-through stages", "Stages forwarded as-is"),
      {
        key: "renameMap",
        label: "Rename map (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 3,
        placeholder: "stage.mongo: stage.users\n",
      },
      stageOut(),
      outFormat("raw"),
    ],
  }),

  "file.source": schema("file.source", "Load CSV / Parquet / JSON", {
    producesStageOutputs: true,
    defaultOutputs: ["stage.file"],
    defaultConfig: { format: "csv", outputFormat: "json" },
    fields: [
      {
        key: "path",
        label: "Path / URI",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "s3://bucket/raw/events/*.parquet",
      },
      {
        key: "format",
        label: "File format",
        kind: "select",
        section: "input",
        options: [
          { value: "csv", label: "CSV" },
          { value: "parquet", label: "Parquet" },
          { value: "json", label: "JSON" },
          { value: "jsonl", label: "JSONL" },
          { value: "yaml", label: "YAML" },
          { value: "avro", label: "Avro" },
        ],
      },
      {
        key: "options",
        label: "Reader options (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 4,
        placeholder: "header: true\ndelimiter: \",\"\n",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  "file.sink": schema("file.sink", "Write file sink", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.filesink"],
    defaultConfig: { format: "parquet", outputFormat: "raw" },
    fields: [
      stageIn(),
      {
        key: "path",
        label: "Destination path / URI",
        kind: "text",
        section: "output",
        required: true,
        placeholder: "s3://bucket/curated/out/",
      },
      {
        key: "format",
        label: "Write format",
        kind: "select",
        section: "processing",
        options: [
          { value: "csv", label: "CSV" },
          { value: "parquet", label: "Parquet" },
          { value: "json", label: "JSON" },
          { value: "jsonl", label: "JSONL" },
          { value: "yaml", label: "YAML" },
          { value: "avro", label: "Avro" },
        ],
      },
      {
        key: "partitionBy",
        label: "Partition columns",
        kind: "text",
        section: "processing",
        placeholder: "dt, country",
      },
      outFormat("raw"),
    ],
  }),

  rest: schema("rest", "External HTTP request", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.rest"],
    defaultConfig: { method: "GET", outputFormat: "json" },
    fields: [
      stageIn("__inputs", "Body / params stages"),
      {
        key: "url",
        label: "URL",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "https://api.example.com/v1/items",
      },
      {
        key: "method",
        label: "Method",
        kind: "select",
        section: "input",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
      },
      {
        key: "headers",
        label: "Headers (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 4,
        placeholder: "Authorization: Bearer {{ secrets.token }}\n",
      },
      {
        key: "body",
        label: "Request body template",
        kind: "template",
        section: "processing",
        rows: 6,
        language: "json",
      },
      {
        key: "secretRef",
        label: "Auth secret",
        kind: "secretRef",
        section: "processing",
      },
      {
        key: "responsePath",
        label: "JSONPath to extract",
        kind: "text",
        section: "output",
        help: "Executed after the HTTP call. Simple dotted path, e.g. data.items",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  // ── Logic ────────────────────────────────────────────────
  code: schema("code", "Python / JS sandbox transform", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.code"],
    defaultConfig: { language: "python", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "language",
        label: "Runtime",
        kind: "select",
        section: "processing",
        options: [
          { value: "python", label: "Python" },
          { value: "javascript", label: "JavaScript" },
        ],
      },
      {
        key: "script",
        label: "Script",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 12,
        required: true,
        placeholder:
          "# inputs available as `stages` — return rows or a dict; stored as this node's stage\ndef run(stages, ctx):\n    data = stages.get(next(iter(stages), \"\"), {})\n    rows = data.get(\"rows\", data) if isinstance(data, dict) else data\n    return rows\n",
      },
      {
        key: "requirements",
        label: "Extra packages (comma)",
        kind: "text",
        section: "processing",
        placeholder: "pandas,numpy",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  python: schema("python", "Execute a Python script in the workflow", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.python"],
    defaultConfig: {
      outputFormat: "json",
      script: `# stages = dict of upstream stage payloads; set result or return from run()
def run(stages, ctx):
    rows = stages.get("stage.mongo_orders") or []
    if isinstance(rows, dict) and "rows" in rows:
        rows = rows["rows"]
    return {"row_count": len(rows) if isinstance(rows, list) else 0, "rows": rows}
`,
    },
    fields: [
      stageIn(),
      {
        key: "script",
        label: "Python script",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 14,
        required: true,
        help: "Prefer def run(stages, ctx) and return a dict or list of rows. The return value is stored as this node's stage and handed to connected nodes.",
      },
      {
        key: "requirements",
        label: "Extra packages (comma)",
        kind: "text",
        section: "processing",
        placeholder: "pandas,pymongo",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  notebook: schema("notebook", "Notebook-style cells inside the workflow", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.notebook"],
    defaultConfig: {
      outputFormat: "json",
      notebookSource: "saved",
      notebookId: "",
      source: "",
    },
    fields: [
      stageIn(),
      {
        key: "notebookSource",
        label: "Notebook source",
        kind: "select",
        section: "processing",
        options: [
          { value: "saved", label: "Saved notebook (from Notebook menu)" },
          { value: "inline", label: "Inline cells in this node" },
        ],
        help: "Save a notebook from the top Notebook view, then select it here.",
      },
      {
        key: "notebookId",
        label: "Saved notebook",
        kind: "select",
        section: "processing",
        optionsFrom: "savedNotebooks",
        visibleWhen: { key: "notebookSource", equals: "saved" },
        help: "Pick a notebook saved from the Notebook menu. Available on Run without Apply.",
      },
      {
        key: "source",
        label: "Inline notebook cells",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 16,
        visibleWhen: { key: "notebookSource", equals: "inline" },
        help: "Split cells with # %% or # COMMAND ----------. Markdown: # %% markdown",
      },
      {
        key: "requirements",
        label: "Extra packages (comma)",
        kind: "text",
        section: "processing",
        placeholder: "pandas,pyyaml",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  set_variables: schema("set_variables", "Write context / env vars", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.vars"],
    defaultConfig: { outputFormat: "yaml" },
    fields: [
      stageIn("__inputs", "Optional source stages"),
      {
        key: "variables",
        label: "Variables (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 8,
        required: true,
        placeholder: "env: prod\nbatch_id: \"{{ run.id }}\"\n",
      },
      stageOut(),
      outFormat("yaml"),
    ],
  }),

  transform: schema("transform", "Map / filter / join / aggregate", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.transform"],
    defaultConfig: { engine: "expression", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "engine",
        label: "Engine",
        kind: "select",
        section: "processing",
        options: [
          { value: "expression", label: "Expression DSL" },
          { value: "sql", label: "SQL" },
          { value: "python", label: "Python" },
        ],
      },
      {
        key: "ops",
        label: "Operations (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 6,
        placeholder: "- map: { email: lower(email) }\n- filter: status == \"active\"\n",
      },
      {
        key: "sql",
        label: "SQL (if engine = sql)",
        kind: "code",
        section: "processing",
        language: "sql",
        rows: 6,
        placeholder: "SELECT * FROM stage_mongo WHERE status = 'active'",
      },
      {
        key: "script",
        label: "Python (if engine = python)",
        kind: "code",
        section: "processing",
        language: "python",
        rows: 8,
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  // ── Control ──────────────────────────────────────────────
  if: schema("if", "Binary branch on condition", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.if"],
    defaultConfig: {
      language: "expression",
      evaluator: "expression",
      condition: "row_count > 0",
      outputFormat: "json",
    },
    fields: [
      stageIn("__inputs", "Stages for condition"),
      {
        key: "evaluator",
        label: "Evaluator",
        kind: "select",
        section: "processing",
        defaultValue: "expression",
        options: [
          { value: "expression", label: "Expression (Python-like)" },
          { value: "llm", label: "Condition agent (LLM true/false)" },
        ],
        help: "Expression uses row fields (query, number, …). LLM asks the model to answer true or false — Flowise-style Condition Agent.",
      },
      {
        key: "condition",
        label: "Condition",
        kind: "code",
        section: "processing",
        language: "javascript",
        rows: 3,
        required: true,
        placeholder: "number % 2 == 0",
        help: "Expression: row fields as variables. LLM evaluator: natural language, e.g. 'the user is asking about billing'.",
      },
      {
        key: "provider",
        label: "Condition-agent provider",
        kind: "select",
        section: "processing",
        optionsFrom: "llmProviders",
        defaultValue: "openai",
        visibleWhen: { key: "evaluator", equals: "llm" },
      },
      {
        key: "model",
        label: "Condition-agent model",
        kind: "select",
        section: "processing",
        optionsFrom: "llmModels",
        visibleWhen: { key: "evaluator", equals: "llm" },
      },
      {
        key: "secretRef",
        label: "Condition-agent API key",
        kind: "secretRef",
        section: "processing",
        placeholder: "secret://openai",
        visibleWhen: { key: "evaluator", equals: "llm" },
      },
      {
        key: "trueLabel",
        label: "True branch label",
        kind: "text",
        section: "output",
        defaultValue: "true",
      },
      {
        key: "falseLabel",
        label: "False branch label",
        kind: "text",
        section: "output",
        defaultValue: "false",
      },
      stageOut(
        "__outputs",
        "Handover stage",
        "Stored for the chosen branch — includes upstream rows plus matched/branch",
      ),
      outFormat("json"),
    ],
  }),

  switch: schema("switch", "Multi-branch by expression", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.switch"],
    defaultConfig: { outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "field",
        label: "Switch expression / field",
        kind: "text",
        section: "processing",
        required: true,
        placeholder: "stage.llm.score_band",
      },
      {
        key: "cases",
        label: "Cases (YAML list)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 6,
        required: true,
        placeholder: "- high\n- medium\n- low\n",
      },
      {
        key: "defaultCase",
        label: "Default case label",
        kind: "text",
        section: "output",
        placeholder: "default",
      },
      stageOut(
        "__outputs",
        "Handover stage",
        "Passed to the matching case branch (upstream rows + switch value)",
      ),
      outFormat("json"),
    ],
  }),

  loop: schema("loop", "Iterate collection", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.loop"],
    defaultConfig: { mode: "sequential", outputFormat: "json" },
    fields: [
      stageIn("__inputs", "Collection stage"),
      {
        key: "itemsPath",
        label: "Items path",
        kind: "text",
        section: "input",
        placeholder: "stage.trigger",
        help: "Stage key or dotted path. If empty, Loop uses rows from the connected upstream node.",
      },
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        section: "processing",
        options: [
          { value: "sequential", label: "Sequential" },
          { value: "parallel", label: "Parallel" },
        ],
      },
      {
        key: "concurrency",
        label: "Parallel concurrency",
        kind: "number",
        section: "processing",
        defaultValue: 4,
      },
      {
        key: "itemAlias",
        label: "Item alias in body",
        kind: "text",
        section: "processing",
        defaultValue: "item",
        help: "Downstream IF expressions can use this name, plus item and loop.item.",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  parallel: schema("parallel", "Fan-out / fan-in", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.parallel"],
    fields: [
      stageIn(),
      {
        key: "branches",
        label: "Branch ids (comma)",
        kind: "text",
        section: "processing",
        placeholder: "a,b,c",
      },
      {
        key: "joinStrategy",
        label: "Join strategy",
        kind: "select",
        section: "output",
        options: [
          { value: "all", label: "Wait all" },
          { value: "any", label: "First success" },
          { value: "settle", label: "Settle all (incl. errors)" },
        ],
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  human_approval: schema("human_approval", "Human-in-the-loop gate", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.approval"],
    fields: [
      stageIn(),
      {
        key: "message",
        label: "Approval message template",
        kind: "template",
        section: "processing",
        rows: 4,
        required: true,
        placeholder: "Approve write of {{ stage.transform | length }} rows?",
      },
      {
        key: "assignees",
        label: "Assignees (emails)",
        kind: "text",
        section: "processing",
        placeholder: "ops@company.com",
      },
      {
        key: "timeoutMinutes",
        label: "Timeout (minutes)",
        kind: "number",
        section: "processing",
        defaultValue: 60,
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  wait: schema("wait", "Pause for duration or event", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.wait"],
    defaultConfig: { outputFormat: "json" },
    fields: [
      stageIn("__inputs", "Optional stages to pass through"),
      {
        key: "mode",
        label: "Wait mode",
        kind: "select",
        section: "processing",
        options: [
          { value: "duration", label: "Duration" },
          { value: "until", label: "Until timestamp" },
          { value: "event", label: "Until event" },
        ],
      },
      {
        key: "durationSec",
        label: "Duration (seconds)",
        kind: "number",
        section: "processing",
        defaultValue: 30,
      },
      {
        key: "until",
        label: "Until (ISO timestamp)",
        kind: "text",
        section: "processing",
      },
      {
        key: "eventName",
        label: "Event name",
        kind: "text",
        section: "processing",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  return: schema("return", "Terminate with outputs", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.return"],
    defaultConfig: { outputFormat: "json" },
    fields: [
      stageIn("__inputs", "Final stages to return"),
      {
        key: "status",
        label: "Status",
        kind: "select",
        section: "processing",
        options: [
          { value: "success", label: "Success" },
          { value: "failed", label: "Failed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "summaryTemplate",
        label: "Summary template",
        kind: "template",
        section: "processing",
        rows: 3,
      },
      stageOut("__outputs", "Return payload stage"),
      outFormat("json"),
    ],
  }),

  error_handler: schema("error_handler", "Catch / retry / branch", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.error"],
    defaultConfig: { action: "retry", maxAttempts: 3, backoffMs: 2000 },
    fields: [
      stageIn("__inputs", "Error payload stages"),
      {
        key: "action",
        label: "Action",
        kind: "select",
        section: "processing",
        options: [
          { value: "retry", label: "Retry" },
          { value: "skip", label: "Skip" },
          { value: "branch", label: "Branch" },
          { value: "abort", label: "Abort" },
        ],
      },
      {
        key: "maxAttempts",
        label: "Max attempts",
        kind: "number",
        section: "processing",
        defaultValue: 3,
      },
      {
        key: "backoffMs",
        label: "Backoff (ms)",
        kind: "number",
        section: "processing",
        defaultValue: 2000,
      },
      {
        key: "onExhausted",
        label: "On exhausted",
        kind: "select",
        section: "output",
        options: [
          { value: "abort", label: "Abort run" },
          { value: "notify", label: "Notify then abort" },
          { value: "continue", label: "Continue branch" },
        ],
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  // ── Communication ────────────────────────────────────────
  "notify.email": schema("notify.email", "Send email notification", {
    acceptsStageInputs: true,
    requiresConnector: false,
    defaultConfig: { bodyFormat: "html", outputFormat: "text" },
    fields: [
      stageIn("__inputs", "Stages for template vars"),
      {
        key: "to",
        label: "To (comma emails)",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "oncall@company.com",
      },
      {
        key: "cc",
        label: "Cc",
        kind: "text",
        section: "input",
      },
      {
        key: "subject",
        label: "Subject template",
        kind: "template",
        section: "processing",
        rows: 2,
        required: true,
        placeholder: "[{{ run.status }}] {{ workspace.name }} · {{ node.label }}",
      },
      {
        key: "bodyFormat",
        label: "Body format",
        kind: "select",
        section: "processing",
        options: [
          { value: "html", label: "HTML" },
          { value: "text", label: "Plain text" },
          { value: "markdown", label: "Markdown" },
        ],
      },
      {
        key: "bodyTemplate",
        label: "Mail template",
        kind: "template",
        section: "processing",
        language: "html",
        rows: 10,
        required: true,
        placeholder:
          "<h3>Run {{ run.id }}</h3>\n<p>Plugin step finished with {{ stage.result | length }} rows.</p>\n<pre>{{ stage.result | tojson }}</pre>",
      },
      {
        key: "smtpSecretRef",
        label: "SMTP / provider secret",
        kind: "secretRef",
        section: "processing",
        placeholder: "secret://smtp_prod",
      },
      {
        key: "attachStages",
        label: "Attach stages as files",
        kind: "text",
        section: "output",
        placeholder: "stage.result:result.json",
      },
      outFormat("text"),
    ],
  }),

  "notify.slack": schema("notify.slack", "Post to Slack", {
    acceptsStageInputs: true,
    defaultConfig: { outputFormat: "text" },
    fields: [
      stageIn(),
      {
        key: "channel",
        label: "Channel",
        kind: "text",
        section: "input",
        required: true,
        placeholder: "#data-alerts",
      },
      {
        key: "messageTemplate",
        label: "Message template",
        kind: "template",
        section: "processing",
        rows: 6,
        required: true,
        placeholder: ":white_check_mark: *{{ workspace.name }}* succeeded ({{ run.id }})",
      },
      {
        key: "webhookSecretRef",
        label: "Webhook / bot secret",
        kind: "secretRef",
        section: "processing",
        placeholder: "secret://slack_webhook",
      },
      outFormat("text"),
    ],
  }),

  "notify.teams": schema("notify.teams", "Microsoft Teams message", {
    acceptsStageInputs: true,
    defaultConfig: { cardStyle: "adaptive", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "webhookSecretRef",
        label: "Incoming webhook secret",
        kind: "secretRef",
        section: "input",
        required: true,
        placeholder: "secret://teams_test",
      },
      {
        key: "title",
        label: "Card title template",
        kind: "template",
        section: "processing",
        rows: 2,
        required: true,
        placeholder: "{{ run.status | upper }} · {{ workspace.name }}",
      },
      {
        key: "cardStyle",
        label: "Card style",
        kind: "select",
        section: "processing",
        options: [
          { value: "adaptive", label: "Adaptive card" },
          { value: "messagecard", label: "MessageCard" },
          { value: "text", label: "Plain text" },
        ],
      },
      {
        key: "bodyTemplate",
        label: "Body / Adaptive Card JSON template",
        kind: "template",
        section: "processing",
        language: "json",
        rows: 10,
        required: true,
        placeholder:
          "{\n  \"type\": \"AdaptiveCard\",\n  \"body\": [{ \"type\": \"TextBlock\", \"text\": \"Run {{ run.id }}\" }]\n}",
      },
      outFormat("json"),
    ],
  }),

  "webhook.out": schema("webhook.out", "Outbound HTTP webhook", {
    acceptsStageInputs: true,
    producesStageOutputs: true,
    defaultOutputs: ["stage.webhook_out"],
    defaultConfig: { method: "POST", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "url",
        label: "Webhook URL",
        kind: "text",
        section: "input",
        required: true,
      },
      {
        key: "method",
        label: "Method",
        kind: "select",
        section: "processing",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
        ],
      },
      {
        key: "payloadTemplate",
        label: "Payload template",
        kind: "template",
        section: "processing",
        language: "json",
        rows: 8,
        placeholder: "{\n  \"event\": \"workflow.complete\",\n  \"data\": {{ stage.result | tojson }}\n}",
      },
      {
        key: "secretRef",
        label: "Signing / auth secret",
        kind: "secretRef",
        section: "processing",
      },
      stageOut(),
      outFormat("json"),
    ],
  }),

  log: schema("log", "Structured audit / log event", {
    acceptsStageInputs: true,
    defaultConfig: { level: "info", outputFormat: "json" },
    fields: [
      stageIn(),
      {
        key: "level",
        label: "Level",
        kind: "select",
        section: "processing",
        options: [
          { value: "debug", label: "debug" },
          { value: "info", label: "info" },
          { value: "warn", label: "warn" },
          { value: "error", label: "error" },
        ],
      },
      {
        key: "event",
        label: "Event name",
        kind: "text",
        section: "processing",
        required: true,
        placeholder: "pipeline.step.complete",
      },
      {
        key: "messageTemplate",
        label: "Message template",
        kind: "template",
        section: "processing",
        rows: 3,
      },
      {
        key: "fields",
        label: "Extra fields (YAML)",
        kind: "code",
        section: "processing",
        language: "yaml",
        rows: 4,
      },
      outFormat("json"),
    ],
  }),
};

export function getNodeSchema(type: string): NodeSchema | undefined {
  return NODE_SCHEMAS[type];
}

export function defaultConfigForType(type: string): Record<string, unknown> {
  const s = NODE_SCHEMAS[type];
  if (!s) return {};
  const cfg: Record<string, unknown> = { ...(s.defaultConfig ?? {}) };
  for (const f of s.fields) {
    if (f.key.startsWith("__")) continue;
    if (f.defaultValue !== undefined && cfg[f.key] === undefined) {
      cfg[f.key] = f.defaultValue;
    }
  }
  return cfg;
}

export const SECTION_META: Record<
  NodeFieldSection,
  { label: string; hint: string }
> = {
  input: {
    label: "Input",
    hint: "What this node reads — stages, collections, URLs, recipients",
  },
  processing: {
    label: "Processing",
    hint: "Logic — scripts, prompts, filters, mail/Teams templates, SQL",
  },
  output: {
    label: "Output",
    hint: "What this node emits — stage keys, formats (JSON / YAML / text / raw)",
  },
};
