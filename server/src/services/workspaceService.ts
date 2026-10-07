import { nanoid } from "nanoid";
import { runs, secrets, versions, workspaces } from "../db.js";
import { encryptSecret } from "../crypto.js";
import type {
  AttachmentMeta,
  WorkspaceDocument,
  WorkspaceRecord,
  WorkspaceVersionRecord,
} from "../types.js";

function bumpVersion(current: string, mode: "override" | "new_version"): string {
  const parts = current.split(".").map((p) => Number(p));
  while (parts.length < 3) parts.push(0);
  if (mode === "override") {
    // patch bump on override to keep audit trail of saves
    parts[2] = (parts[2] || 0) + 1;
  } else {
    parts[1] = (parts[1] || 0) + 1;
    parts[2] = 0;
  }
  return parts.join(".");
}

export async function listWorkspaces(): Promise<
  Array<Pick<WorkspaceRecord, "workspaceId" | "name" | "currentVersion" | "updatedAt">>
> {
  return workspaces()
    .find(
      {},
      {
        projection: {
          workspaceId: 1,
          name: 1,
          currentVersion: 1,
          updatedAt: 1,
          _id: 0,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .toArray();
}

export async function getWorkspace(
  workspaceId: string,
): Promise<WorkspaceRecord | null> {
  return workspaces().findOne({ workspaceId }, { projection: { _id: 0 } });
}

export async function listVersions(
  workspaceId: string,
): Promise<WorkspaceVersionRecord[]> {
  return versions()
    .find({ workspaceId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
}

async function upsertSecrets(
  workspaceId: string,
  secretPayloads: Array<{ secretRef: string; value: string; label?: string }>,
) {
  const now = new Date().toISOString();
  for (const s of secretPayloads) {
    const enc = encryptSecret(s.value);
    await secrets().updateOne(
      { workspaceId, secretRef: s.secretRef },
      {
        $set: {
          workspaceId,
          secretRef: s.secretRef,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          label: s.label,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }
}

export async function createWorkspace(input: {
  document: WorkspaceDocument;
  yaml: string;
  secrets?: Array<{ secretRef: string; value: string; label?: string }>;
  attachments?: AttachmentMeta[];
  privacy?: WorkspaceRecord["privacy"];
}): Promise<WorkspaceRecord> {
  const now = new Date().toISOString();
  const workspaceId = input.document.workspace.id || `ws_${nanoid(8)}`;
  const version = input.document.workspace.version || "0.1.0";

  const existing = await getWorkspace(workspaceId);
  if (existing) {
    throw Object.assign(new Error("Workspace already exists"), {
      statusCode: 409,
      code: "WORKSPACE_EXISTS",
    });
  }

  const document: WorkspaceDocument = {
    ...input.document,
    workspace: {
      ...input.document.workspace,
      id: workspaceId,
      version,
      updatedAt: now,
    },
  };

  const record: WorkspaceRecord = {
    workspaceId,
    name: document.workspace.name,
    currentVersion: version,
    document,
    yaml: input.yaml,
    attachments: input.attachments ?? [],
    privacy: input.privacy,
    createdAt: now,
    updatedAt: now,
  };

  await workspaces().insertOne({ ...record });
  await versions().insertOne({
    workspaceId,
    version,
    document,
    yaml: input.yaml,
    attachments: record.attachments,
    createdAt: now,
    source: "create",
    note: "Initial create",
  });

  if (input.secrets?.length) {
    await upsertSecrets(workspaceId, input.secrets);
  }

  return record;
}

export async function applyWorkspace(input: {
  workspaceId: string;
  mode: "override" | "new_version";
  document: WorkspaceDocument;
  yaml: string;
  secrets?: Array<{ secretRef: string; value: string; label?: string }>;
  attachments?: AttachmentMeta[];
  note?: string;
  privacy?: WorkspaceRecord["privacy"];
}): Promise<{ record: WorkspaceRecord; previousVersion: string | null }> {
  const now = new Date().toISOString();
  const existing = await getWorkspace(input.workspaceId);

  if (!existing) {
    const created = await createWorkspace({
      document: {
        ...input.document,
        workspace: { ...input.document.workspace, id: input.workspaceId },
      },
      yaml: input.yaml,
      secrets: input.secrets,
      attachments: input.attachments,
      privacy: input.privacy,
    });
    return { record: created, previousVersion: null };
  }

  const previousVersion = existing.currentVersion;
  const nextVersion =
    input.mode === "new_version"
      ? bumpVersion(previousVersion, "new_version")
      : bumpVersion(previousVersion, "override");

  const document: WorkspaceDocument = {
    ...input.document,
    workspace: {
      ...input.document.workspace,
      id: input.workspaceId,
      version: nextVersion,
      updatedAt: now,
    },
  };

  const attachments = input.attachments ?? existing.attachments;
  const privacy = input.privacy ?? existing.privacy;

  await workspaces().updateOne(
    { workspaceId: input.workspaceId },
    {
      $set: {
        name: document.workspace.name,
        currentVersion: nextVersion,
        document,
        yaml: input.yaml,
        attachments,
        privacy,
        updatedAt: now,
      },
    },
  );

  await versions().insertOne({
    workspaceId: input.workspaceId,
    version: nextVersion,
    document,
    yaml: input.yaml,
    attachments,
    createdAt: now,
    source: input.mode,
    note:
      input.note ??
      (input.mode === "override"
        ? `Override of ${previousVersion}`
        : `New version from ${previousVersion}`),
  });

  if (input.secrets?.length) {
    await upsertSecrets(input.workspaceId, input.secrets);
  }

  const record = (await getWorkspace(input.workspaceId))!;
  return { record, previousVersion };
}

/** Permanently remove a workspace and related Mongo records (versions, secrets, runs). */
export async function deleteWorkspace(workspaceId: string): Promise<{
  ok: true;
  deleted: {
    workspace: number;
    versions: number;
    secrets: number;
    runs: number;
  };
}> {
  const existing = await getWorkspace(workspaceId);
  if (!existing) {
    throw Object.assign(new Error("Workspace not found"), { statusCode: 404 });
  }

  const [wsRes, verRes, secRes, runRes] = await Promise.all([
    workspaces().deleteOne({ workspaceId }),
    versions().deleteMany({ workspaceId }),
    secrets().deleteMany({ workspaceId }),
    runs().deleteMany({ workspaceId }),
  ]);

  return {
    ok: true,
    deleted: {
      workspace: wsRes.deletedCount ?? 0,
      versions: verRes.deletedCount ?? 0,
      secrets: secRes.deletedCount ?? 0,
      runs: runRes.deletedCount ?? 0,
    },
  };
}
