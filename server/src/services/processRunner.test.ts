import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProcess } from "./processRunner.js";

describe("bounded process runner", () => {
  it("captures output and preserves the exit code", async () => {
    const result = await runProcess(process.execPath, ["-e", "console.log('ready')"], {
      cwd: process.cwd(), timeoutMs: 5000,
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ready/);
    assert.equal(result.timedOut, false);
  });

  it("returns a non-zero result when a child exits unsuccessfully", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.exit(7)"], {
      cwd: process.cwd(), timeoutMs: 5000,
    });
    assert.equal(result.code, 7);
  });

  it("times out a process instead of waiting forever", async () => {
    const result = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(), timeoutMs: 100,
    });
    assert.equal(result.code, 124);
    assert.equal(result.timedOut, true);
    assert.match(result.stderr, /timed out/i);
  });

  it("does not pass backend secrets into child processes by default", async () => {
    const key = "AGENT_STUDIO_TEST_SECRET";
    const previous = process.env[key];
    const previousList = process.env.RUNNER_ENV_ALLOWLIST;
    process.env[key] = "must-not-leak";
    delete process.env.RUNNER_ENV_ALLOWLIST;
    try {
      const result = await runProcess(process.execPath, ["-e", `process.stdout.write(process.env.${key} ?? "missing")`], {
        cwd: process.cwd(), timeoutMs: 5000,
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "missing");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      if (previousList === undefined) delete process.env.RUNNER_ENV_ALLOWLIST;
      else process.env.RUNNER_ENV_ALLOWLIST = previousList;
    }
  });

  it("supports explicitly allow-listed connector environment variables", async () => {
    const key = "AGENT_STUDIO_TEST_TOKEN";
    const previousValue = process.env[key];
    const previousList = process.env.RUNNER_ENV_ALLOWLIST;
    process.env[key] = "operator-approved-value";
    process.env.RUNNER_ENV_ALLOWLIST = key;
    try {
      const result = await runProcess(process.execPath, ["-e", `process.stdout.write(process.env.${key} ?? "missing")`], {
        cwd: process.cwd(), timeoutMs: 5000,
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "operator-approved-value");
    } finally {
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
      if (previousList === undefined) delete process.env.RUNNER_ENV_ALLOWLIST;
      else process.env.RUNNER_ENV_ALLOWLIST = previousList;
    }
  });

  it("never allow-lists core backend credentials", async () => {
    const key = "SECRETS_KEY";
    const previousValue = process.env[key];
    const previousList = process.env.RUNNER_ENV_ALLOWLIST;
    process.env[key] = "backend-encryption-key";
    process.env.RUNNER_ENV_ALLOWLIST = key;
    try {
      const result = await runProcess(process.execPath, ["-e", `process.stdout.write(process.env.${key} ?? "missing")`], {
        cwd: process.cwd(), timeoutMs: 5000,
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "missing");
    } finally {
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
      if (previousList === undefined) delete process.env.RUNNER_ENV_ALLOWLIST;
      else process.env.RUNNER_ENV_ALLOWLIST = previousList;
    }
  });

  it("caps captured output to prevent unbounded memory growth", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], {
      cwd: process.cwd(), timeoutMs: 5000, maxStdoutChars: 256,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.length, 256);
  });
});
