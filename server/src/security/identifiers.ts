/** Input validation helpers for identifiers used in database records and filesystem paths. */
export function assertSafeIdentifier(value: unknown, label = "identifier"): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) {
    throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400, code: "INVALID_IDENTIFIER" });
  }
  return value;
}

/** Validate secret references without restricting the supported `secret://` URI form. */
export function assertSafeSecretRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 180 ||
    !/^[A-Za-z0-9][A-Za-z0-9_:/.-]{0,179}$/.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  ) {
    throw Object.assign(new Error("Invalid secret reference"), {
      statusCode: 400,
      code: "INVALID_SECRET_REF",
    });
  }
  return value;
}

export function assertSafeFileName(value: unknown, label = "file name"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 180 ||
    value === "." ||
    value === ".." ||
    /[\\/\u0000-\u001f]/.test(value) ||
    value !== value.trim()
  ) {
    throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400, code: "INVALID_FILE_NAME" });
  }
  return value;
}

/** Minimal runtime validation for workflow documents arriving over the HTTP API. */
export function assertWorkspaceDocument(value: unknown): asserts value is import("../types.js").WorkspaceDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Workflow document must be an object"), { statusCode: 400, code: "INVALID_WORKFLOW" });
  }
  const document = value as Record<string, unknown>;
  const workspace = document.workspace;
  const flow = document.flow;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw Object.assign(new Error("Workflow document is missing workspace metadata"), { statusCode: 400, code: "INVALID_WORKFLOW" });
  }
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw Object.assign(new Error("Workflow document is missing flow data"), { statusCode: 400, code: "INVALID_WORKFLOW" });
  }
  const flowRecord = flow as Record<string, unknown>;
  if (!Array.isArray(flowRecord.nodes) || !Array.isArray(flowRecord.edges) || !Array.isArray(flowRecord.triggers)) {
    throw Object.assign(new Error("Workflow flow must contain nodes, edges, and triggers arrays"), { statusCode: 400, code: "INVALID_WORKFLOW" });
  }
  if (flowRecord.nodes.length > 5000 || flowRecord.edges.length > 20000) {
    throw Object.assign(new Error("Workflow exceeds the supported node or edge limit"), { statusCode: 413, code: "WORKFLOW_TOO_LARGE" });
  }
  for (const node of flowRecord.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw Object.assign(new Error("Every workflow node must be an object"), { statusCode: 400, code: "INVALID_WORKFLOW_NODE" });
    }
    const nodeRecord = node as Record<string, unknown>;
    assertSafeIdentifier(nodeRecord.id, "node id");
    if (typeof nodeRecord.type !== "string" || nodeRecord.type.trim().length === 0 || nodeRecord.type.length > 180) {
      throw Object.assign(new Error("Every workflow node must have a valid type"), { statusCode: 400, code: "INVALID_WORKFLOW_NODE" });
    }
  }
}
