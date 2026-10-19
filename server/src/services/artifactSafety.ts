import fs from "node:fs/promises";
import path from "node:path";

/** Read only regular artifacts resolved inside a run's canonical root; reject symlinks. */
export async function safeReadRunFile(runRoot: string, candidate: string): Promise<string> {
  const root = await fs.realpath(runRoot);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Run artifact path is outside the run directory");
  }

  const canonical = await fs.realpath(target);
  const canonicalRelative = path.relative(root, canonical);
  if (
    !canonicalRelative ||
    canonicalRelative === ".." ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new Error("Run artifact resolved outside the run directory");
  }

  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Run artifact is not a regular file");
  }
  return fs.readFile(target, "utf8");
}
