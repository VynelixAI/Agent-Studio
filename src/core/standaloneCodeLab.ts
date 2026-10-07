import type { NotebookCell } from "@/core/codeLabDefaults";
import type { SavedNotebook } from "@/types/workspace";

const PYTHON_KEY = "vynelix-standalone-python";
const NOTEBOOKS_KEY = "vynelix-standalone-notebooks";
const DRAFT_KEY = "vynelix-standalone-notebook-draft";

export function loadStandalonePython(): string {
  try {
    return localStorage.getItem(PYTHON_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveStandalonePython(source: string): void {
  try {
    localStorage.setItem(PYTHON_KEY, source);
  } catch {
    /* browser storage unavailable */
  }
}

export function loadStandaloneNotebooks(): SavedNotebook[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTEBOOKS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStandaloneNotebooks(notebooks: SavedNotebook[]): void {
  try {
    localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(notebooks));
  } catch {
    /* browser storage unavailable */
  }
}

export function loadStandaloneNotebookDraft(): NotebookCell[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map((cell) => ({ ...cell, status: "idle" as const }))
      : [];
  } catch {
    return [];
  }
}

export function saveStandaloneNotebookDraft(cells: NotebookCell[]): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(
        cells.map(({ id, cell_type, source, execution_count }) => ({
          id,
          cell_type,
          source,
          execution_count,
        })),
      ),
    );
  } catch {
    /* browser storage unavailable */
  }
}
