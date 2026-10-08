import { useEffect, useRef, useState } from "react";
import { call, subscribe } from "@/lib/api-client";

/**
 * Watch one file through the agent host.
 *
 * Arms `files.watchStart`, follows `files.changed` for that path, and reports
 * the new size on every change. Returns whether the watch is currently armed.
 */
export function useFileWatch(
  filePath: string,
  sourceSessionId: string | null | undefined,
  onChange: (size?: number) => void,
): boolean {
  const [watching, setWatching] = useState(false);
  // Keep the latest callback without re-arming the watch on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    setWatching(false);

    void subscribe("files.changed", filePath, (ev) => {
      if (cancelled) return;
      if (ev.event === "connected") {
        setWatching(true);
        return;
      }
      if (ev.event === "error") {
        setWatching(false);
        return;
      }
      onChangeRef.current(typeof ev.size === "number" ? ev.size : undefined);
    })
      .then((off) => {
        if (cancelled) {
          off();
          return;
        }
        unsubscribe = off;
        return call("files.watchStart", { path: filePath, sourceSessionId: sourceSessionId ?? undefined });
      })
      .then(() => {
        if (!cancelled) setWatching(true);
      })
      .catch(() => {
        if (!cancelled) setWatching(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      void call("files.watchStop", { path: filePath }).catch(() => {});
    };
  }, [filePath, sourceSessionId]);

  return watching;
}
