import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { safeReadRunFile } from "./artifactSafety.js";

const tempDirs: string[] = [];
after(async () => {
  await Promise.all(tempDirs.map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-artifact-test-"));
  tempDirs.push(directory);
  return directory;
}

describe("run artifact path safety", () => {
  it("reads regular files under the run root", async () => {
    const temp = await makeTempDir();
    const runRoot = path.join(temp, "run");
    const file = path.join(runRoot, "outputs", "result.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{\"ok\":true}", "utf8");
    assert.equal(await safeReadRunFile(runRoot, file), "{\"ok\":true}");
  });

  it("rejects files outside the run root", async () => {
    const temp = await makeTempDir();
    const runRoot = path.join(temp, "run");
    const outside = path.join(temp, "outside.txt");
    await fs.mkdir(runRoot);
    await fs.writeFile(outside, "private", "utf8");
    await assert.rejects(safeReadRunFile(runRoot, outside), /outside the run directory/i);
  });

  it("rejects symlinks that resolve outside the run root", async () => {
    const temp = await makeTempDir();
    const runRoot = path.join(temp, "run");
    const outside = path.join(temp, "outside.txt");
    const link = path.join(runRoot, "outputs", "leak.txt");
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.writeFile(outside, "do not read me", "utf8");
    await fs.symlink(outside, link);
    await assert.rejects(safeReadRunFile(runRoot, link), /resolved outside/i);
  });
});
