import { applyAppearanceSettings, loadAppearanceSettings } from "./lib/appearance-settings";
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

// Wallpaper dim/blur are plain CSS variables the stylesheet reads, so they have to
// be set before the first paint for the same reason the theme class is.
try {
  applyAppearanceSettings(loadAppearanceSettings());
} catch {
  // Never block startup on a cosmetic setting.
}
