export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "vynelix-theme";

export function getStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function resolveTheme(preference: ThemeMode | "system" = "system"): ThemeMode {
  if (preference === "system") return getSystemTheme();
  return preference;
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
}

export function persistTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Initial theme before React mounts (also mirrored in index.html). */
export function initTheme(): ThemeMode {
  const mode = getStoredTheme() ?? "light";
  applyTheme(mode);
  return mode;
}
