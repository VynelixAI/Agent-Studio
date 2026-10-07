import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessFlow } from "./flowReadiness.ts";
import type { WorkspaceDocument } from "../types/workspace.ts";

function doc(nodes: WorkspaceDocument["flow"]["nodes"]): WorkspaceDocument {
  return {
    workspace: { id: "ws", name: "Pipe", version: "1", mode: "workflow" },
    connectors: [{ id: "af", type: "airflow", label: "AF" }],
    tools: [],
    agents: [],
    flow: {
      triggers: [{ type: "manual" }],
      nodes,
      edges: [],
    },
  };
}

describe("flow readiness", () => {
  it("blocks a product node until a version is chosen", () => {
    const report = assessFlow(
      doc([
        {
          id: "af1",
          category: "control",
          type: "airflow.triggerDag",
          label: "Trigger",
          connector: "af",
          config: {},
        },
      ]),
    );
    assert.equal(report.verdict, "blocked");
    assert.equal(report.willRun, false);
    assert.ok(report.fixes.some((fix) => fix.config.productVersion === "3"));
  });

  it("marks the version token mandatory and host-style fields as good to have", () => {
    const report = assessFlow(
      doc([
        {
          id: "af1",
          category: "control",
          type: "airflow.triggerDag",
          label: "Trigger",
          connector: "af",
          config: { productVersion: "3", apiVersion: "3" },
        },
      ]),
    );
    const token = report.nodes[0]?.options.find((opt) => opt.key === "token");
    assert.equal(token?.rank, "mandatory");
    assert.equal(token?.status, "missing");
    assert.equal(report.verdict, "blocked");
  });
});
