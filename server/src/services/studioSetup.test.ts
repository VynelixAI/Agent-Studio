import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readStudioSetup, redactUri, saveStudioSetup } from "./studioSetup.js";

const dir = path.join(os.tmpdir(), `as-setup-${process.pid}`);

describe("studio setup", () => {
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes AGENT.md without the API key and keeps the key in a private file", async () => {
    const saved = await saveStudioSetup({
      workspacePath: dir,
      llmKind: "licensed",
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      mongoMode: "remote",
      databaseName: "studio",
      databaseUri: "mongodb://user:secretpass@db.example:27017",
    });
    assert.equal(saved.configured, true);
    assert.equal(saved.llm.apiKeySet, true);
    assert.equal(saved.database.uri.includes("secretpass"), false);
    const md = await fs.readFile(path.join(dir, "AGENT.md"), "utf8");
    assert.match(md, /# Agent Studio/);
    assert.match(md, /gpt-4o-mini/);
    assert.equal(md.includes("sk-test-secret"), false);
    assert.equal(md.includes("secretpass"), false);
    const secret = await fs.readFile(path.join(dir, ".studio-secret"), "utf8");
    assert.match(secret, /sk-test-secret/);
    const mode = (await fs.stat(path.join(dir, ".studio-secret"))).mode & 0o777;
    assert.equal(mode, 0o600);
    const again = await readStudioSetup(dir);
    assert.equal(again.configured, true);
    assert.equal(again.llm.model, "gpt-4o-mini");
  });

  it("redacts credentials in a mongo URI", () => {
    assert.equal(redactUri("mongodb://127.0.0.1:27017"), "mongodb://127.0.0.1:27017");
    assert.equal(redactUri("mongodb://a:b@host/db"), "mongodb://***@host/db");
  });
});
