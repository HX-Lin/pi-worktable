/**
 * Auto-continue sessions that were mid-turn when the host went down.
 *
 * A hot update restarts the host and a crash kills it; either way every in-flight turn is lost and
 * the user is left with a half-finished conversation. The host therefore keeps a snapshot of its
 * running session ids, clears it on a clean shutdown, and resumes whatever is left when it starts
 * again.
 *
 * The snapshot lives in the user-data root, not in `runtime/`: installing a hot update replaces that
 * directory wholesale, which would delete the marker exactly when it is needed.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const INTERRUPTED_SNAPSHOT_FILE = "interrupted-sessions.json";

/** Text the resumed turn is started with; it lands in the transcript, so it says what happened. */
export const CONTINUE_AFTER_RESTART_PROMPT =
  "（Agent 重启后自动继续：上一个回合被中断了。）请接着完成刚才未完成的工作，不要重复已经完成的步骤。";

export interface InterruptedSnapshot {
  sessionIds: string[];
  at: string;
}

/** Snapshot location, or null when the host has no writable user-data directory (standalone). */
export function snapshotPath(userDataDir: string | undefined): string | null {
  if (!userDataDir) return null;
  return path.join(userDataDir, INTERRUPTED_SNAPSHOT_FILE);
}

/** Record the running set. An empty set removes the file, so nothing is resumed later. */
export function writeInterruptedSnapshot(userDataDir: string | undefined, sessionIds: readonly string[]): void {
  const file = snapshotPath(userDataDir);
  if (!file) return;
  try {
    if (sessionIds.length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const snapshot: InterruptedSnapshot = { sessionIds: [...sessionIds], at: new Date().toISOString() };
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch {
    // A snapshot is best effort: never let it break the host.
  }
}

export function clearInterruptedSnapshot(userDataDir: string | undefined): void {
  const file = snapshotPath(userDataDir);
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

/** Read the snapshot and clear it: an interruption is resumed once, not on every start. */
export function takeInterruptedSnapshot(userDataDir: string | undefined): string[] {
  const file = snapshotPath(userDataDir);
  if (!file) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const ids = (parsed as { sessionIds?: unknown }).sessionIds;
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    }
    return [];
  } catch {
    return [];
  } finally {
    clearInterruptedSnapshot(userDataDir);
  }
}
