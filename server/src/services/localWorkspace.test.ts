import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkspaceDocument } from "../types.js";
import {
  MAX_EXECUTIONS,
  listExecutions,
  publicBrain,
  readLog,
  readMemory,
  recordWorkspaceRun,
  setLocalWorkspacesRootForTests,
  workspaceDir,
  writeBrain,
} from "./localWorkspace.js";

const root = path.join(os.tmpdir(), `as-local-ws-${process.pid}`);

function doc(ids: string[]): WorkspaceDocument {
  return {
    workspace: {
      id: "ws_memtest",
      name: "mem",
      version: "0.1.0",
      mode: "workflow",
    },
    connectors: [],
    tools: [],
    agents: [],
    flow: {
      triggers: [],
      nodes: ids.map((id) => ({ id, type: "transform", label: id })),
      edges: ids.length > 1 ? [{ id: "e1", source: ids[0], target: ids[1] }] : [],
    },
  };
}

describe("local workspace memory", () => {
  before(async () => {
    await fs.rm(root, { recursive: true, force: true });
    setLocalWorkspacesRootForTests(root);
  });

  after(async () => {
    setLocalWorkspacesRootForTests(null);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects path escape in the workspace id", () => {
    assert.throws(() => workspaceDir("../etc"), /Invalid workspace id/);
    assert.throws(() => workspaceDir("ws/secret"), /Invalid workspace id/);
  });

  it("stores node input and output and writes the matching log", async () => {
    const when = "2026-10-01T12:00:00.000Z";
    await recordWorkspaceRun({
      workspaceId: "ws_memtest",
      runId: "run_ok",
      status: "succeeded",
      startedAt: when,
      finishedAt: when,
      document: doc(["extract", "load"]),
      nodeOutputs: [
        {
          runId: "run_ok",
          workspaceId: "ws_memtest",
          nodeId: "extract",
          nodeType: "transform",
          path: "outputs/extract.json",
          result: { rows: [1] },
          json: { rows: [1] },
          content: { rows: [1] },
          createdAt: when,
        },
      ],
    });
    const memory = await readMemory("ws_memtest");
    assert.equal(memory.nodes.extract.status, "success");
    assert.deepEqual(memory.nodes.extract.output, { rows: [1] });
    assert.equal(memory.nodes.load.status, "skipped");
    const input = memory.nodes.load.input as Array<{ from: string }>;
    assert.equal(input[0].from, "extract");
    const ok = await readLog("ws_memtest", "success");
    assert.ok(ok.lines.some((l) => l.includes("run_ok") && l.includes("succeeded")));
    const bad = await readLog("ws_memtest", "failure");
    assert.equal(bad.lines.length, 0);
  });

  it("keeps only the last 5 executions", async () => {
    for (let i = 0; i < 6; i += 1) {
      await recordWorkspaceRun({
        workspaceId: "ws_memtest",
        runId: `run_${i}`,
        status: i === 3 ? "failed" : "succeeded",
        startedAt: `2026-10-01T12:0${i}:00.000Z`,
        finishedAt: `2026-10-01T12:0${i}:01.000Z`,
        error: i === 3 ? "boom" : undefined,
        document: doc(["extract"]),
        nodeOutputs: [],
      });
    }
    const items = await listExecutions("ws_memtest");
    assert.equal(items.length, MAX_EXECUTIONS);
    assert.ok(!items.some((e) => e.runId === "run_ok"));
    const names = await fs.readdir(path.join(root, "ws_memtest", "executions"));
    assert.equal(names.filter((n) => n.startsWith("exec_")).length, MAX_EXECUTIONS);
    const fail = await readLog("ws_memtest", "failure", "boom");
    assert.equal(fail.lines.length, 1);
  });

  it("masks the brain API key", async () => {
    const saved = await writeBrain("ws_memtest", {
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
    });
    assert.equal(saved.apiKey, "sk-test-secret");
    const pub = publicBrain(saved);
    assert.equal(pub.apiKeySet, true);
    assert.equal(JSON.stringify(pub).includes("sk-test-secret"), false);
    const mode = (await fs.stat(path.join(root, "ws_memtest", "brain.json"))).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});
