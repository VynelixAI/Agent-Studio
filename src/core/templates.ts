import type { WorkspaceDocument } from "@/types/workspace";
import {
  deLakeNotebookCells,
} from "@/core/codeLabDefaults";
import { slimNotebookCells } from "@/core/notebookLibrary";

export function createEmptyWorkspace(name = "untitled-workflow"): WorkspaceDocument {
  const id = `ws_${crypto.randomUUID().slice(0, 8)}`;
  // Truly empty canvas / YAML — connectors stay in Conn library until added to this workflow
  return {
    workspace: {
      id,
      name,
      version: "0.1.0",
      mode: "workflow",
      description: "",
      updatedAt: new Date().toISOString(),
    },
    connectors: [],
    tools: [],
    agents: [],
    notebooks: [],
    flow: {
      triggers: [],
      nodes: [],
      edges: [],
      error_handlers: [],
    },
  };
}

/** CDC Mongo → transform → sink template */
export function mongoCdcTemplate(): WorkspaceDocument {
  return {
    workspace: {
      id: `ws_${crypto.randomUUID().slice(0, 8)}`,
      name: "mongo-cdc-pipeline",
      version: "1.0.0",
      mode: "workflow",
      description: "Change stream → transform → MongoDB sink",
      updatedAt: new Date().toISOString(),
    },
    connectors: [
      {
        id: "mongo_prod",
        type: "mongodb",
        mode: "atlas",
        label: "MongoDB Prod",
        secretRef: "secret://mongo_prod",
        config: { database: "ops" },
      },
    ],
    tools: [],
    agents: [],
    flow: {
      triggers: [{ type: "manual" }],
      nodes: [
        {
          id: "start",
          category: "trigger",
          type: "trigger.manual",
          label: "Manual Run",
          position: { x: 40, y: 200 },
        },
        {
          id: "cdc",
          category: "data",
          type: "mongodb.changestream",
          label: "Users CDC",
          connector: "mongo_prod",
          config: { collection: "users", fullDocument: "updateLookup" },
          outputs: ["stage.cdc"],
          position: { x: 260, y: 200 },
        },
        {
          id: "xform",
          category: "logic",
          type: "transform",
          label: "Normalize",
          inputs: ["stage.cdc"],
          outputs: ["stage.normalized"],
          config: { ops: ["map", "filter"] },
          position: { x: 500, y: 200 },
        },
        {
          id: "sink",
          category: "data",
          type: "mongodb.write",
          label: "Write 360",
          connector: "mongo_prod",
          inputs: ["stage.normalized"],
          config: { collection: "customer_360", mode: "upsert" },
          position: { x: 740, y: 200 },
        },
        {
          id: "audit",
          category: "communication",
          type: "log",
          label: "Audit",
          inputs: ["stage.normalized"],
          config: { event: "cdc.pipeline.complete" },
          position: { x: 980, y: 200 },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "cdc" },
        { id: "e2", source: "cdc", target: "xform" },
        { id: "e3", source: "xform", target: "sink" },
        { id: "e4", source: "sink", target: "audit" },
      ],
      error_handlers: [
        {
          id: "eh1",
          on: "sink",
          action: "retry",
          config: { maxAttempts: 3, backoffMs: 2000 },
        },
      ],
    },
  };
}

/** Enrichment with LLM */
export function enrichmentTemplate(): WorkspaceDocument {
  return {
    workspace: {
      id: `ws_${crypto.randomUUID().slice(0, 8)}`,
      name: "customer-enrichment",
      version: "1.0.0",
      mode: "workflow",
      description: "Mongo read → LLM enrich → write back",
      updatedAt: new Date().toISOString(),
    },
    connectors: [
      {
        id: "mongo_local",
        type: "mongodb",
        mode: "local",
        label: "Local Mongo",
        secretRef: "secret://mongo_local",
      },
    ],
    tools: [],
    agents: [],
    flow: {
      triggers: [{ type: "schedule", config: { cron: "0 */6 * * *" } }],
      nodes: [
        {
          id: "start",
          category: "trigger",
          type: "trigger.schedule",
          label: "Every 6h",
          position: { x: 40, y: 160 },
        },
        {
          id: "extract",
          category: "data",
          type: "mongodb.read",
          label: "Read Leads",
          connector: "mongo_local",
          config: { collection: "leads", filter: { enriched: { $ne: true } } },
          outputs: ["stage.leads"],
          position: { x: 260, y: 160 },
        },
        {
          id: "enrich",
          category: "ai",
          type: "llm",
          label: "Classify & Summarize",
          inputs: ["stage.leads"],
          outputs: ["stage.enriched"],
          config: {
            model: "gpt-4o-mini",
            prompt: "Classify industry and write a 1-line summary for each lead.",
            outputFormat: "json",
          },
          position: { x: 520, y: 160 },
        },
        {
          id: "branch",
          category: "control",
          type: "switch",
          label: "By Score",
          inputs: ["stage.enriched"],
          config: { field: "score", cases: ["high", "medium", "low"] },
          position: { x: 780, y: 160 },
        },
        {
          id: "write",
          category: "data",
          type: "mongodb.update",
          label: "Mark Enriched",
          connector: "mongo_local",
          inputs: ["stage.enriched"],
          config: { collection: "leads", upsert: false },
          position: { x: 1040, y: 80 },
        },
        {
          id: "notify",
          category: "communication",
          type: "notify.slack",
          label: "Slack High",
          config: { channel: "#sales-alerts" },
          position: { x: 1040, y: 260 },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "extract" },
        { id: "e2", source: "extract", target: "enrich" },
        { id: "e3", source: "enrich", target: "branch" },
        { id: "e4", source: "branch", target: "write", sourceHandle: "high", label: "high" },
        { id: "e5", source: "branch", target: "notify", sourceHandle: "high", label: "high" },
      ],
    },
  };
}

