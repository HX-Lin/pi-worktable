/**
 * Running-session broadcaster.
 *
 * Pushes the current set of running session ids to subscribers whenever any
 * session's running state may have changed, so the sidebar receives live
 * MessagePort updates instead of polling. The id source is injected by the
 * registry, which keeps this module free of a dependency on the session wrapper.
 */
const runningListeners = new Set<(ids: string[]) => void>();
let runningIdsProvider: () => string[] = () => [];
let lastRunningSnapshot = "";

/** The registry supplies the live running-session ids. */
export function setRunningIdsProvider(provider: () => string[]): void {
  runningIdsProvider = provider;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  runningListeners.add(listener);
  return () => {
    runningListeners.delete(listener);
  };
}

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const ids = runningIdsProvider();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of runningListeners) {
    try {
      listener(ids);
    } catch {
      /* ignore listener errors */
    }
  }
}
