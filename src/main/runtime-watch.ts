/**
 * Hot-update watcher for the writable runtime overlay.
 *
 * The app prefers `userData/runtime/host/agent-host.mjs` and
 * `userData/runtime/renderer/` over the copies inside `app.asar` when they exist.
 * Writing a new build there makes the running app pick it up: the agent host is
 * restarted in place and the renderer is reloaded — without quitting the app.
 */
import fs from "node:fs";
import { appendMainLog } from "./logger";
import { runtimeHostDir, runtimeRendererDir } from "./host-manager";

const DEBOUNCE_MS = 500;

export function startRuntimeWatcher(options: { restartHost: () => void; reloadRenderer: () => void }): () => void {
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const schedule = (key: string, action: () => void) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        action();
      }, DEBOUNCE_MS),
    );
  };

  const watch = (dir: string, key: string, action: () => void) => {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const watcher = fs.watch(dir, { recursive: true }, () => {
        appendMainLog(`runtime ${key} changed — hot update`);
        schedule(key, action);
      });
      watchers.push(watcher);
    } catch (error) {
      appendMainLog(`runtime watch failed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  watch(runtimeHostDir(), "host", options.restartHost);
  watch(runtimeRendererDir(), "renderer", options.reloadRenderer);

  return () => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
