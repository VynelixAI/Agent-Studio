/** Apply the persisted theme before React mounts without relying on inline script execution. */
(() => {
  try {
    const stored = localStorage.getItem("vynelix-theme");
    const theme = stored === "light" || stored === "dark" ? stored : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.add("light");
  }
})();
