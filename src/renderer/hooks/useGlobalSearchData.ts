import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { call, listSessions } from "../lib/api-client";
import type { SessionInfo } from "@shared/types";

const FILE_QUERY_DEBOUNCE_MS = 120;

interface Params {
  open: boolean;
  /** Root the file list is indexed from: the active project's cwd. */
  fileRoot: string | null;
}

/**
 * Data for the palette. Sessions are loaded once per open (cheap, and it keeps
 * the list fresh after renames); files come from the same index the @-mention
 * menu uses, but only once something has been typed — an empty query would
 * pull the whole tree just to hide it again.
 */
export function useGlobalSearchData({ open, fileRoot }: Params) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listSessions()
      .then((result) => {
        if (!cancelled) setSessions(result.sessions ?? []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadFiles = useCallback(
    (query: string) => {
      if (!open || !fileRoot || query.trim().length === 0) {
        setFiles([]);
        setLoadingFiles(false);
        return;
      }
      const requestId = ++requestRef.current;
      setLoadingFiles(true);
      void call("files.index", { root: fileRoot, query })
        .then((result) => {
          // Drop stale responses: typing fast outruns the index.
          if (requestId !== requestRef.current) return;
          setFiles(result.files ?? []);
        })
        .catch(() => {
          if (requestId === requestRef.current) setFiles([]);
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoadingFiles(false);
        });
    },
    [fileRoot, open],
  );

  useEffect(() => {
    if (!open) return;
    setFiles([]);
  }, [open, fileRoot]);

  /** Called on every keystroke; the debounce lives here so callers stay dumb. */
  const searchFiles = useCallback(
    (query: string) => {
      if (!fileRoot || query.trim().length === 0) {
        setFiles([]);
        return;
      }
      const timer = setTimeout(() => loadFiles(query), FILE_QUERY_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    },
    [fileRoot, loadFiles],
  );

  return useMemo(() => ({ sessions, files, loadingFiles, searchFiles }), [sessions, files, loadingFiles, searchFiles]);
}
