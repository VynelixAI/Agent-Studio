/**
 * Agent vendors / frameworks for the Agent node — parallel to LLM providers.
 * Covers local code agents and remote product endpoints (LangGraph Cloud,
 * CrewAI, AutoGen, OpenAI Assistants, Azure AI Agent Service, etc.).
 */

export type AgentVendorId =
  | "langgraph"
  | "langchain"
  | "crewai"
  | "autogen"
  | "openai_assistants"
  | "azure_ai_agents"
  | "semantic_kernel"
  | "llamaindex"
  | "haystack"
  | "databricks_agents"
  | "aws_bedrock_agents"
  | "google_adk"
  | "custom_remote"
  | "local_code";

export interface AgentTypeOption {
  id: string;
  label: string;
  description: string;
}

export interface AgentVendorField {
  key: string;
  label: string;
  kind: "text" | "password" | "number" | "select" | "secretRef";
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string | number;
  options?: Array<{ value: string; label: string }>;
}

export interface AgentVendorDef {
  id: AgentVendorId;
  name: string;
  package: string;
  docsUrl: string;
  secretEnv: string;
  /** How the runtime reaches the product */
  runtime: "local" | "remote_http" | "sdk";
  agentTypes: AgentTypeOption[];
  fields: AgentVendorField[];
}

