import { readStoredTheme } from "./lib/theme-storage";

// Apply the persisted theme before React mounts without requiring inline script CSP.
try {
  const theme = readStoredTheme();
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "niri") {
    // niri builds on the dark palette. Window translucency, blur and corner radius belong to the
    // compositor (niri `window-rule`), not to the app, so no opacity is applied here.
    document.documentElement.classList.add("dark", "niri");
  }
} catch {
  // Storage can be unavailable in privacy-restricted renderer contexts.
}
