import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyProductVersion, productForNodeType } from "./productVersions.ts";

describe("product versions", () => {
  it("matches node types to a product", () => {
    assert.equal(productForNodeType("airflow.triggerDag")?.id, "airflow");
    assert.equal(productForNodeType("llm")?.persona, "ai-eng");
    assert.equal(productForNodeType("if"), undefined);
  });

  it("fills version options and drops the previous version's extras", () => {
    const profile = productForNodeType("airflow.triggerDag");
    assert.ok(profile);
    const v3 = applyProductVersion({}, profile, "3");
    assert.equal(v3.productVersion, "3");
    assert.equal(v3.apiVersion, "3");
    const v2 = applyProductVersion({ ...v3, token: "jwt", dagId: "etl" }, profile, "2");
    assert.equal(v2.apiVersion, "2");
    assert.equal(v2.token, undefined);
    assert.equal(v2.dagId, "etl");
    assert.equal("username" in v2 || v2.username === undefined, true);
  });
});
