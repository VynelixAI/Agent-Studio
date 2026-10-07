/**
 * Prepare API files for Tauri bundle resources.
 * Copies compiled server (or TS sources + package.json) into src-tauri/resources/server.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const outDir = path.join(root, "src-tauri", "resources", "server");

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".env") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

console.log("Building server TypeScript…");
execSync("npm run build", { cwd: serverDir, stdio: "inherit" });

rimraf(outDir);
fs.mkdirSync(outDir, { recursive: true });
copyDir(path.join(serverDir, "dist"), path.join(outDir, "dist"));
fs.copyFileSync(
  path.join(serverDir, "package.json"),
  path.join(outDir, "package.json"),
);

// Install production deps next to bundled dist so Node can run index.js
console.log("Installing production deps into resources/server…");
execSync("npm install --omit=dev", { cwd: outDir, stdio: "inherit" });

// Ensure example config exists
const example = path.join(
  root,
  "src-tauri",
  "resources",
  "agent-studio.yaml.example",
);
if (!fs.existsSync(example)) {
  console.warn("Missing agent-studio.yaml.example");
}

console.log("Desktop resources ready →", outDir);
