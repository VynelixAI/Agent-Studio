import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config, securityConfigErrors } from "./config.js";

describe("server deployment security configuration", () => {
  it("rejects network exposure when workflow execution is not sandboxed", () => {
    const old = {
      apiHost: config.apiHost,
      runnerSandbox: config.runnerSandbox,
      nodeEnv: config.nodeEnv,
      desktopApp: config.desktopApp,
      authRequired: config.authRequired,
      apiKeysRaw: config.apiKeysRaw,
      secretsKey: config.secretsKey,
      corsOrigin: config.corsOrigin,
    };
    try {
      config.apiHost = "0.0.0.0";
      config.runnerSandbox = "local";
      config.nodeEnv = "production";
      config.desktopApp = false;
      config.authRequired = true;
      config.apiKeysRaw = "test-key-0123456789-0123456789-0123456789:admin";
      config.secretsKey = "0123456789abcdef".repeat(4);
      config.corsOrigin = "https://studio.example.com";
      assert.ok(securityConfigErrors().some((error) => error.includes("RUNNER_SANDBOX=docker")));
      config.runnerSandbox = "docker";
      assert.ok(!securityConfigErrors().some((error) => error.includes("unsandboxed workflow execution")));
    } finally {
      Object.assign(config, old);
    }
  });

  it("requires production mode for network-exposed APIs", () => {
    const old = {
      apiHost: config.apiHost,
      runnerSandbox: config.runnerSandbox,
      nodeEnv: config.nodeEnv,
      desktopApp: config.desktopApp,
      authRequired: config.authRequired,
      apiKeysRaw: config.apiKeysRaw,
      secretsKey: config.secretsKey,
      corsOrigin: config.corsOrigin,
    };
    try {
      config.apiHost = "0.0.0.0";
      config.runnerSandbox = "docker";
      config.nodeEnv = "development";
      config.desktopApp = false;
      config.authRequired = true;
      config.apiKeysRaw = "random-key-0123456789-abcdefghijklmnopqrstuvwxyz:admin";
      config.secretsKey = "0123456789abcdef".repeat(4);
      config.corsOrigin = "https://studio.example.com";
      assert.ok(securityConfigErrors().some((error) => error.includes("NODE_ENV=production")));
    } finally {
      Object.assign(config, old);
    }
  });

  it("rejects a predictable encryption key in production", () => {
    const old = {
      nodeEnv: config.nodeEnv,
      desktopApp: config.desktopApp,
      secretsKey: config.secretsKey,
    };
    try {
      config.nodeEnv = "production";
      config.desktopApp = false;
      config.secretsKey = "a".repeat(64);
      assert.ok(securityConfigErrors().some((error) => error.includes("SECRETS_KEY")));
    } finally {
      Object.assign(config, old);
    }
  });

  it("requires configured API keys when authentication is enabled", () => {
    const oldKeys = config.apiKeysRaw;
    const oldAuth = config.authRequired;
    try {
      config.authRequired = true;
      config.apiKeysRaw = "";
      assert.ok(securityConfigErrors().some((error) => error.includes("API_KEYS")));
      config.apiKeysRaw = "too-short:admin";
      assert.ok(securityConfigErrors().some((error) => error.includes("at least 32 characters")));
      config.apiKeysRaw = `${"a".repeat(64)}:admin`;
      assert.ok(securityConfigErrors().some((error) => error.includes("at least 32 characters")));
    } finally {
      config.apiKeysRaw = oldKeys;
      config.authRequired = oldAuth;
    }
  });
});