/** RAG ingest stub */
export function ragIngestTemplate(): WorkspaceDocument {
  return {
    workspace: {
      id: `ws_${crypto.randomUUID().slice(0, 8)}`,
      name: "rag-ingest",
      version: "1.0.0",
      mode: "workflow",
      description: "Files → embed → store vectors",
      updatedAt: new Date().toISOString(),
    },
    connectors: [],
    tools: [],
    agents: [],
    flow: {
      triggers: [{ type: "manual" }],
      nodes: [
        {
          id: "start",
          category: "trigger",
          type: "trigger.manual",
          label: "Manual Run",
          position: { x: 40, y: 180 },
        },
        {
          id: "files",
          category: "data",
          type: "file.source",
          label: "Load Docs",
          config: { glob: "docs/**/*.md" },
          outputs: ["stage.docs"],
          position: { x: 260, y: 180 },
        },
        {
          id: "embed",
          category: "ai",
          type: "embedding",
          label: "Embed Chunks",
          inputs: ["stage.docs"],
          outputs: ["stage.vectors"],
          config: { model: "text-embedding-3-small", chunkSize: 512 },
          position: { x: 500, y: 180 },
        },
        {
          id: "store",
          category: "data",
          type: "mongodb.write",
          label: "Store Vectors",
          connector: "mongo_prod",
          inputs: ["stage.vectors"],
          config: { collection: "embeddings" },
          position: { x: 740, y: 180 },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "files" },
        { id: "e2", source: "files", target: "embed" },
        { id: "e3", source: "embed", target: "store" },
      ],
    },
  };
}

/** DE demo: MongoDB extract → notebook cleanup → S3 lake publish */
export function mongoNotebookS3Template(): WorkspaceDocument {
  const notebookId = "nb_de_cleanup";
  const cells = slimNotebookCells(deLakeNotebookCells());
  return {
    workspace: {
      id: `ws_${crypto.randomUUID().slice(0, 8)}`,
      name: "de-mongo-notebook-s3",
      version: "1.0.0",
      mode: "workflow",
      description:
        "Data engineering demo — read from MongoDB, clean in a notebook/code step, publish to S3",
      updatedAt: new Date().toISOString(),
    },
    connectors: [
      {
        id: "mongodb",
        type: "mongodb",
        mode: "local",
        label: "MongoDB (ops)",
        secretRef: "secret://mongodb",
        config: { database: "ops" },
        pluginId: "mongodb",
      },
      {
        id: "s3",
        type: "s3",
        label: "S3 lake",
        secretRef: "secret://s3",
        config: {
          region: "us-east-1",
          bucket: "de-demo-lake",
          prefix: "orders/",
        },
        pluginId: "s3",
      },
    ],
    tools: [],
    agents: [],
    notebooks: [
      {
        id: notebookId,
        name: "DE orders cleanup",
        description: "Mongo → cleanup → lake preview cells",
        cells,
        updatedAt: new Date().toISOString(),
      },
    ],
    flow: {
      triggers: [{ type: "manual" }],
      nodes: [
        {
          id: "start",
          category: "trigger",
          type: "trigger.manual",
          label: "Manual Run",
          position: { x: 40, y: 200 },
        },
        {
          id: "mongo_read",
          category: "data",
          type: "mongodb.read",
          label: "Read Orders (Mongo)",
          connector: "mongodb",
          config: {
            collection: "orders",
            limit: 500,
            filter: "{}",
            outputFormat: "json",
          },
          outputs: ["stage.mongo_orders"],
          position: { x: 260, y: 200 },
        },
        {
          id: "nb_cleanup",
          category: "logic",
          type: "notebook",
          label: "Notebook cleanup",
          inputs: ["stage.mongo_orders"],
          outputs: ["stage.cleanup"],
          config: {
            outputFormat: "json",
            notebookSource: "saved",
            notebookId,
          },
          position: { x: 520, y: 200 },
        },
        {
          id: "s3_write",
          category: "data",
          type: "s3.write",
          label: "Publish to S3",
          connector: "s3",
          inputs: ["stage.cleanup"],
          outputs: ["stage.s3_receipt"],
          config: {
            bucket: "de-demo-lake",
            key: "orders/dt={{YYYY-MM-DD}}/orders_clean.json",
            contentType: "application/json",
            outputFormat: "yaml",
          },
          position: { x: 780, y: 200 },
        },
        {
          id: "log_done",
          category: "communication",
          type: "log",
          label: "Audit publish",
          inputs: ["stage.s3_receipt"],
          config: {
            event: "de.lake.publish.ok",
            level: "info",
            outputFormat: "json",
          },
          position: { x: 1020, y: 200 },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "mongo_read" },
        { id: "e2", source: "mongo_read", target: "nb_cleanup" },
        { id: "e3", source: "nb_cleanup", target: "s3_write" },
        { id: "e4", source: "s3_write", target: "log_done" },
      ],
      error_handlers: [],
    },
  };
}

