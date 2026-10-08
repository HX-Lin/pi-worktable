/**
 * Where the theme choice lives.
 *
 * The current key is `pi-theme`, but builds before the rename wrote the same
 * choice under unprefixed keys. Reading only `pi-theme` silently dropped the
 * stored preference on those machines, and the app fell back to the system
 * theme — which is opaque, so the niri translucency never appeared at all.
 * `readStoredTheme` adopts a legacy value once, so the choice survives.
 */
export const THEME_KEY = "pi-theme";

const LEGACY_THEME_KEYS = ["theme", "pi-desktop:theme", "pi-worktable:theme"];

export function readStoredTheme(): string | null {
  try {
    const current = localStorage.getItem(THEME_KEY);
    if (current) return current;
    for (const key of LEGACY_THEME_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      localStorage.setItem(THEME_KEY, legacy);
      return legacy;
    }
    return null;
  } catch {
    // Storage can be unavailable in privacy-restricted renderer contexts.
    return null;
  }
}

export function writeStoredTheme(theme: string): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}
