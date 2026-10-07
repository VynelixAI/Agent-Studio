import { nanoid } from "nanoid";
import { chatSessions } from "../db.js";
import type { ChatMessage, ChatSession, RunRecord } from "../types.js";
import { readRunOutputs, startRun } from "./runService.js";
import type { WorkspaceDocument } from "../types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const rec = asRecord(value);
  if (!rec) return "";
  for (const key of ["reply", "summary", "content", "text", "output"]) {
    const inner = rec[key];
    if (typeof inner === "string" && inner.trim()) return inner.trim();
    const nested = textFromUnknown(inner);
    if (nested) return nested;
  }
  return "";
}

/** Pick the assistant utterance from a finished run (chat.reply → llm → agent). */
export function extractChatReply(run: RunRecord, files?: Array<{ path: string; content: string }>): string {
  const fromArtifacts = [...(run.artifacts?.nodeOutputs ?? [])].reverse();
  const prefer = (types: string[]) => {
    for (const type of types) {
      for (const doc of fromArtifacts) {
        const rec = asRecord(doc.result);
        const nodeType = String(doc.nodeType ?? rec?.op ?? rec?.type ?? "");
        if (type === "chat.reply" && (nodeType === "chat.reply" || doc.nodeId.includes("reply"))) {
          const text = textFromUnknown(doc.result) || textFromUnknown(doc.summary);
          if (text) return text;
        }
        if (type === "llm" && (nodeType === "llm" || doc.nodeId.includes("llm"))) {
          const text = textFromUnknown(doc.summary) || textFromUnknown(doc.result);
          if (text) return text;
        }
        if (type === "agent" && (nodeType === "agent" || doc.nodeId.includes("agent"))) {
          const text = textFromUnknown(doc.summary) || textFromUnknown(doc.result);
          if (text) return text;
        }
      }
    }
    return "";
  };
  const fromTyped = prefer(["chat.reply", "llm", "agent"]);
  if (fromTyped) return fromTyped;
  for (const doc of fromArtifacts) {
    const text = textFromUnknown(doc.summary) || textFromUnknown(doc.result);
    if (text) return text;
  }
  for (const file of files ?? []) {
    try {
      const parsed = JSON.parse(file.content) as unknown;
      const rec = asRecord(parsed);
      const text =
        textFromUnknown(rec?.result) ||
        (typeof rec?.summary === "string" ? rec.summary : "");
      if (text) return text;
    } catch {
      /* skip */
    }
  }
  return run.error?.trim() || "";
}

export async function getChatSession(
  workspaceId: string,
  sessionId: string,
): Promise<ChatSession | null> {
  return chatSessions().findOne({ workspaceId, sessionId }, { projection: { _id: 0 } });
}

export async function listChatSessions(workspaceId: string): Promise<ChatSession[]> {
  return chatSessions()
    .find({ workspaceId }, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
}

export async function deleteChatSession(workspaceId: string, sessionId: string): Promise<boolean> {
  const res = await chatSessions().deleteOne({ workspaceId, sessionId });
  return (res.deletedCount ?? 0) > 0;
}

export async function sendChatMessage(input: {
  workspaceId: string;
  message: string;
  sessionId?: string;
  document?: WorkspaceDocument;
  yaml?: string;
  secrets?: Array<{ secretRef: string; value: string }>;
}): Promise<{ session: ChatSession; run: RunRecord; reply: string }> {
  const question = input.message.trim();
  if (!question) {
    throw Object.assign(new Error("message is required"), { statusCode: 400 });
  }
  const now = new Date().toISOString();
  const sessionId = input.sessionId?.trim() || `chat_${nanoid(10)}`;
  const existing = await chatSessions().findOne(
    { sessionId, workspaceId: input.workspaceId },
    { projection: { _id: 0 } },
  );
  let session: ChatSession = existing
    ? {
        sessionId: existing.sessionId,
        workspaceId: existing.workspaceId,
        title: existing.title,
        messages: existing.messages ?? [],
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        sessionId,
        workspaceId: input.workspaceId,
        title: question.slice(0, 80),
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
  if (!existing) {
    await chatSessions().insertOne({ ...session });
  }

  const userMsg: ChatMessage = { role: "user", content: question, ts: now };
  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));

  const run = await startRun({
    workspaceId: input.workspaceId,
    mode: "execute",
    runtime: "python",
    document: input.document,
    yaml: input.yaml,
    secrets: input.secrets,
    chat: { sessionId, question, history },
  });

  let files: Array<{ path: string; content: string }> = [];
  try {
    files = (await readRunOutputs(run.runId)).files;
  } catch {
    files = [];
  }
  const reply =
    extractChatReply(run, files) ||
    (run.status === "failed"
      ? run.error || "The workflow run failed."
      : "The flow finished without a Chat Reply or LLM summary.");

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: reply,
    ts: new Date().toISOString(),
    runId: run.runId,
  };
  const messages = [...session.messages, userMsg, assistantMsg];
  const updated: ChatSession = {
    ...session,
    messages,
    title: session.title || question.slice(0, 80),
    updatedAt: assistantMsg.ts,
  };
  await chatSessions().updateOne(
    { sessionId, workspaceId: input.workspaceId },
    { $set: { messages, title: updated.title, updatedAt: updated.updatedAt } },
  );
  return { session: updated, run, reply };
}