/** Chat Start → LLM (session memory) → Chat Reply */
export function chatbotTemplate(): WorkspaceDocument {
  const id = `ws_${crypto.randomUUID().slice(0, 8)}`;
  return {
    workspace: {
      id,
      name: "llm-chatbot",
      version: "1.0.0",
      mode: "workflow",
      description: "Chat Start → LLM with memory → Chat Reply (Flowise-style chatbot)",
      updatedAt: new Date().toISOString(),
    },
    connectors: [],
    tools: [],
    agents: [],
    notebooks: [],
    flow: {
      triggers: [{ type: "chat" }],
      nodes: [
        {
          id: "start",
          category: "trigger",
          type: "trigger.chat",
          label: "Chat Start",
          outputs: ["stage.start"],
          config: {
            systemHint: "You are a concise assistant for this workflow.",
            parseIntent: false,
            outputFormat: "json",
          },
          position: { x: 80, y: 180 },
        },
        {
          id: "llm_1",
          category: "ai",
          type: "llm",
          label: "Assistant",
          inputs: ["stage.start"],
          outputs: ["stage.llm_1"],
          config: {
            provider: "openai",
            model: "gpt-4o-mini",
            secretRef: "secret://openai",
            systemPrompt: "You are a helpful assistant. Use conversation memory.",
            userPrompt: "{{query}}",
            memoryType: "window",
            memoryWindow: 10,
            temperature: 1,
            maxTokens: 2048,
            enableDynamicCode: false,
            outputFormat: "json",
          },
          position: { x: 340, y: 180 },
        },
        {
          id: "reply",
          category: "ai",
          type: "chat.reply",
          label: "Chat Reply",
          inputs: ["stage.llm_1"],
          outputs: ["stage.reply"],
          config: { replyField: "summary", outputFormat: "json" },
          position: { x: 620, y: 180 },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "llm_1" },
        { id: "e2", source: "llm_1", target: "reply" },
      ],
      error_handlers: [],
    },
  };
}

export const TEMPLATES = [
  {
    id: "llm-chatbot",
    name: "LLM Chatbot",
    description:
      "Chat Start → LLM (window memory) → Chat Reply. Open the Chat panel to talk to the flow.",
    factory: chatbotTemplate,
  },
  {
    id: "de-mongo-s3",
    name: "Mongo → Notebook → S3",
    description:
      "DE demo: extract from MongoDB, clean in notebook/code, publish JSON to S3 lake",
    factory: mongoNotebookS3Template,
  },
  {
    id: "mongo-cdc",
    name: "Mongo CDC Pipeline",
    description: "Change stream → transform → sink with audit",
    factory: mongoCdcTemplate,
  },
  {
    id: "enrichment",
    name: "LLM Enrichment",
    description: "Read leads → classify → branch → write / notify",
    factory: enrichmentTemplate,
  },
  {
    id: "rag-ingest",
    name: "RAG Ingest",
    description: "Files → embeddings → MongoDB vector store",
    factory: ragIngestTemplate,
  },
] as const;
