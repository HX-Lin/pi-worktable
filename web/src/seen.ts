/**
 * Which conversation updates the phone has already looked at.
 *
 * The marker is the session's own `updatedAt` value, not a wall-clock time, so a phone whose clock
 * differs from the desktop's still shows the correct unread marks. A session is unread when its
 * file changed after the last update we recorded for it.
 */
const STORAGE_KEY = "pi-h5-seen-sessions";

export type SeenMap = Record<string, string>;

export function loadSeen(): SeenMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: SeenMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[id] = value;
    }
    return out;
  } catch {
    // Private mode or corrupt data: no marks is a safe default.
    return {};
  }
}

export function saveSeen(map: SeenMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function isUnread(id: string, updatedAt: string | undefined, seen: SeenMap): boolean {
  if (!updatedAt) return false;
  return seen[id] !== updatedAt;
}

/**
 * The map after looking at `entries`. Returns the same object when nothing changed, so callers can
 * use identity to decide whether to persist.
 */
export function markSeen(seen: SeenMap, entries: Array<{ id: string; updatedAt?: string }>): SeenMap {
  let changed = false;
  const next = { ...seen };
  for (const entry of entries) {
    const value = entry.updatedAt ?? "";
    if (next[entry.id] !== value) {
      next[entry.id] = value;
      changed = true;
    }
  }
  return changed ? next : seen;
}
