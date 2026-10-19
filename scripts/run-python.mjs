import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-python.mjs <python args...>");
  process.exit(2);
}

const candidates = process.platform === "win32"
  ? [
      { command: "python", prefix: [] },
      { command: "py", prefix: ["-3"] },
    ]
  : [
      { command: "python3", prefix: [] },
      { command: "python", prefix: [] },
    ];

let selected;
for (const candidate of candidates) {
  const probe = spawnSync(candidate.command, [...candidate.prefix, "-c", "import sys; sys.exit(0)"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (!probe.error && probe.status === 0) {
    selected = candidate;
    break;
  }
}

if (!selected) {
  console.error("Python 3 was not found. Install Python 3.11+ and ensure python/python3 (or py -3 on Windows) is on PATH.");
  process.exit(1);
}

const result = spawnSync(selected.command, [...selected.prefix, ...args], {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(`Could not launch Python: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
