/**
 * Whether the writable hot-update overlay belongs to this app build.
 *
 * File timestamps cannot answer this: Electron reports the mtime of a file inside `app.asar` as the
 * process start time, so an overlay written before launch always looks *older* than the bundle and
 * was silently ignored. The overlay instead carries a manifest naming the app version it was built
 * for, which a repackage changes — so a stale overlay retires itself instead of shadowing a fresh
 * install.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_MANIFEST = "runtime-manifest.json";

export interface RuntimeManifest {
  /** `package.json` version the overlay was built from. */
  appVersion?: string;
  /** pi version the overlay bundles, for diagnostics. */
  piVersion?: string;
  builtAt?: string;
}

export function readRuntimeManifest(overlayRoot: string): RuntimeManifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(overlayRoot, RUNTIME_MANIFEST), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as RuntimeManifest;
  } catch {
    // Missing or unreadable manifest: treat the overlay as foreign.
    return null;
  }
}

/** True when the overlay at `overlayRoot` was built for `appVersion`. */
export function overlayMatchesApp(overlayRoot: string, appVersion: string): boolean {
  return readRuntimeManifest(overlayRoot)?.appVersion === appVersion;
}
