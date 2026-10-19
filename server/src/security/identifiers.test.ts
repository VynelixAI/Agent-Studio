import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeFileName, assertSafeIdentifier, assertSafeSecretRef, assertWorkspaceDocument } from "./identifiers.js";

describe("API identifier validation", () => {
  it("accepts stable IDs used by workspace and node records", () => {
    assert.equal(assertSafeIdentifier("ws_customer_1", "workspace id"), "ws_customer_1");
    assert.equal(assertSafeIdentifier("mongo-read-2", "node id"), "mongo-read-2");
  });

  it("rejects path separators, parent traversal, and missing identifiers", () => {
    for (const value of ["../secret", "ws/secret", "", "..", "a".repeat(81), null]) {
      assert.throws(() => assertSafeIdentifier(value), /Invalid identifier/);
    }
  });

  it("rejects unsafe attachment names", () => {
    assert.equal(assertSafeFileName("customers.csv"), "customers.csv");
    assert.throws(() => assertSafeFileName("../customers.csv"), /Invalid file name/);
    assert.throws(() => assertSafeFileName("folder/customers.csv"), /Invalid file name/);
  });

  it("validates workflow structure and node IDs before processing", () => {
    assertWorkspaceDocument({
      workspace: { id: "ws_1", name: "Demo", version: "0.1.0", mode: "workflow" },
      connectors: [], tools: [], agents: [],
      flow: { triggers: [], nodes: [{ id: "node_1", type: "transform" }], edges: [] },
    });
    assert.throws(() => assertWorkspaceDocument({ workspace: {}, flow: { nodes: [{ id: "../x", type: "python" }], edges: [], triggers: [] } }), /Invalid node id/);
  });
});


describe("secret reference validation", () => {
  it("accepts Agent Studio secret URIs", () => {
    assert.equal(assertSafeSecretRef("secret://mongo_prod"), "secret://mongo_prod");
  });

  it("rejects prototype-sensitive and control-character keys", () => {
    assert.throws(() => assertSafeSecretRef("__proto__"), /Invalid secret reference/);
    assert.throws(() => assertSafeSecretRef("secret://a\nadmin"), /Invalid secret reference/);
  });
});
