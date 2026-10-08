import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readStoredTheme, writeStoredTheme } from "@/lib/theme-storage";

/** Base themes the composer/Electron need to know about. */
export type Theme = "light" | "dark" | "niri";

/**
 * Palette-only themes. Each one is a `html.theme-<id>` block that overrides the
 * base palette and nothing else, so surfaces, translucency and layout all
 * follow automatically — adding a theme is a CSS block plus one entry here.
 */
export interface ThemeVariant {
  id: string;
  /** Localised label key + English fallback. */
  label: string;
  labelEn: string;
  /** Swatch colors: background, panel, accent, text. */
  swatch: [string, string, string, string];
  /** Which base class the variant builds on: dark or light. */
  base: "dark" | "light";
}

export const THEME_VARIANTS: ThemeVariant[] = [
  { id: "nord", label: "北欧", labelEn: "Nord", swatch: ["#2e3440", "#3b4252", "#88c0d0", "#eceff4"], base: "dark" },
  {
    id: "gruvbox",
    label: "Gruvbox",
    labelEn: "Gruvbox",
    swatch: ["#282828", "#32302f", "#fe8019", "#ebdbb2"],
    base: "dark",
  },
  {
    id: "tokyo",
    label: "东京夜",
    labelEn: "Tokyo Night",
    swatch: ["#1a1b26", "#1f2335", "#7aa2f7", "#c0caf5"],
    base: "dark",
  },
  { id: "rose", label: "玫瑰", labelEn: "Rose", swatch: ["#fff1f2", "#ffffff", "#e11d48", "#4c0519"], base: "light" },
];

export const THEME_VARIANT_CLASSES = THEME_VARIANTS.map((variant) => `theme-${variant.id}`);

export function isThemeVariant(id: string): boolean {
  return THEME_VARIANTS.some((variant) => variant.id === id);
}

/** Everything the settings picker offers, base themes included. */
export const THEME_CHOICES: ThemeVariant[] = [
  { id: "light", label: "浅色", labelEn: "Light", swatch: ["#f7f6f3", "#fcfbf9", "#c2410c", "#1c1a17"], base: "light" },
  { id: "dark", label: "深色", labelEn: "Dark", swatch: ["#141210", "#1c1a17", "#f97316", "#faf9f7"], base: "dark" },
  {
    id: "niri",
    label: "Niri 适配",
    labelEn: "Niri",
    swatch: ["#11131a", "#1a1d27", "#ff8a3d", "#eceef4"],
    base: "dark",
  },
  ...THEME_VARIANTS,
];

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Current selection, variant first: a variant keeps its base class too. */
function getSnapshot(): string {
  if (typeof document === "undefined") return "light";
  const el = document.documentElement;
  const variant = THEME_VARIANTS.find((candidate) => el.classList.contains(`theme-${candidate.id}`));
  if (variant) return variant.id;
  if (el.classList.contains("niri")) return "niri";
  return el.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): string {
  return "light";
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

type ToggleOrigin = { x: number; y: number };

const STORED_THEMES = new Set(["light", "dark", "niri", ...THEME_VARIANTS.map((variant) => variant.id)]);

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Follow OS theme when the user has not forced a preference (or chose system)
  useEffect(() => {
    const storedTheme = (): string | null => {
      return readStoredTheme();
    };
    if (STORED_THEMES.has(storedTheme() ?? "")) return;

    const applySystem = () => {
      // Re-check on every invocation: toggling the theme flips Electron's
      // nativeTheme, which fires this media-query listener again. Without
      // this guard the listener resets themeSource to "system" and reverts
      // the toggle (feedback loop).
      const stored = storedTheme();
      if (STORED_THEMES.has(stored ?? "")) return;
      const dark = systemPrefersDark();
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.remove("niri", ...THEME_VARIANT_CLASSES);
      listeners.forEach((cb) => cb());
      void window.piBridge?.setThemeSource?.("system");
    };
    applySystem();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applySystem();
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);

  const applyTheme = useCallback((next: string, origin?: ToggleOrigin) => {
    const apply = () => {
      const el = document.documentElement;
      const variant = THEME_VARIANTS.find((candidate) => candidate.id === next);
      // Variants sit on top of a base class so the shared rules still apply.
      const base = variant ? variant.base : next;
      el.classList.toggle("dark", base !== "light");
      el.classList.toggle("niri", base === "niri");
      el.classList.remove(...THEME_VARIANT_CLASSES);
      if (variant) el.classList.add(`theme-${variant.id}`);
      writeStoredTheme(next);
      // nativeTheme has no variant or "niri"; drive system UI from the base.
      void window.piBridge?.setThemeSource?.(base === "light" ? "light" : "dark");
      listeners.forEach((cb) => cb());
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  const setTheme = useCallback(
    (next: string) => {
      if (next !== getSnapshot()) applyTheme(next);
    },
    [applyTheme],
  );

  const toggleTheme = useCallback(
    (origin?: ToggleOrigin) => {
      const current = getSnapshot();
      // Toggling a dark variant lands on light and vice versa; it never silently
      // switches to a different palette.
      const currentVariant = THEME_VARIANTS.find((variant) => variant.id === current);
      const isDarkNow = currentVariant ? currentVariant.base === "dark" : current !== "light";
      applyTheme(isDarkNow ? "light" : "dark", origin);
    },
    [applyTheme],
  );

  return { theme, setTheme, toggleTheme, isDark: theme !== "light" && theme !== "rose" };
}
