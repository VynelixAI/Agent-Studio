import { MongoClient, type Db, type Collection } from "mongodb";
import { config } from "./config.js";
import type { AuditEvent } from "./security/types.js";
import type {
  ChatSession,
  RunNodeOutput,
  RunRecord,
  SecretRecord,
  WorkspaceRecord,
  WorkspaceVersionRecord,
} from "./types.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db(config.mongoDb);

  await Promise.all([
    workspaces().createIndex({ workspaceId: 1 }, { unique: true }),
    versions().createIndex({ workspaceId: 1, version: 1 }, { unique: true }),
    secrets().createIndex({ workspaceId: 1, secretRef: 1 }, { unique: true }),
    runs().createIndex({ workspaceId: 1, startedAt: -1 }),
    runs().createIndex({ runId: 1 }, { unique: true }),
    runs().createIndex({ startedAt: 1 }),
    runOutputs().createIndex({ runId: 1, nodeId: 1 }),
    runOutputs().createIndex({ workspaceId: 1, createdAt: -1 }),
    chatSessions().createIndex({ sessionId: 1 }, { unique: true }),
    chatSessions().createIndex({ workspaceId: 1, updatedAt: -1 }),
    auditLogs().createIndex({ ts: -1 }),
    auditLogs().createIndex({ resourceId: 1, ts: -1 }),
    auditLogs().createIndex({ action: 1, ts: -1 }),
  ]);

  return db;
}

export function workspaces(): Collection<WorkspaceRecord> {
  if (!db) throw new Error("DB not connected");
  return db.collection<WorkspaceRecord>("workspaces");
}

export function versions(): Collection<WorkspaceVersionRecord> {
  if (!db) throw new Error("DB not connected");
  return db.collection<WorkspaceVersionRecord>("workspace_versions");
}

export function secrets(): Collection<SecretRecord> {
  if (!db) throw new Error("DB not connected");
  return db.collection<SecretRecord>("secrets");
}

export function runs(): Collection<RunRecord> {
  if (!db) throw new Error("DB not connected");
  return db.collection<RunRecord>("runs");
}

export function runOutputs(): Collection<RunNodeOutput> {
  if (!db) throw new Error("DB not connected");
  return db.collection<RunNodeOutput>("run_outputs");
}

export function chatSessions(): Collection<ChatSession> {
  if (!db) throw new Error("DB not connected");
  return db.collection<ChatSession>("chat_sessions");
}

export function auditLogs(): Collection<AuditEvent> {
  if (!db) throw new Error("DB not connected");
  return db.collection<AuditEvent>("audit_logs");
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
