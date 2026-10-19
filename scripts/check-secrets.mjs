#!/usr/bin/env node
/** High-confidence accidental-secret scan; CI also scans Git history with Gitleaks. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "target",
  ".next",
  ".vite",
  "__pycache__",
]);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".env",
  ".md",
  ".txt",
  ".py",
  ".rs",
  ".html",
  ".css",
  ".sh",
  ".ps1",
]);
const patterns = [
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key ID", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
];
const findings = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(?:pem|key|p12|pfx)$/i.test(entry.name)) {
      findings.push(`${relative}: possible private-key/certificate secret file`);
      continue;
    }
    const isEnvFile = entry.name === ".env" || entry.name.startsWith(".env.");
    if (!isEnvFile && !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name === ".env.example" || relative.endsWith("/.env.example")) continue;
    if (relative.includes("STANDARDIZATION_CHANGES")) continue;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > 2 * 1024 * 1024) continue;

    let contents;
    try {
      contents = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = contents.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const [label, pattern] of patterns) {
        if (
          pattern.test(lines[i]) &&
          !/(example|placeholder|your[_ -]?key|replace[_ -]?me|change[_ -]?me|dummy|redacted)/i.test(
            lines[i],
          )
        ) {
          findings.push(`${relative}:${i + 1}: possible ${label}`);
        }
      }
    }
  }
}

walk(root);
if (findings.length) {
  console.error("Potential hard-coded secrets found:");
  for (const finding of findings) console.error(`- ${finding}`);
  console.error("Review each finding manually; rotate any credential that was committed.");
  process.exit(1);
}

console.log("High-confidence secret scan passed for the working tree.");
console.log(
  "Note: use Gitleaks in CI to inspect committed history; this script only scans current files.",
);
