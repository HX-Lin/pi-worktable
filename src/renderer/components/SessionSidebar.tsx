import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { OpenProject } from "@/lib/projects";
import { useI18n } from "@/i18n";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
import { getHome, listSessions, subscribeRunning, subscribeSessionsChanged } from "@/lib/api-client";
import { getRecentProjects, loadUnreadSessionIds, saveUnreadSessionIds } from "./session-sidebar/helpers";
import { PiAgentTitle } from "./session-sidebar/PiAgentTitle";
import { ProjectPicker } from "./session-sidebar/ProjectPicker";
import { SessionTree } from "./session-sidebar/SessionTree";
import { useSessionTree } from "./session-sidebar/useSessionTree";
import { useProjectPicker } from "./session-sidebar/useProjectPicker";
import { useWorktrees } from "./session-sidebar/useWorktrees";
import { WorktreeSwitcher } from "./session-sidebar/WorktreeSwitcher";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  /** Pinned folder projects for this window (multi-project support). */
  openProjects?: OpenProject[];
  activeProjectRoot?: string | null;
  onActivateProject?: (root: string) => void;
  onRemoveProject?: (root: string) => void;
  /** Ask the shell to open the rename dialog for a project. */
  onRenameProject?: (root: string) => void;
}

export function SessionSidebar({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd: selectedCwdProp,
  onCwdChange,
  openProjects = [],
  activeProjectRoot,
  onActivateProject,
  onRemoveProject,
  onRenameProject,
}: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const picker = useProjectPicker({ allSessions, onSelectCwd: setSelectedCwd });

  const tree = useSessionTree({
    allSessions,
    recentProjects: picker.recentProjects,
    openProjects,
    onSelectCwd: setSelectedCwd,
    onSelectSession,
    onActivateProject,
    onNewSession,
  });

  const worktrees = useWorktrees({ selectedCwd, refreshKey, allSessions, onSelectCwd: setSelectedCwd });
  const {
    projectRootFor,
    wtDropdownRef,
    setWtDropdownOpen,
    setWtNewOpen,
    setWtNewBranch,
    setWtError,
    setWtConfirmRemove,
  } = worktrees;

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

  useEffect(() => {
    void getHome()
      .then((d) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      // If the window already has an active project (restored from the pinned
      // list or deep link), don't hijack it with the most-recent project.
      if (activeProjectRoot) return;
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone, activeProjectRoot]);

  // Close the worktree dropdown on an outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [wtDropdownRef, setWtDropdownOpen, setWtNewOpen, setWtNewBranch, setWtError, setWtConfirmRemove]);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.

  // Sessions of every worktree in the selected project are shown together
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <PiAgentTitle />
          <button
            onClick={() => loadSessions(false)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: sessionRefreshDone
                ? "color-mix(in srgb, var(--success) 18%, transparent)"
                : "var(--bg-hover)",
              border: `1px solid ${sessionRefreshDone ? "color-mix(in srgb, var(--success) 40%, transparent)" : "var(--border)"}`,
              color: sessionRefreshDone ? "var(--success)" : "var(--text-muted)",
              cursor: "pointer",
              width: 32,
              height: 32,
              borderRadius: 7,
              padding: 0,
              flexShrink: 0,
              transition: "background 0.3s, color 0.3s, border-color 0.3s",
            }}
            onMouseEnter={(e) => {
              if (sessionRefreshDone) return;
              e.currentTarget.style.background = "var(--bg-selected)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--accent-soft-border)";
            }}
            onMouseLeave={(e) => {
              if (sessionRefreshDone) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
            title={t("refresh", "Refresh")}
          >
            {sessionRefreshDone ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
          </button>
        </div>

        <ProjectPicker {...picker} homeDir={homeDir} selectedProject={worktrees.projectRootFor(selectedCwd)} />

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        <WorktreeSwitcher {...worktrees} selectedCwd={selectedCwd} homeDir={homeDir} />
      </div>

      {/* Project tree + sessions — sidebar is grouped by project first. */}
      <SessionTree
        {...tree}
        selectedSessionId={selectedSessionId}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        loading={loading}
        error={error}
        openProjects={openProjects}
        onActivateProject={onActivateProject}
        onRenameProject={onRenameProject}
        onRemoveProject={onRemoveProject}
        onSessionDeleted={onSessionDeleted}
        loadSessions={loadSessions}
        onAddProject={() => picker.setDropdownOpen(true)}
      />
    </div>
  );
}
