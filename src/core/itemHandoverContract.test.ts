import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BIND_ID_KEYS,
  FAMILY_BIND_ALIASES,
  ITEM_LIST_KEYS,
  NESTED_ENVELOPE_KEYS,
  PAYLOAD_SHAPE_KEYS,
  emitHandoverConstantsPy,
} from "./itemHandoverContract.ts";

describe("item handover contract", () => {
  it("defines dual aliases for Airflow, Spark, and Prefect", () => {
    assert.deepEqual([...FAMILY_BIND_ALIASES.airflow.dag], ["dag_id", "dagId"]);
    assert.deepEqual([...FAMILY_BIND_ALIASES.airflow.dagRun], ["dag_run_id", "dagRunId"]);
    assert.deepEqual([...FAMILY_BIND_ALIASES.spark.app], ["appId", "applicationId"]);
    assert.ok(FAMILY_BIND_ALIASES.prefect.flowRun.includes("flow_run_id"));
    assert.ok(FAMILY_BIND_ALIASES.prefect.flowRun.includes("flowRunId"));
  });

  it("lists bind ids used by flat $json preference", () => {
    for (const key of [
      "dag_id",
      "dagId",
      "dag_run_id",
      "dagRunId",
      "appId",
      "applicationId",
      "flow_run_id",
      "flowRunId",
    ]) {
      assert.ok((BIND_ID_KEYS as readonly string[]).includes(key), key);
    }
  });

  it("emits Python constants containing every bind id and list key", () => {
    const py = emitHandoverConstantsPy();
    assert.match(py, /_BIND_ID_KEYS/);
    assert.match(py, /_ITEM_LIST_KEYS/);
    for (const key of BIND_ID_KEYS) {
      assert.match(py, new RegExp(JSON.stringify(key)));
    }
    assert.ok(ITEM_LIST_KEYS.includes("dags"));
    assert.ok(ITEM_LIST_KEYS.includes("deployments"));
    assert.ok(NESTED_ENVELOPE_KEYS.includes("flow_run"));
    assert.ok(NESTED_ENVELOPE_KEYS.includes("dagRun"));
    for (const key of PAYLOAD_SHAPE_KEYS) {
      assert.ok(typeof key === "string" && key.length > 0);
    }
  });
});
