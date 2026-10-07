/**
 * Popular LangChain chat/LLM providers and the connection fields + model lists
 * used by the Studio LLM node. Aligned with:
 * https://docs.langchain.com/oss/python/integrations/providers/
 *
 * Model lists are curated “current popular” names per provider (Aug 2026).
 * Operators can always type a custom model id via “Custom model id”.
 */

export type LlmProviderId =
  | "openai"
  | "anthropic"
  | "google_genai"
  | "google_vertex"
  | "azure_openai"
  | "aws_bedrock"
  | "ollama"
  | "groq"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "together"
  | "deepseek"
  | "xai"
  | "nvidia"
  | "perplexity"
  | "openrouter"
  | "huggingface"
  | "databricks"
  | "ibm_watsonx"
  | "cerebras"
  | "sambanova"
  | "litellm";

export interface LlmProviderField {
  key: string;
  label: string;
  kind: "text" | "password" | "number" | "select" | "secretRef";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number;
}

export interface LlmProviderDef {
  id: LlmProviderId;
  name: string;
  package: string;
  docsUrl: string;
  /** Default secret env / secretRef hint */
  secretEnv: string;
  models: Array<{ id: string; label: string }>;
  /** Extra connection fields beyond api key */
  fields: LlmProviderField[];
}

const m = (id: string, label?: string) => ({ id, label: label ?? id });

