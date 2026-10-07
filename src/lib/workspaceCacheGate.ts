/** Shared gate so IndexedDB cannot resurrect a workspace after delete. */

const skippedCacheIds = new Set<string>();
const skippedCacheTimers = new Map<string, number>();

export function skipWorkspaceCache(id: string, ms = 60_000) {
  skippedCacheIds.add(id);
  const prev = skippedCacheTimers.get(id);
  if (prev) window.clearTimeout(prev);
  const t = window.setTimeout(() => {
    skippedCacheIds.delete(id);
    skippedCacheTimers.delete(id);
  }, ms);
  skippedCacheTimers.set(id, t);
}

export function isWorkspaceCacheSkipped(id: string): boolean {
  return skippedCacheIds.has(id);
}
