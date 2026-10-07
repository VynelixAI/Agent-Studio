/**
 * Contract + generator tests for structured DB outputs / stage datasets.
 * Run: npx tsx --test src/codegen/structuredDataset.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPythonRunner } from "./pythonRunner.js";
import { buildStageDatasetPy } from "./stageDatasetPy.js";
import { buildStudioConnectorsPy } from "./studioConnectorsPy.js";
import { buildTasksFile } from "./tasksYaml.js";
import { buildReferenceNodePy, buildWorkflowReferencePy } from "./workflowReference.js";
import {
  BIND_ID_KEYS,
  emitHandoverConstantsPy,
} from "./itemHandoverContract.js";

describe("workflowReference materialize files", () => {
  it("writes an n8n-style class per node", () => {
    const py = buildReferenceNodePy({
      id: "ch_q",
      type: "clickhouse.query",
      category: "data",
      label: "Query ticks",
      outputs: ["stage.ch"],
      config: { sql: "SELECT 1 AS ok" },
    });
    assert.match(py, /class Node_ch_q/);
    assert.match(py, /def execute\(self, items, ctx\)/);
    assert.match(py, /def _run\(self, \*\*kwargs\)/);
  });

  it("emits Spark submit with appId and Airflow listDags as items", () => {
    const spark = buildReferenceNodePy({
      id: "spk_sub",
      type: "spark.submit",
      config: { appResource: "jobs/etl.py" },
    });
    assert.match(spark, /spark-submit/);
    assert.match(spark, /appId/);
    assert.match(spark, /_spark_parse_app_id/);
    assert.doesNotMatch(spark, /Canvas Run uses handle_spark/);

    const af = buildReferenceNodePy({
      id: "af_list",
      type: "airflow.listDags",
      config: { limit: 25 },
    });
    assert.match(af, /\/dags/);
    assert.match(af, /items_from_rows/);
    assert.doesNotMatch(af, /Canvas Run uses handle_airflow/);

    const trigger = buildReferenceNodePy({
      id: "af_trig",
      type: "airflow.triggerDag",
      config: { dagId: "etl_daily" },
    });
    assert.match(trigger, /dag_run_id/);
    assert.match(trigger, /dagId/);

    const pf = buildReferenceNodePy({
      id: "pf_trig",
      type: "prefect.triggerDeployment",
      config: { deploymentId: "dep-1" },
    });
    assert.match(pf, /create_flow_run/);
    assert.match(pf, /flow_run_id/);
    assert.match(pf, /flowRunId/);
  });

  it("embeds shared item handover contract constants in the runner", () => {
    const runner = buildPythonRunner();
    const constants = emitHandoverConstantsPy();
    assert.match(runner, /_BIND_ID_KEYS/);
    assert.match(runner, /_ITEM_LIST_KEYS/);
    assert.match(runner, /_flat_bind_row/);
    assert.match(runner, /_prefect_flat_flow_run/);
    for (const key of BIND_ID_KEYS) {
      assert.match(constants, new RegExp(JSON.stringify(key)));
      assert.match(runner, new RegExp(JSON.stringify(key)));
    }
  });

  it("builds a workflow_reference module with NODES map", () => {
    const py = buildWorkflowReferencePy({
      workspace: { id: "ws", name: "Demo", version: "1", mode: "workflow" },
      connectors: [],
      tools: [],
      agents: [],
      flow: {
        triggers: [],
        nodes: [
          {
            id: "t1",
            type: "trigger.manual",
            category: "trigger",
            outputs: ["stage.t1"],
            config: {},
          },
        ],
        edges: [],
      },
    });
    assert.match(py, /NODES =/);
    assert.match(py, /Node_t1/);
  });
});

describe("stage_dataset.py contract", () => {
  const py = buildStageDatasetPy();

  it("defines INLINE_MAX spill thresholds (not a default read cap)", () => {
    assert.match(py, /INLINE_MAX_ROWS\s*=\s*5_000/);
    assert.match(py, /INLINE_MAX_BYTES/);
    assert.doesNotMatch(py, /DEFAULT_LIMIT\s*=\s*100/);
  });

  it("optional_limit returns None when unset", () => {
    assert.match(py, /def optional_limit/);
    assert.match(py, /if "limit" not in cfg:\n\s+return None/);
  });

  it("materialize_tabular builds schema.columns + rows and spills", () => {
    assert.match(py, /def materialize_tabular/);
    assert.match(py, /"kind": "tabular"/);
    assert.match(py, /"schema": \{"columns": columns\}/);
    assert.match(py, /storage = "parquet"/);
    assert.match(py, /storage = "jsonl"/);
  });
});

describe("python runner mongodb.read", () => {
  const runner = buildPythonRunner();

  it("imports stage_dataset helpers", () => {
    assert.match(runner, /from stage_dataset import/);
    assert.match(runner, /materialize_tabular/);
    assert.match(runner, /optional_limit/);
  });

  it("does not apply an implicit .limit(100) on collection reads", () => {
    assert.doesNotMatch(runner, /\.limit\(\s*100\s*\)/);
    assert.doesNotMatch(runner, /limit\s*=\s*100\b/);
    // optional limit only when lim is not None
    assert.match(runner, /if lim is not None:\n\s+cursor = cursor\.limit/);
  });

  it("applies filter then projection on find", () => {
    assert.match(
      runner,
      /coll\.find\(\s*filt if isinstance\(filt, dict\) else \{\},\s*projection if isinstance\(projection, dict\) else None,\s*\)/,
    );
  });

  it("records query.filter / query.projection / query.limit in query_meta", () => {
    assert.match(runner, /"filter": filt if isinstance\(filt, dict\) else \{\}/);
    assert.match(runner, /"projection": projection/);
    assert.match(runner, /"limit": lim/);
  });

  it("promotes schema + rows onto output artifacts", () => {
    assert.match(runner, /artifact\["schema"\] = payload\.get\("schema"\)/);
    assert.match(runner, /artifact\["rows"\] = payload\.get\("rows"\)/);
    assert.match(runner, /artifact\["query"\] = payload\.get\("query"\)/);
  });

  it("wires stage.load / stage.pass for handover", () => {
    assert.match(runner, /"stage\.load": handle_stage_load/);
    assert.match(runner, /"stage\.pass": handle_stage_load/);
  });

  it("wires AI / control helpers instead of a silent agent stub", () => {
    assert.match(runner, /def _control_handover/);
    assert.match(runner, /def _task_stage_keys/);
    assert.match(runner, /def _ensure_handover/);
    assert.match(runner, /def handle_sub_workflow/);
    assert.match(runner, /def handle_set_variables/);
    assert.match(runner, /def handle_chat_reply/);
    assert.match(runner, /def _chat_history/);
    assert.match(runner, /def _run_chat/);
    assert.match(runner, /def _eval_condition_llm/);
    assert.match(runner, /"chat.reply": handle_chat_reply/);
    assert.match(runner, /def _invoke_google_genai/);
    assert.match(runner, /def _fixed_temperature_model/);
    assert.match(runner, /def _configured_max_tokens/);
    assert.match(runner, /def _bind_upstream_row_fields/);
    assert.match(runner, /:generateContent/);
    assert.match(runner, /max_completion_tokens/);
    assert.doesNotMatch(
      runner,
      /"temperature": float\(cfg\.get\("temperature"\) or 0\)/,
    );
    assert.match(runner, /def _bind_task_inputs/);
    assert.doesNotMatch(runner, /local_stub/);
    assert.match(runner, /"rag": handle_rag/);
    assert.match(runner, /"embedding": handle_embedding/);
    assert.match(runner, /"tool": handle_tool/);
    assert.match(runner, /def _apply_sampling/);
    assert.match(runner, /def _make_llm_complete/);
    assert.match(runner, /def _agent_react_loop/);
    assert.match(runner, /def handle_embedding/);
    assert.match(runner, /def handle_tool/);
    assert.match(runner, /def _parse_chat_intent/);
    assert.match(runner, /def invoke_embeddings/);
    assert.match(runner, /def _cosine/);
    assert.match(runner, /response_format/);
    assert.match(runner, /top_p/);
    assert.match(runner, /llm_complete/);
    assert.match(runner, /agent_step/);
    assert.match(runner, /"rest": handle_rest/);
    assert.match(runner, /def handle_rest/);
    assert.match(runner, /def handle_file/);
    assert.match(runner, /def _apply_transform_ops/);
    assert.match(runner, /def execute_row_insert/);
    assert.match(runner, /def handle_de_plugin/);
    assert.match(runner, /def handle_redis/);
    assert.match(runner, /def handle_kafka/);
    assert.match(runner, /def _mongo_connect/);
    assert.match(runner, /def handle_mysql_cdc/);
    assert.match(runner, /def handle_duckdb_file/);
    assert.match(runner, /def handle_warehouse_copy/);
    assert.match(runner, /def _snowflake_connection/);
    assert.match(runner, /def _cassandra_session/);
    assert.match(runner, /databricks-sql-connector/);
    assert.match(runner, /mysql-replication is required/);
    assert.match(runner, /read_csv_auto/);
    assert.match(runner, /COPY INTO/);
    assert.match(runner, /_search/);
    assert.match(runner, /delete_records/);
    assert.doesNotMatch(runner, /fallback_sample/);
    assert.match(runner, /CREATE SCHEMA IF NOT EXISTS/);
    assert.match(runner, /MERGE INTO/);
    assert.match(runner, /CREATE OR REPLACE VIEW/);
    assert.match(runner, /Unsupported Prefect node type/);
    assert.match(runner, /workspaceOrError/);
    assert.match(runner, /disconnectedNodeAcknowledged/);
    assert.match(runner, /mode=cancel/);
    assert.match(runner, /docs", "generate"/);
    assert.match(runner, /temporalio is required/);
    assert.match(runner, /google-cloud-bigquery is required/);
    assert.match(runner, /add_or_update_expectation_suite/);
    assert.match(runner, /dbfs\/put/);
    assert.match(runner, /generate_signed_url/);
    assert.match(runner, /def _extract_item_rows/);
    assert.match(runner, /def _as_item_payload/);
    assert.match(runner, /def _attach_item_contract/);
    assert.match(runner, /def _collection_as_rows/);
    assert.match(runner, /payload\["items"\] = \[\{"json": r\} for r in clean\]/);
    assert.match(runner, /artifact\["items"\] = payload\.get\("items"\)/);
    assert.match(runner, /artifact\["json"\] = payload\.get\("json"\)/);
    assert.match(runner, /_as_item_payload\(payload, \{"op": t, "ok": True, "live": True\}\)/);
    assert.match(runner, /rows = normalize_rows\(_extract_item_rows\(extracted\)/);
  });
});

describe("n8n / Flowise stage handover", () => {
  const runner = buildPythonRunner();
  const stage = buildStageDatasetPy();

  it("binds canvas edges to stage.<sourceId> and always writes stage.<nodeId>", () => {
    assert.match(runner, /auto = f"stage\.\{nid\}"/);
    assert.match(runner, /auto = f"stage\.\{str\(src\.get\('id'\) or ''\)\.replace\('\.', '_'\)\}"/);
    assert.match(runner, /def _remember_handover/);
    assert.match(runner, /def _prepare_task/);
  });

  it("unpacks Airflow dags / Prefect deployments / ES hits into item rows", () => {
    assert.match(runner, /"dags"/);
    assert.match(runner, /"deployments"/);
    assert.match(runner, /"matched"/);
    assert.match(runner, /source = obj\.get\("_source"\)/);
    assert.match(stage, /def _row_dict/);
    assert.match(stage, /"dags", "deployments", "matched"/);
  });
});

describe("structured DB coverage", () => {
  const runner = buildPythonRunner();

  it("routes all structured DB families through handle_structured_db", () => {
    assert.match(runner, /def is_structured_db_task/);
    assert.match(runner, /def handle_structured_db/);
    assert.match(runner, /def handle_sqlish_read/);
    assert.match(runner, /clickhouse/);
    assert.match(
      runner,
      /if is_structured_db_task\(task_type\):\n\s+return handle_structured_db/,
    );
  });

  it("treats all clickhouse.* nodes as structured (not stub)", () => {
    // Prefix-based: any clickhouse.* must match is_structured_db_task
    assert.match(runner, /"clickhouse\."/);
    assert.doesNotMatch(
      runner,
      /"clickhouse\.query": handle_default/,
    );
  });

  it("builds ClickHouse HTTP URL with connector port", () => {
    assert.match(runner, /port = int\(cfg\.get\("port"\)/);
    assert.match(runner, /base = f"http:\/\/\{hs\}:\{port\}"/);
  });

  it("forces catalog SQL for listTables and keeps SELECT rows out of write path", () => {
    assert.match(runner, /def _catalog_sql_for_list/);
    assert.match(runner, /system\.tables/);
    assert.match(runner, /\.list" in t or t\.endswith\("\.schema"\)/);
    assert.match(
      runner,
      /head in \("SELECT", "SHOW", "DESCRIBE", "DESC", "WITH", "EXPLAIN"\)/,
    );
  });

  it("resolves SQL for every clickhouse.* node type", () => {
    assert.match(runner, /def _resolve_clickhouse_sql/);
    assert.match(runner, /def _flatten_node_config/);
    assert.match(runner, /\.insert/);
    assert.match(runner, /\.truncate/);
    assert.match(runner, /\.createtable/);
    assert.match(runner, /\.createdatabase/);
    assert.match(runner, /FORMAT JSONEachRow/);
    assert.match(runner, /ENGINE = MergeTree/);
  });

  it("emits columnar write artifacts via materialize_tabular", () => {
    assert.match(runner, /def handle_sqlish_write/);
    assert.match(
      runner,
      /dataset = materialize_tabular\(\n\s+rows=out_rows/,
    );
  });

  it("SQL path only applies LIMIT when explicit", () => {
    assert.match(runner, /def _apply_sql_limit/);
    assert.match(runner, /if lim is None:\n\s+return text/);
  });

  it("records filter + projection on SQL-ish reads", () => {
    assert.match(runner, /handle_sqlish_read/);
    assert.match(runner, /"projection": projection/);
  });

  it("registers handlers for all control-flow nodes", () => {
    for (const [type, fn] of [
      ["if", "handle_if"],
      ["switch", "handle_switch"],
      ["loop", "handle_loop"],
      ["parallel", "handle_parallel"],
      ["human_approval", "handle_human_approval"],
      ["wait", "handle_wait"],
      ["return", "handle_return"],
      ["error_handler", "handle_error_handler"],
    ] as const) {
      assert.match(runner, new RegExp(`def ${fn}\\(`));
      assert.match(runner, new RegExp(`"${type}": ${fn}`));
    }
    assert.match(runner, /NODE_SKIP/);
    assert.match(runner, /skip_ids/);
    // Stub path must call out stale API for control types (dev DX)
    assert.match(runner, /hit the stub handler/);
    assert.match(runner, /Restart the Agent Studio API/);
  });

  it("routes all airflow nodes through a dedicated REST handler", () => {
    assert.match(runner, /def handle_airflow\(/);
    assert.match(
      runner,
      /if task_type\.startswith\("airflow\."\):\n\s+return handle_airflow/,
    );
    for (const type of [
      "airflow.xcomPull",
      "airflow.xcomPush",
      "airflow.listDags",
      "airflow.importVariables",
      "airflow.triggerDag",
      "airflow.dagStatus",
      "airflow.pauseDag",
      "airflow.clearTask",
    ]) {
      assert.match(runner, new RegExp(type.replace(".", "\\.")));
    }
    assert.match(runner, /xcomEntries/);
    assert.match(runner, /variables/);
  });

  it("routes spark.* through dedicated handle_spark (not SQL driver stub)", () => {
    assert.match(runner, /def handle_spark/);
    assert.match(
      runner,
      /if task_type\.startswith\("spark\."\):\n\s+return handle_spark/,
    );
    assert.match(runner, /spark-submit/);
    assert.match(runner, /_spark_session/);
    const prefixBlock = runner.slice(
      runner.indexOf("STRUCTURED_DB_PREFIXES"),
      runner.indexOf("STRUCTURED_DB_QUERY_SUFFIXES"),
    );
    assert.equal(prefixBlock.includes('"spark."'), false);
    assert.match(runner, /def _airflow_flat_item/);
    assert.match(runner, /def _spark_parse_app_id/);
    assert.match(runner, /restUrl/);
    assert.match(runner, /"applicationId": app_id/);
  });
});

describe("studio_connectors.fetch_mongodb", () => {
  const py = buildStudioConnectorsPy();

  it("defaults to no limit (read all matching)", () => {
    assert.match(py, /limit: int \| None = None/);
    assert.match(py, /if limit is not None and int\(limit\) > 0:/);
    assert.doesNotMatch(py, /limit: int = 500/);
  });

  it("supports projection on find", () => {
    assert.match(py, /projection: dict \| None = None/);
    assert.match(py, /coll\.find\(filter or \{\}, projection if projection else None\)/);
  });
});

describe("tasks.yaml infers stage inputs from canvas edges", () => {
  it("copies source outputs onto the target when inputs are empty", () => {
    const tasks = buildTasksFile({
      document: {
        workspace: {
          id: "ws_test",
          name: "infer",
          version: "1",
          mode: "workflow",
        },
        connectors: [],
        tools: [],
        agents: [],
        flow: {
          triggers: [],
          nodes: [
            {
              id: "trig",
              type: "trigger.manual",
              category: "trigger",
              outputs: ["stage.trigger"],
              config: {},
            },
            {
              id: "loop1",
              type: "loop",
              category: "control",
              outputs: ["stage.loop"],
              config: {},
            },
          ],
          edges: [{ id: "e1", source: "trig", target: "loop1" }],
        },
      },
      runId: "run_1",
      secrets: {},
    });
    const loop = tasks.tasks.find((t) => t.id === "loop1");
    assert.deepEqual(loop?.inputs, ["stage.trigger"]);
    assert.ok(loop?.outputs?.includes("stage.loop1"));
  });
});
