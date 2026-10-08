/**
 * Wallpaper appearance: how much of the theme colour is laid over the desktop
 * wallpaper the transparent window shows through, and how far that backdrop is
 * blurred.
 *
 * Dimming the wallpaper — instead of darkening every control or recolouring the
 * text — is what keeps both readable text *and* a visible wallpaper: the layer
 * sits under the whole UI, so nothing inside the app has to compensate.
 */

export interface AppearanceSettings {
  /** 0–0.9 of the theme background painted over the wallpaper. */
  wallpaperDim: number;
  /** 0–24 px backdrop blur radius. */
  wallpaperBlur: number;
}

const STORAGE_KEY = "pi-appearance";

export const WALLPAPER_DIM_MIN = 0;
export const WALLPAPER_DIM_MAX = 0.9;
export const WALLPAPER_DIM_STEP = 0.05;
export const WALLPAPER_BLUR_MIN = 0;
export const WALLPAPER_BLUR_MAX = 24;
export const WALLPAPER_BLUR_STEP = 1;

/** Enough contrast for text on a busy photo, while the wallpaper stays legible. */
export const APPEARANCE_DEFAULTS: AppearanceSettings = { wallpaperDim: 0.35, wallpaperBlur: 0 };

export function clampWallpaperDim(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return APPEARANCE_DEFAULTS.wallpaperDim;
  return Math.min(WALLPAPER_DIM_MAX, Math.max(WALLPAPER_DIM_MIN, Math.round(numeric * 100) / 100));
}

export function clampWallpaperBlur(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return APPEARANCE_DEFAULTS.wallpaperBlur;
  return Math.min(WALLPAPER_BLUR_MAX, Math.max(WALLPAPER_BLUR_MIN, Math.round(numeric)));
}

export function normalizeAppearance(input: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  return {
    wallpaperDim: clampWallpaperDim(input?.wallpaperDim),
    wallpaperBlur: clampWallpaperBlur(input?.wallpaperBlur),
  };
}

export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...APPEARANCE_DEFAULTS };
    return normalizeAppearance(JSON.parse(raw) as Partial<AppearanceSettings>);
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAppearance(settings)));
  } catch {
    // A full or disabled localStorage must not break the settings dialog.
  }
}

/** Publish the values the stylesheet reads; called on boot and on every change. */
export function applyAppearanceSettings(settings: AppearanceSettings): void {
  const normalized = normalizeAppearance(settings);
  const root = document.documentElement;
  root.style.setProperty("--wallpaper-dim", String(normalized.wallpaperDim));
  root.style.setProperty("--wallpaper-blur", `${String(normalized.wallpaperBlur)}px`);
}
