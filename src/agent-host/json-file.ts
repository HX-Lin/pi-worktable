/**
 * JSON file helpers shared by the host's config stores.
 *
 * Every store writes through a temp file and renames it into place, so a crash
 * mid-write can never leave a half-written config behind; secrets stores also
 * pass a restrictive mode.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface WriteJsonOptions {
  /** File mode for the written file (e.g. 0o600 for secrets). */
  mode?: number;
}

/** Read and parse a JSON file, falling back when it is missing or unreadable. */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Write JSON through a temp file, then rename it into place. */
export function writeJsonFileAtomic(filePath: string, value: unknown, options: WriteJsonOptions = {}): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const mode = options.mode ?? 0o644;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  try {
    renameSync(temp, filePath);
    if (options.mode !== undefined) {
      try {
        chmodSync(filePath, options.mode);
      } catch {
        /* best effort on filesystems without POSIX modes */
      }
    }
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* ignore cleanup failure */
    }
    throw error;
  }
}