export const LLM_PROVIDERS: LlmProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    package: "langchain-openai",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/openai/",
    secretEnv: "OPENAI_API_KEY",
    models: [
      m("gpt-5", "GPT-5"),
      m("gpt-5-mini", "GPT-5 mini"),
      m("gpt-5-nano", "GPT-5 nano"),
      m("gpt-4.1", "GPT-4.1"),
      m("gpt-4.1-mini", "GPT-4.1 mini"),
      m("gpt-4o", "GPT-4o"),
      m("gpt-4o-mini", "GPT-4o mini"),
      m("o3", "o3"),
      m("o4-mini", "o4-mini"),
      m("o3-mini", "o3-mini"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL (optional)",
        kind: "text",
        placeholder: "https://api.openai.com/v1",
        help: "Override for Azure-compatible / proxies",
      },
      {
        key: "organization",
        label: "Organization id",
        kind: "text",
        placeholder: "org-…",
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    package: "langchain-anthropic",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/anthropic/",
    secretEnv: "ANTHROPIC_API_KEY",
    models: [
      m("claude-opus-4-1", "Claude Opus 4.1"),
      m("claude-sonnet-4", "Claude Sonnet 4"),
      m("claude-sonnet-4-20250514", "Claude Sonnet 4 (dated)"),
      m("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet"),
      m("claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"),
      m("claude-3-5-haiku-latest", "Claude 3.5 Haiku"),
      m("claude-3-opus-latest", "Claude 3 Opus"),
    ],
    fields: [
      {
        key: "maxTokens",
        label: "Max tokens",
        kind: "number",
        defaultValue: 4096,
      },
    ],
  },
  {
    id: "google_genai",
    name: "Google (GenAI / Gemini)",
    package: "langchain-google-genai",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/google",
    secretEnv: "GOOGLE_API_KEY",
    models: [
      m("gemini-2.5-pro", "Gemini 2.5 Pro"),
      m("gemini-2.5-flash", "Gemini 2.5 Flash"),
      m("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
      m("gemini-2.0-flash", "Gemini 2.0 Flash"),
      m("gemini-1.5-pro", "Gemini 1.5 Pro"),
      m("gemini-1.5-flash", "Gemini 1.5 Flash"),
    ],
    fields: [],
  },
  {
    id: "google_vertex",
    name: "Google (Vertex AI)",
    package: "langchain-google-vertexai",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/google",
    secretEnv: "GOOGLE_APPLICATION_CREDENTIALS",
    models: [
      m("gemini-2.5-pro", "Gemini 2.5 Pro"),
      m("gemini-2.5-flash", "Gemini 2.5 Flash"),
      m("gemini-2.0-flash-001", "Gemini 2.0 Flash"),
      m("gemini-1.5-pro-002", "Gemini 1.5 Pro"),
    ],
    fields: [
      {
        key: "project",
        label: "GCP project",
        kind: "text",
        required: true,
        placeholder: "my-gcp-project",
      },
      {
        key: "location",
        label: "Location / region",
        kind: "text",
        required: true,
        placeholder: "us-central1",
        defaultValue: "us-central1",
      },
    ],
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI / Azure AI",
    package: "langchain-openai / langchain-azure-ai",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/azure_ai",
    secretEnv: "AZURE_OPENAI_API_KEY",
    models: [
      m("gpt-5", "GPT-5 (deployment name)"),
      m("gpt-4.1", "GPT-4.1"),
      m("gpt-4o", "GPT-4o"),
      m("gpt-4o-mini", "GPT-4o mini"),
      m("o4-mini", "o4-mini"),
    ],
    fields: [
      {
        key: "azureEndpoint",
        label: "Azure endpoint",
        kind: "text",
        required: true,
        placeholder: "https://YOUR.openai.azure.com/",
      },
      {
        key: "azureDeployment",
        label: "Deployment name",
        kind: "text",
        required: true,
        placeholder: "gpt-4o-prod",
        help: "Azure uses deployment name; model list is a starting hint",
      },
      {
        key: "apiVersion",
        label: "API version",
        kind: "text",
        placeholder: "2024-12-01-preview",
        defaultValue: "2024-12-01-preview",
      },
    ],
  },
  {
    id: "aws_bedrock",
    name: "AWS Bedrock",
    package: "langchain-aws",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/aws/",
    secretEnv: "AWS_ACCESS_KEY_ID",
    models: [
      m("anthropic.claude-sonnet-4", "Claude Sonnet 4 (Bedrock)"),
      m("anthropic.claude-3-5-sonnet-20241022-v2:0", "Claude 3.5 Sonnet v2"),
      m("anthropic.claude-3-haiku-20240307-v1:0", "Claude 3 Haiku"),
      m("amazon.nova-pro-v1:0", "Amazon Nova Pro"),
      m("amazon.nova-lite-v1:0", "Amazon Nova Lite"),
      m("meta.llama3-3-70b-instruct-v1:0", "Llama 3.3 70B"),
      m("mistral.mistral-large-2407-v1:0", "Mistral Large"),
    ],
    fields: [
      {
        key: "region",
        label: "AWS region",
        kind: "text",
        required: true,
        placeholder: "us-east-1",
        defaultValue: "us-east-1",
      },
      {
        key: "awsSecretRef",
        label: "AWS credentials secret",
        kind: "secretRef",
        placeholder: "secret://aws_bedrock",
        help: "JSON with accessKeyId / secretAccessKey / sessionToken",
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    package: "langchain-ollama",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/ollama/",
    secretEnv: "",
    models: [
      m("llama3.3", "Llama 3.3"),
      m("llama3.2", "Llama 3.2"),
      m("llama3.1", "Llama 3.1"),
      m("mistral", "Mistral"),
      m("mixtral", "Mixtral"),
      m("qwen2.5", "Qwen 2.5"),
      m("qwen2.5-coder", "Qwen 2.5 Coder"),
      m("deepseek-r1", "DeepSeek R1"),
      m("gemma3", "Gemma 3"),
      m("phi4", "Phi-4"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Ollama base URL",
        kind: "text",
        required: true,
        placeholder: "http://127.0.0.1:11434/v1",
        defaultValue: "http://127.0.0.1:11434/v1",
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    package: "langchain-groq",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/groq/",
    secretEnv: "GROQ_API_KEY",
    models: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B"),
      m("llama-3.1-8b-instant", "Llama 3.1 8B Instant"),
      m("meta-llama/llama-4-scout-17b-16e-instruct", "Llama 4 Scout"),
      m("meta-llama/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick"),
      m("deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill 70B"),
      m("qwen/qwen3-32b", "Qwen3 32B"),
      m("gemma2-9b-it", "Gemma 2 9B"),
    ],
    fields: [],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    package: "langchain-mistralai",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/mistralai/",
    secretEnv: "MISTRAL_API_KEY",
    models: [
      m("mistral-large-latest", "Mistral Large"),
      m("mistral-medium-latest", "Mistral Medium"),
      m("mistral-small-latest", "Mistral Small"),
      m("magistral-medium-latest", "Magistral Medium"),
      m("codestral-latest", "Codestral"),
      m("pixtral-large-latest", "Pixtral Large"),
      m("open-mistral-nemo", "Mistral Nemo"),
    ],
    fields: [],
  },
  {
    id: "cohere",
    name: "Cohere",
    package: "langchain-cohere",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/cohere/",
    secretEnv: "COHERE_API_KEY",
    models: [
      m("command-a-03-2025", "Command A"),
      m("command-r-plus", "Command R+"),
      m("command-r", "Command R"),
      m("command-r7b-12-2024", "Command R7B"),
    ],
    fields: [],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    package: "langchain-fireworks",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/fireworks/",
    secretEnv: "FIREWORKS_API_KEY",
    models: [
      m("accounts/fireworks/models/llama-v3p3-70b-instruct", "Llama 3.3 70B"),
      m("accounts/fireworks/models/llama4-maverick-instruct-basic", "Llama 4 Maverick"),
      m("accounts/fireworks/models/deepseek-r1", "DeepSeek R1"),
      m("accounts/fireworks/models/qwen2p5-72b-instruct", "Qwen 2.5 72B"),
    ],
    fields: [],
  },
  {
    id: "together",
    name: "Together AI",
    package: "langchain-together",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/together/",
    secretEnv: "TOGETHER_API_KEY",
    models: [
      m("meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B Turbo"),
      m("meta-llama/Llama-4-Scout-17B-16E-Instruct", "Llama 4 Scout"),
      m("deepseek-ai/DeepSeek-R1", "DeepSeek R1"),
      m("Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen 2.5 72B"),
      m("mistralai/Mixtral-8x22B-Instruct-v0.1", "Mixtral 8x22B"),
    ],
    fields: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    package: "langchain-deepseek",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/deepseek/",
    secretEnv: "DEEPSEEK_API_KEY",
    models: [
      m("deepseek-chat", "DeepSeek Chat (V3)"),
      m("deepseek-reasoner", "DeepSeek Reasoner (R1)"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        placeholder: "https://api.deepseek.com",
        defaultValue: "https://api.deepseek.com",
      },
    ],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    package: "langchain-xai",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/xai/",
    secretEnv: "XAI_API_KEY",
    models: [
      m("grok-4", "Grok 4"),
      m("grok-3", "Grok 3"),
      m("grok-3-mini", "Grok 3 mini"),
      m("grok-2-latest", "Grok 2"),
    ],
    fields: [],
  },
  {
    id: "nvidia",
    name: "NVIDIA AI Endpoints",
    package: "langchain-nvidia-ai-endpoints",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/nvidia",
    secretEnv: "NVIDIA_API_KEY",
    models: [
      m("meta/llama-3.3-70b-instruct", "Llama 3.3 70B"),
      m("meta/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick"),
      m("nvidia/llama-3.1-nemotron-70b-instruct", "Nemotron 70B"),
      m("mistralai/mistral-large-2-instruct", "Mistral Large 2"),
      m("deepseek-ai/deepseek-r1", "DeepSeek R1"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        placeholder: "https://integrate.api.nvidia.com/v1",
      },
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    package: "langchain-perplexity",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/perplexity/",
    secretEnv: "PPLX_API_KEY",
    models: [
      m("sonar-pro", "Sonar Pro"),
      m("sonar", "Sonar"),
      m("sonar-reasoning-pro", "Sonar Reasoning Pro"),
      m("sonar-deep-research", "Sonar Deep Research"),
    ],
    fields: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    package: "langchain-openrouter",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/openrouter/",
    secretEnv: "OPENROUTER_API_KEY",
    models: [
      m("openai/gpt-5", "OpenAI GPT-5"),
      m("anthropic/claude-sonnet-4", "Claude Sonnet 4"),
      m("google/gemini-2.5-pro", "Gemini 2.5 Pro"),
      m("meta-llama/llama-4-maverick", "Llama 4 Maverick"),
      m("deepseek/deepseek-r1", "DeepSeek R1"),
      m("x-ai/grok-4", "Grok 4"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        placeholder: "https://openrouter.ai/api/v1",
        defaultValue: "https://openrouter.ai/api/v1",
      },
      {
        key: "httpReferer",
        label: "HTTP-Referer (optional)",
        kind: "text",
        placeholder: "https://vynelixai.com",
      },
      {
        key: "maxTokens",
        label: "Max tokens",
        kind: "number",
        defaultValue: 2048,
        help: "Mapped to OpenRouter max_tokens. Keep this at or below your credit budget (do not omit — OpenRouter then uses 65536).",
      },
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    package: "langchain-huggingface",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/huggingface/",
    secretEnv: "HUGGINGFACEHUB_API_TOKEN",
    models: [
      m("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3 70B"),
      m("meta-llama/Llama-4-Scout-17B-16E-Instruct", "Llama 4 Scout"),
      m("Qwen/Qwen2.5-72B-Instruct", "Qwen 2.5 72B"),
      m("mistralai/Mistral-Small-24B-Instruct-2501", "Mistral Small 24B"),
      m("deepseek-ai/DeepSeek-R1", "DeepSeek R1"),
    ],
    fields: [
      {
        key: "endpointUrl",
        label: "Inference endpoint URL (optional)",
        kind: "text",
        placeholder: "https://….endpoints.huggingface.cloud",
      },
    ],
  },
  {
    id: "databricks",
    name: "Databricks",
    package: "databricks-langchain",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/databricks/",
    secretEnv: "DATABRICKS_TOKEN",
    models: [
      m("databricks-meta-llama-3-3-70b-instruct", "Llama 3.3 70B"),
      m("databricks-claude-sonnet-4", "Claude Sonnet 4"),
      m("databricks-gemini-2-5-flash", "Gemini 2.5 Flash"),
      m("databricks-gpt-4o", "GPT-4o"),
    ],
    fields: [
      {
        key: "host",
        label: "Workspace host",
        kind: "text",
        required: true,
        placeholder: "https://adb-….azuredatabricks.net",
      },
      {
        key: "endpointName",
        label: "Serving endpoint name",
        kind: "text",
        placeholder: "databricks-meta-llama-3-3-70b-instruct",
      },
    ],
  },
  {
    id: "ibm_watsonx",
    name: "IBM watsonx",
    package: "langchain-ibm",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/ibm/",
    secretEnv: "WATSONX_APIKEY",
    models: [
      m("ibm/granite-3-3-8b-instruct", "Granite 3.3 8B"),
      m("ibm/granite-3-2-8b-instruct", "Granite 3.2 8B"),
      m("meta-llama/llama-3-3-70b-instruct", "Llama 3.3 70B"),
      m("mistralai/mistral-large", "Mistral Large"),
    ],
    fields: [
      {
        key: "url",
        label: "watsonx URL",
        kind: "text",
        required: true,
        placeholder: "https://us-south.ml.cloud.ibm.com",
      },
      {
        key: "projectId",
        label: "Project id",
        kind: "text",
        required: true,
      },
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    package: "langchain-cerebras",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/cerebras/",
    secretEnv: "CEREBRAS_API_KEY",
    models: [
      m("llama-3.3-70b", "Llama 3.3 70B"),
      m("llama3.1-8b", "Llama 3.1 8B"),
      m("qwen-3-32b", "Qwen 3 32B"),
    ],
    fields: [],
  },
  {
    id: "sambanova",
    name: "SambaNova",
    package: "langchain-sambanova",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/sambanova/",
    secretEnv: "SAMBANOVA_API_KEY",
    models: [
      m("Meta-Llama-3.3-70B-Instruct", "Llama 3.3 70B"),
      m("DeepSeek-R1", "DeepSeek R1"),
      m("Qwen2.5-72B-Instruct", "Qwen 2.5 72B"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        kind: "text",
        placeholder: "https://api.sambanova.ai/v1",
      },
    ],
  },
  {
    id: "litellm",
    name: "LiteLLM (router)",
    package: "langchain-litellm",
    docsUrl:
      "https://docs.langchain.com/oss/python/integrations/providers/litellm/",
    secretEnv: "LITELLM_API_KEY",
    models: [
      m("openai/gpt-5", "openai/gpt-5"),
      m("anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4"),
      m("gemini/gemini-2.5-pro", "gemini/gemini-2.5-pro"),
      m("groq/llama-3.3-70b-versatile", "groq/llama-3.3-70b-versatile"),
    ],
    fields: [
      {
        key: "baseUrl",
        label: "LiteLLM proxy URL",
        kind: "text",
        placeholder: "http://localhost:4000",
      },
    ],
  },
];

export function getLlmProvider(id: string | undefined): LlmProviderDef | undefined {
  if (!id) return undefined;
  return LLM_PROVIDERS.find((p) => p.id === id);
}

export function llmProviderOptions(): Array<{ value: string; label: string }> {
  return LLM_PROVIDERS.map((p) => ({ value: p.id, label: p.name }));
}

export function modelsForProvider(
  providerId: string | undefined,
): Array<{ value: string; label: string }> {
  const p = getLlmProvider(providerId);
  if (!p) return [];
  return p.models.map((x) => ({ value: x.id, label: x.label }));
}

export function defaultModelForProvider(providerId: string | undefined): string {
  const models = modelsForProvider(providerId);
  return models[0]?.value ?? "";
}

/** Connection keys that belong to a specific provider and must be cleared on switch. */
export const LLM_PROVIDER_SCOPED_KEYS = Array.from(
  new Set(
    LLM_PROVIDERS.flatMap((p) => p.fields.map((f) => f.key)).concat([
      "baseUrl",
      "base_url",
      "azureEndpoint",
      "azureDeployment",
      "apiVersion",
      "organization",
      "project",
      "location",
      "region",
      "host",
      "endpointName",
      "endpointUrl",
      "projectId",
      "httpReferer",
      "awsSecretRef",
    ]),
  ),
);
