import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { listSessions, subscribeRunning, subscribeSessionsChanged } from "@/lib/api-client";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
import { loadUnreadSessionIds, saveUnreadSessionIds } from "./helpers";

interface Params {
  refreshKey?: number;
  selectedSessionId: string | null;
  onSessionDeleted?: (sessionId: string) => void;
}

/**
 * The session list and the live state around it: which sessions are running,
 * which have unread activity, and the streams that keep both current.
 */
export function useSessionsFeed({ refreshKey, selectedSessionId, onSessionDeleted }: Params) {
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the live stream has delivered a frame it is the source of truth for
  // running state; late session responses must not overwrite it.
  const streamAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const data = await listSessions();
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      setAllSessions(sessions);
      // Treat the fetched running set as an initial fallback only. Once the stream is
      // live it owns this state, so a slow fetch can't revive a stale snapshot.
      if (!streamAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void subscribeRunning((data) => {
      streamAuthoritativeRef.current = true;
      setRunningSessionIds(new Set(data.sessionIds ?? []));
    }).then((u) => {
      if (cancelled) u();
      else unsub = u;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // sessions.changed (CLI / disk watcher) → refresh sidebar without polling
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void subscribeSessionsChanged((event) => {
      if (event.fullRefresh || (!event.session && !(event.deleted && event.sessionId))) {
        void loadSessions(false);
      } else {
        setAllSessions((current) => applySessionChangedEvent(current, event) ?? current);
      }
      if (event.deleted && event.sessionId) {
        setUnreadSessionIds((current) => {
          if (!current.has(event.sessionId!)) return current;
          const next = new Set(current);
          next.delete(event.sessionId!);
          return next;
        });
        onSessionDeleted?.(event.sessionId);
      }
    }).then((u) => {
      if (cancelled) u();
      else unsub = u;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [loadSessions, onSessionDeleted]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  return {
    allSessions,
    loading,
    error,
    sessionRefreshDone,
    runningSessionIds,
    unreadSessionIds,
    loadSessions,
  };
}

export type SessionsFeedController = ReturnType<typeof useSessionsFeed>;
