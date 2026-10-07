/**
 * Helpers for named notebooks (Notebook menu → selectable on canvas nodes).
 */

import type { NotebookCell } from "@/core/codeLabDefaults";
import type { SavedNotebook, SavedNotebookCell } from "@/types/workspace";

export function slimNotebookCells(
  cells: NotebookCell[] | SavedNotebookCell[],
): SavedNotebookCell[] {
  return cells.map((c) => ({
    id: c.id,
    cell_type: c.cell_type,
    source: c.source ?? "",
  }));
}

/** Linearize cells for the workflow notebook runner (# %% markers). */
export function cellsToNotebookSource(
  cells: Array<{ cell_type: string; source: string }>,
): string {
  return cells
    .map((c) => {
      const body = (c.source ?? "").replace(/\r\n/g, "\n").trimEnd();
      if (c.cell_type === "markdown") {
        return `# %% markdown\n${body}\n`;
      }
      return `# %%\n${body}\n`;
    })
    .join("\n");
}

export function newSavedNotebookId(): string {
  return `nb_${crypto.randomUUID().slice(0, 8)}`;
}

export function upsertSavedNotebook(
  list: SavedNotebook[],
  notebook: SavedNotebook,
): SavedNotebook[] {
  const idx = list.findIndex((n) => n.id === notebook.id);
  if (idx < 0) return [...list, notebook];
  return list.map((n, i) => (i === idx ? notebook : n));
}
