import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNodeOutputDocs } from "./runService.js";

describe("buildNodeOutputDocs", () => {
  it("promotes LLM summary/model/provider for MongoDB Compass", () => {
    const docs = buildNodeOutputDocs({
      runId: "run_1",
      workspaceId: "ws_1",
      createdAt: "2026-09-15T00:00:00.000Z",
      files: [
        {
          path: "/tmp/outputs/llm_2.json",
          content: JSON.stringify({
            nodeId: "llm_2",
            name: "LLM",
            type: "llm",
            generatedAt: "2026-09-15T00:00:01.000Z",
            result: {
              summary: "React is a UI library.",
              model: "gpt-5",
              provider: "openai",
            },
          }),
        },
      ],
    });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].nodeId, "llm_2");
    assert.equal(docs[0].summary, "React is a UI library.");
    assert.equal(docs[0].model, "gpt-5");
    assert.equal(docs[0].provider, "openai");
  });

  it("promotes DB/pipeline json, rowCount, op, live, text for Compass", () => {
    const docs = buildNodeOutputDocs({
      runId: "run_2",
      workspaceId: "ws_1",
      createdAt: "2026-09-17T00:00:00.000Z",
      files: [
        {
          path: "/tmp/outputs/airflow_list.json",
          content: JSON.stringify({
            nodeId: "airflow_1",
            name: "List DAGs",
            type: "airflow.listDags",
            generatedAt: "2026-09-17T00:00:01.000Z",
            rowCount: 2,
            op: "airflow.listDags",
            live: true,
            json: { dag_id: "etl_daily", is_paused: false },
            text: "etl_daily",
            result: {
              kind: "tabular",
              rowCount: 2,
              op: "airflow.listDags",
              live: true,
              json: { dag_id: "etl_daily", is_paused: false },
              text: "etl_daily",
              summary: "etl_daily",
              items: [{ json: { dag_id: "etl_daily" } }],
            },
          }),
        },
      ],
    });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].nodeId, "airflow_1");
    assert.equal(docs[0].rowCount, 2);
    assert.equal(docs[0].op, "airflow.listDags");
    assert.equal(docs[0].live, true);
    assert.equal((docs[0].json as { dag_id: string }).dag_id, "etl_daily");
    assert.equal(docs[0].text, "etl_daily");
    assert.equal(docs[0].summary, "etl_daily");
  });
});

