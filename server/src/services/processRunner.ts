import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface ProcessRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxStdoutChars?: number;
  maxStderrChars?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const INHERITED_ENV_KEYS = [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "VIRTUAL_ENV", "CONDA_PREFIX",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
];
const NEVER_PASS_ENV_KEYS = new Set([
  "API_KEYS", "SECRETS_KEY", "MONGODB_URI", "MONGODB_DB",
  "AUTH_REQUIRED", "JWT_SECRET", "DATABASE_URL",
]);
const SENSITIVE_ENV_NAME = /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|DATABASE_URL|JWT)/i;

/**
 * Pass only essential OS settings to workflow child processes. Application credentials
 * are excluded by default; an operator may opt in specific connector variables via
 * RUNNER_ENV_ALLOWLIST. Core API/database/encryption settings can never be allow-listed.
 */
export function getRunnerEnvAllowlist(): string[] {
  return (process.env.RUNNER_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !NEVER_PASS_ENV_KEYS.has(key.toUpperCase()));
}

function buildChildEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }

  const allowlisted = getRunnerEnvAllowlist();
  for (const key of allowlisted) {
    if (NEVER_PASS_ENV_KEYS.has(key.toUpperCase())) continue;
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || NEVER_PASS_ENV_KEYS.has(key.toUpperCase()) || SENSITIVE_ENV_NAME.test(key)) continue;
    result[key] = value;
  }
  return result;
}

function appendBounded(current: string, chunk: Buffer | string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return (current + chunk.toString()).slice(-maxChars);
}

function terminateProcessTree(child: import("node:child_process").ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    // `child.kill` stops the immediate child; taskkill also terminates its descendants.
    try { child.kill(signal); } catch { /* already exited */ }
    if (signal === "SIGKILL") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => undefined);
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}

/** Run a child process with bounded output capture and a hard timeout. */
export function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  return new Promise((resolve) => {
    const timeoutInput = options.timeoutMs ?? Number(process.env.RUN_COMMAND_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutInput) && timeoutInput > 0
      ? Math.min(timeoutInput, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    const maxStdoutChars = Math.max(0, options.maxStdoutChars ?? 1_000_000);
    const maxStderrChars = Math.max(0, options.maxStderrChars ?? 64_000);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: buildChildEnvironment(options.env),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // A dedicated process group lets timeouts stop descendants on Unix as well.
      detached: process.platform !== "win32",
    });

    let timer: NodeJS.Timeout;
    const finish = (result: ProcessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk, maxStdoutChars);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk, maxStderrChars);
    });

    timer = setTimeout(() => {
      timedOut = true;
      stderr = appendBounded(stderr, `\n[Agent Studio] Process timed out after ${timeoutMs} ms.`, maxStderrChars);
      terminateProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        // Kill the process group even if its leader exited: descendants can survive it.
        terminateProcessTree(child, "SIGKILL");
      }, 2_000);
      killTimer.unref?.();
    }, timeoutMs);

    child.once("close", (code) => finish({
      code: timedOut ? 124 : code,
      stdout,
      stderr,
      timedOut,
    }));
    child.once("error", (error) => finish({
      code: 1,
      stdout,
      stderr: appendBounded(stderr, `\n${error.message}`, maxStderrChars),
      timedOut,
    }));
  });
}

/** Resolve the repository-managed Python virtual environment on each platform. */
export async function resolvePythonExecutable(serverRoot: string): Promise<string> {
  const candidates = process.platform === "win32"
    ? [
        `${serverRoot}\\.venv\\Scripts\\python.exe`,
      ]
    : [`${serverRoot}/.venv/bin/python`];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the platform fallback below.
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