export const AGENT_VENDORS: AgentVendorDef[] = [
  {
    id: "langgraph",
    name: "LangGraph",
    package: "langgraph",
    docsUrl: "https://langchain-ai.github.io/langgraph/",
    secretEnv: "LANGSMITH_API_KEY",
    runtime: "sdk",
    agentTypes: [
      {
        id: "react",
        label: "ReAct agent",
        description: "Tool-calling ReAct loop",
      },
      {
        id: "supervisor",
        label: "Supervisor multi-agent",
        description: "Supervisor routes to worker agents",
      },
      {
        id: "swarm",
        label: "Swarm / handoff",
        description: "Agents hand off to each other",
      },
      {
        id: "custom_graph",
        label: "Custom StateGraph",
        description: "Your compiled graph entrypoint",
      },
    ],
    fields: [
      {
        key: "remoteUrl",
        label: "LangGraph API / Cloud URL",
        kind: "text",
        placeholder: "https://…langgraph.app or http://localhost:8123",
        help: "Leave empty to run generated local code",
      },
      {
        key: "assistantId",
        label: "Assistant / graph id",
        kind: "text",
        placeholder: "agent",
      },
      {
        key: "threadId",
        label: "Thread id (optional)",
        kind: "text",
      },
    ],
  },
  {
    id: "langchain",
    name: "LangChain AgentExecutor",
    package: "langchain",
    docsUrl: "https://python.langchain.com/docs/tutorials/agents/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "local",
    agentTypes: [
      { id: "tool_calling", label: "Tool-calling agent", description: "create_tool_calling_agent" },
      { id: "openai_tools", label: "OpenAI tools agent", description: "create_openai_tools_agent" },
      { id: "xml", label: "XML agent", description: "create_xml_agent" },
      { id: "self_ask", label: "Self-ask with search", description: "create_self_ask_with_search_agent" },
    ],
    fields: [],
  },
  {
    id: "crewai",
    name: "CrewAI",
    package: "crewai",
    docsUrl: "https://docs.crewai.com/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "sdk",
    agentTypes: [
      { id: "crew", label: "Crew (sequential)", description: "Process.sequential" },
      { id: "crew_hierarchical", label: "Crew (hierarchical)", description: "Process.hierarchical" },
      { id: "flow", label: "CrewAI Flow", description: "Event-driven flow" },
      { id: "single_agent", label: "Single agent + tools", description: "One agent task" },
    ],
    fields: [
      {
        key: "remoteUrl",
        label: "CrewAI Enterprise / API URL",
        kind: "text",
        placeholder: "https://…",
      },
      {
        key: "crewId",
        label: "Crew / deployment id",
        kind: "text",
      },
    ],
  },
  {
    id: "autogen",
    name: "AutoGen (AG2)",
    package: "autogen-agentchat",
    docsUrl: "https://microsoft.github.io/autogen/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "local",
    agentTypes: [
      { id: "assistant_user", label: "Assistant + UserProxy", description: "Classic two-agent chat" },
      { id: "group_chat", label: "GroupChat", description: "Multi-agent group" },
      { id: "swarm", label: "Swarm", description: "Handoff swarm" },
      { id: "magentic", label: "Magentic-One", description: "Generalist multi-agent" },
    ],
    fields: [
      {
        key: "remoteUrl",
        label: "AutoGen Studio / API URL",
        kind: "text",
        placeholder: "http://localhost:8081",
      },
    ],
  },
  {
    id: "openai_assistants",
    name: "OpenAI Assistants / Responses",
    package: "openai",
    docsUrl: "https://platform.openai.com/docs/assistants/overview",
    secretEnv: "OPENAI_API_KEY",
    runtime: "remote_http",
    agentTypes: [
      { id: "assistant", label: "Assistants API", description: "Persistent assistant + threads" },
      { id: "responses", label: "Responses API agent", description: "Stateless agentic responses" },
      { id: "hosted_tools", label: "Hosted tools agent", description: "Code interpreter / file search" },
    ],
    fields: [
      {
        key: "assistantId",
        label: "Assistant id",
        kind: "text",
        required: true,
        placeholder: "asst_…",
      },
      {
        key: "threadId",
        label: "Thread id (optional)",
        kind: "text",
        placeholder: "thread_…",
      },
      {
        key: "baseUrl",
        label: "API base URL",
        kind: "text",
        placeholder: "https://api.openai.com/v1",
      },
    ],
  },
  {
    id: "azure_ai_agents",
    name: "Azure AI Agent Service",
    package: "azure-ai-projects",
    docsUrl: "https://learn.microsoft.com/azure/ai-services/agents/",
    secretEnv: "AZURE_AI_PROJECTS_CONNECTION_STRING",
    runtime: "remote_http",
    agentTypes: [
      { id: "azure_agent", label: "Azure hosted agent", description: "Project agent by id" },
      { id: "azure_connected", label: "Connected agent", description: "Multi-agent connected" },
    ],
    fields: [
      {
        key: "projectEndpoint",
        label: "Project endpoint",
        kind: "text",
        required: true,
        placeholder: "https://….services.ai.azure.com/api/projects/…",
      },
      {
        key: "agentName",
        label: "Agent name / id",
        kind: "text",
        required: true,
      },
    ],
  },
  {
    id: "semantic_kernel",
    name: "Semantic Kernel",
    package: "semantic-kernel",
    docsUrl: "https://learn.microsoft.com/semantic-kernel/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "local",
    agentTypes: [
      { id: "chat_agent", label: "ChatCompletionAgent", description: "SK chat agent" },
      { id: "group", label: "AgentGroupChat", description: "Multi-agent group chat" },
      { id: "process", label: "Process framework", description: "SK processes" },
    ],
    fields: [],
  },
  {
    id: "llamaindex",
    name: "LlamaIndex Workflows",
    package: "llama-index",
    docsUrl: "https://docs.llamaindex.ai/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "sdk",
    agentTypes: [
      { id: "function_agent", label: "FunctionAgent", description: "Tool-calling agent" },
      { id: "react", label: "ReActAgent", description: "ReAct over tools/indexes" },
      { id: "workflow", label: "Workflow", description: "Event-driven workflow" },
      { id: "multi_agent", label: "AgentWorkflow", description: "Multi-agent workflow" },
    ],
    fields: [
      {
        key: "remoteUrl",
        label: "LlamaDeploy / API URL",
        kind: "text",
      },
    ],
  },
  {
    id: "haystack",
    name: "Haystack Agents",
    package: "haystack-ai",
    docsUrl: "https://haystack.deepset.ai/",
    secretEnv: "OPENAI_API_KEY",
    runtime: "local",
    agentTypes: [
      { id: "agent", label: "Agent", description: "Haystack Agent component" },
      { id: "pipeline", label: "Agent pipeline", description: "Pipeline with Agent" },
    ],
    fields: [],
  },
  {
    id: "databricks_agents",
    name: "Databricks Agents",
    package: "databricks-agents",
    docsUrl: "https://docs.databricks.com/generative-ai/agent-framework/",
    secretEnv: "DATABRICKS_TOKEN",
    runtime: "remote_http",
    agentTypes: [
      { id: "agent_bricks", label: "Agent Bricks", description: "Managed agent endpoint" },
      { id: "mosaic_agent", label: "Mosaic AI Agent", description: "Deployed agent serving" },
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
        label: "Serving endpoint",
        kind: "text",
        required: true,
      },
    ],
  },
  {
    id: "aws_bedrock_agents",
    name: "AWS Bedrock Agents",
    package: "boto3",
    docsUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html",
    secretEnv: "AWS_ACCESS_KEY_ID",
    runtime: "remote_http",
    agentTypes: [
      { id: "bedrock_agent", label: "Bedrock Agent", description: "InvokeAgent" },
      { id: "bedrock_inline", label: "Inline agent", description: "Inline session agent" },
    ],
    fields: [
      {
        key: "region",
        label: "AWS region",
        kind: "text",
        required: true,
        defaultValue: "us-east-1",
      },
      {
        key: "agentId",
        label: "Bedrock agent id",
        kind: "text",
        required: true,
      },
      {
        key: "agentAliasId",
        label: "Agent alias id",
        kind: "text",
        required: true,
        placeholder: "TSTALIASID",
      },
    ],
  },
  {
    id: "google_adk",
    name: "Google ADK / Vertex AI Agents",
    package: "google-adk",
    docsUrl: "https://google.github.io/adk-docs/",
    secretEnv: "GOOGLE_API_KEY",
    runtime: "sdk",
    agentTypes: [
      { id: "llm_agent", label: "LlmAgent", description: "ADK LLM agent" },
      { id: "sequential", label: "SequentialAgent", description: "Pipeline of agents" },
      { id: "parallel", label: "ParallelAgent", description: "Fan-out agents" },
      { id: "loop", label: "LoopAgent", description: "Iterative agent" },
    ],
    fields: [
      {
        key: "project",
        label: "GCP project",
        kind: "text",
      },
      {
        key: "location",
        label: "Location",
        kind: "text",
        defaultValue: "us-central1",
      },
      {
        key: "remoteUrl",
        label: "Agent Engine / API URL",
        kind: "text",
      },
    ],
  },
  {
    id: "custom_remote",
    name: "Custom remote agent API",
    package: "requests",
    docsUrl: "https://docs.langchain.com/oss/python/integrations/providers/",
    secretEnv: "AGENT_API_KEY",
    runtime: "remote_http",
    agentTypes: [
      { id: "http_invoke", label: "HTTP invoke", description: "POST JSON → agent result" },
      { id: "webhook_callback", label: "Async + callback", description: "Fire-and-poll / webhook" },
    ],
    fields: [
      {
        key: "remoteUrl",
        label: "Remote agent URL",
        kind: "text",
        required: true,
        placeholder: "https://agents.example.com/v1/run",
      },
      {
        key: "httpMethod",
        label: "HTTP method",
        kind: "select",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
        ],
        defaultValue: "POST",
      },
      {
        key: "authHeader",
        label: "Auth header name",
        kind: "text",
        placeholder: "Authorization",
        defaultValue: "Authorization",
      },
    ],
  },
  {
    id: "local_code",
    name: "Local code agent (Studio)",
    package: "(embedded)",
    docsUrl: "https://vynelixai.com",
    secretEnv: "",
    runtime: "local",
    agentTypes: [
      { id: "python_loop", label: "Python agent loop", description: "run(stages, ctx) in Python" },
      { id: "javascript_loop", label: "JavaScript agent loop", description: "run(stages, ctx) in JS" },
    ],
    fields: [],
  },
];

export function getAgentVendor(id: string | undefined): AgentVendorDef | undefined {
  if (!id) return undefined;
  return AGENT_VENDORS.find((v) => v.id === id);
}

export function agentVendorOptions(): Array<{ value: string; label: string }> {
  return AGENT_VENDORS.map((v) => ({ value: v.id, label: v.name }));
}

export function agentTypesForVendor(
  vendorId: string | undefined,
): Array<{ value: string; label: string }> {
  const v = getAgentVendor(vendorId);
  if (!v) return [];
  return v.agentTypes.map((t) => ({
    value: t.id,
    label: `${t.label}`,
  }));
}

export function defaultAgentType(vendorId: string | undefined): string {
  return agentTypesForVendor(vendorId)[0]?.value ?? "react";
}
