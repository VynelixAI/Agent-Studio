import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateNodeClass,
  generateWorkflowNotebook,
  generateWorkflowPython,
  pythonClassName,
} from "./nodeReferenceCode.ts";
import type { WorkspaceDocument } from "../types/workspace.ts";

function doc(nodes: WorkspaceDocument["flow"]["nodes"], edges: WorkspaceDocument["flow"]["edges"] = []): WorkspaceDocument {
  return {
    workspace: { id: "ws_demo", name: "Demo flow", version: "1", mode: "workflow" },
    connectors: [{ id: "mongo_1", type: "mongodb", secretRef: "secret://mongo" }],
    tools: [],
    agents: [],
    flow: { triggers: [], nodes, edges },
  };
}

describe("workflow reference codegen", () => {
  it("emits n8n execute classes instead of JSON dumps", () => {
    const py = generateWorkflowPython(
      doc(
        [
          {
            id: "trig",
            type: "trigger.manual",
            category: "trigger",
            label: "Start",
            outputs: ["stage.trig"],
            config: {},
          },
          {
            id: "mongo_read",
            type: "mongodb.read",
            category: "data",
            label: "Read users",
            connector: "mongo_1",
            inputs: ["stage.trig"],
            outputs: ["stage.users"],
            config: { collection: "users", filter: { status: "active" } },
          },
          {
            id: "llm_1",
            type: "llm",
            category: "ai",
            label: "Summarize",
            inputs: ["stage.users"],
            outputs: ["stage.summary"],
            config: { provider: "openai", model: "gpt-4o-mini" },
          },
        ],
        [
          { id: "e1", source: "trig", target: "mongo_read" },
          { id: "e2", source: "mongo_read", target: "llm_1" },
        ],
      ),
    );
    assert.match(py, /class Node_mongo_read/);
    assert.match(py, /def execute\(self, items, ctx\)/);
    assert.match(py, /MongoClient/);
    assert.match(py, /"collection": "users"/);
    assert.doesNotMatch(py, /workflow_nodes.append\(json.loads/);
    assert.match(py, /def run_workflow/);
    assert.match(py, /items_from_rows/);
  });

  it("builds one notebook cell pair per node", () => {
    const cells = generateWorkflowNotebook(
      doc([
        {
          id: "rest_1",
          type: "rest",
          category: "data",
          label: "HTTP",
          outputs: ["stage.http"],
          config: { url: "https://example.com/api", method: "GET" },
        },
      ]),
    );
    assert.ok(cells.some((c) => c.id === "workflow-overview" && c.cell_type === "markdown"));
    assert.ok(cells.some((c) => c.id === "workflow-node:rest_1" && c.source.includes("class Node_rest_1")));
    assert.match(cells.find((c) => c.id === "workflow-node:rest_1")?.source ?? "", /urllib.request/);
  });

  it("pythonClassName sanitizes ids", () => {
    assert.equal(
      pythonClassName({ id: "clickhouse.query_1", type: "clickhouse.query", category: "data" }),
      "Node_clickhouse_query_1",
    );
    const src = generateNodeClass({
      id: "if_1",
      type: "if",
      category: "control",
      config: { condition: "item.status == 'ok'" },
    });
    assert.match(src, /class Node_if_1/);
    assert.match(src, /eval\(condition/);
  });

  it("emits per-operation Spark and Airflow execute (n8n items, not orchestrator stubs)", () => {
    const sparkSql = generateNodeClass({
      id: "spark_sql_1",
      type: "spark.sql",
      category: "data",
      connector: "spark_1",
      config: { sql: "SELECT 1 AS ok" },
    });
    assert.match(sparkSql, /from pyspark.sql import SparkSession/);
    assert.match(sparkSql, /spark\.sql/);
    assert.match(sparkSql, /SELECT 1 AS ok/);
    assert.match(sparkSql, /items_from_rows/);
    assert.match(sparkSql, /def _run\(self, \*\*kwargs\)/);
    assert.match(sparkSql, /def tool_spec\(self\)/);
    assert.match(sparkSql, /def __call__\(self/);
    assert.doesNotMatch(sparkSql, /\[reference\] Spark/);

    const sparkSubmit = generateNodeClass({
      id: "spark_sub_1",
      type: "spark.submit",
      category: "data",
      connector: "spark_1",
      config: { appResource: "jobs/etl.py" },
    });
    assert.match(sparkSubmit, /spark-submit/);
    assert.match(sparkSubmit, /appResource/);
    assert.match(sparkSubmit, /jobs\/etl\.py/);
    assert.match(sparkSubmit, /"appId": app_id/);
    assert.match(sparkSubmit, /applicationId/);

    const sparkStatus = generateNodeClass({
      id: "spark_st_1",
      type: "spark.jobStatus",
      category: "data",
      connector: "spark_1",
      config: {},
    });
    assert.match(sparkStatus, /row\.get\("appId"\)/);
    assert.match(sparkStatus, /v1\/submissions\/status/);

    const listDags = generateNodeClass({
      id: "af_list_1",
      type: "airflow.listDags",
      category: "data",
      connector: "airflow_1",
      config: { limit: 50, onlyActive: true },
    });
    assert.match(listDags, /\/dags/);
    assert.match(listDags, /items_from_rows/);
    assert.match(listDags, /only_active/);
    assert.doesNotMatch(listDags, /status": "reference"/);
    assert.doesNotMatch(listDags, /orchestrator op=/);

    const trigger = generateNodeClass({
      id: "af_trig_1",
      type: "airflow.triggerDag",
      category: "data",
      connector: "airflow_1",
      config: { dagId: "etl_daily" },
    });
    assert.match(trigger, /\/dags\/\{dag_id\}\/dagRuns/);
    assert.match(trigger, /etl_daily/);
    assert.match(trigger, /DESCRIPTION/);
    assert.match(trigger, /"dag_run_id"/);
    assert.match(trigger, /"dagId": dag_id/);

    const dagStatus = generateNodeClass({
      id: "af_st_1",
      type: "airflow.dagStatus",
      category: "data",
      connector: "airflow_1",
      config: {},
    });
    assert.match(dagStatus, /row\.get\("dag_run_id"\)/);
    assert.match(dagStatus, /dagRuns\/\{run_id\}/);

    const pfTrigger = generateNodeClass({
      id: "pf_trig_1",
      type: "prefect.triggerDeployment",
      category: "data",
      connector: "prefect_1",
      config: { deploymentName: "etl" },
    });
    assert.match(pfTrigger, /create_flow_run/);
    assert.match(pfTrigger, /"flow_run_id": fr_id/);
    assert.match(pfTrigger, /"flowRunId": fr_id/);

    const pfStatus = generateNodeClass({
      id: "pf_st_1",
      type: "prefect.runStatus",
      category: "data",
      connector: "prefect_1",
      config: {},
    });
    assert.match(pfStatus, /row\.get\("flow_run_id"\)/);
    assert.match(pfStatus, /flow_runs\/\{flow_run_id\}/);
  });
});
