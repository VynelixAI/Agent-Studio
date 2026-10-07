import Dexie, { type EntityTable } from "dexie";
import type { WorkspaceDocument } from "@/types/workspace";
import { isWorkspaceCacheSkipped } from "@/lib/workspaceCacheGate";

export interface CachedWorkspace {
  id: string;
  name: string;
  updatedAt: string;
  document: WorkspaceDocument;
  yaml: string;
}

export interface CachedStage {
  id: string; // workspaceId::key
  workspaceId: string;
  key: string;
  nodeId: string;
  preview: unknown;
  rowCount?: number;
  updatedAt: string;
}

class StudioCacheDB extends Dexie {
  workspaces!: EntityTable<CachedWorkspace, "id">;
  stages!: EntityTable<CachedStage, "id">;

  constructor() {
    super("vynelix_agent_studio");
    this.version(1).stores({
      workspaces: "id, name, updatedAt",
      stages: "id, workspaceId, key, updatedAt",
    });
  }
}

export const cacheDb = new StudioCacheDB();

export async function saveWorkspaceCache(
  document: WorkspaceDocument,
  yaml: string,
): Promise<void> {
  // Re-check at write time so an in-flight put cannot resurrect a deleted workspace
  if (isWorkspaceCacheSkipped(document.workspace.id)) return;
  await cacheDb.workspaces.put({
    id: document.workspace.id,
    name: document.workspace.name,
    updatedAt: new Date().toISOString(),
    document,
    yaml,
  });
}

export async function listCachedWorkspaces(): Promise<CachedWorkspace[]> {
  return cacheDb.workspaces.orderBy("updatedAt").reverse().toArray();
}

export async function loadCachedWorkspace(
  id: string,
): Promise<CachedWorkspace | undefined> {
  return cacheDb.workspaces.get(id);
}

export async function deleteCachedWorkspace(id: string): Promise<void> {
  await cacheDb.workspaces.delete(id);
  await cacheDb.stages.where("workspaceId").equals(id).delete();
}
