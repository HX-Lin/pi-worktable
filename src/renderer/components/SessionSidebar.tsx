import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { OpenProject } from "@/lib/projects";
import { getProjectDisplayName } from "@/lib/projects";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, sessionDateGroup, type SessionDateGroup } from "@/lib/session-list";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
import {
  defaultCwd,
  getHome,
  listSessions,
  subscribeRunning,
  subscribeSessionsChanged,
  validateCwd,
} from "@/lib/api-client";
import { ProjectMenu } from "./ProjectMenu";
import {
  buildSessionTree,
  displayCwd,
  getRecentProjects,
  loadUnreadSessionIds,
  saveUnreadSessionIds,
  type SessionTreeNode,
} from "./session-sidebar/helpers";
import { AnimatedDropdown, PathLabel } from "./session-sidebar/primitives";
import { PiAgentTitle } from "./session-sidebar/PiAgentTitle";
import { SessionTreeItem } from "./session-sidebar/SessionTreeItem";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  // Projects manually expanded in the sidebar tree (the active project is
  // always expanded; searching expands every matching project).
  const [expandedProjectRoots, setExpandedProjectRoots] = useState<Set<string>>(() => new Set());
  const toggleProjectExpanded = useCallback((root: string) => {
    setExpandedProjectRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  }, []);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const data = await validateCwd(path);
      if (!data.ok) {
        setCustomPathError(data.error ?? "Invalid path");
        return;
      }
      setSelectedCwd(data.path ?? path);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const data = await defaultCwd();
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  /** Desktop-native directory picker (design §6.1). Falls back to path input. */
  const handlePickDirectory = useCallback(async () => {
    try {
      const dir = await window.piBridge?.selectDirectory?.();
      if (!dir) return;
      const data = await validateCwd(dir);
      if (!data.ok) {
        setCustomPathError(data.error ?? "Invalid directory");
        return;
      }
      setSelectedCwd(data.path ?? dir);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
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
  const handleSelectSessionFromList = useCallback(
    (s: SessionInfo) => {
      if (s.cwd) setSelectedCwd(s.cwd);
      onSelectSession(s);
    },
    [onSelectSession],
  );

  const handleNewSessionInProject = useCallback(
    (root: string) => {
      onActivateProject?.(root);
      onNewSession?.(makeTempSessionId(), root);
    },
    [onActivateProject, onNewSession],
  );

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Sidebar project tree: pinned projects first, then projects that own
  // sessions (ordered by recency), then any remaining session directories.
  const sidebarProjectRoots = useMemo(() => {
    const roots: string[] = [];
    const seen = new Set<string>();
    for (const project of openProjects) {
      if (!seen.has(project.root)) {
        seen.add(project.root);
        roots.push(project.root);
      }
    }
    for (const root of recentProjects) {
      if (!seen.has(root)) {
        seen.add(root);
        roots.push(root);
      }
    }
    for (const session of allSessions) {
      const root = session.projectRoot ?? session.cwd;
      if (root && !seen.has(root)) {
        seen.add(root);
        roots.push(root);
      }
    }
    return roots;
  }, [openProjects, recentProjects, allSessions]);

  const sessionsForProjectRoot = useCallback(
    (root: string): SessionInfo[] => allSessions.filter((s) => (s.projectRoot ?? s.cwd) === root),
    [allSessions],
  );

  // Group + tree sessions of one project (respecting the search filter).
  const projectSessionGroups = useCallback(
    (root: string): { id: SessionDateGroup; label: string; nodes: SessionTreeNode[] }[] => {
      const filtered = filterSessionsForQuery(sessionsForProjectRoot(root), sessionFilter);
      const tree = buildSessionTree(filtered);
      const groups: { id: SessionDateGroup; label: string; nodes: SessionTreeNode[] }[] = [
        { id: "today", label: t("sessionsToday", "Today"), nodes: [] },
        { id: "recent", label: t("sessionsRecent", "Last 7 days"), nodes: [] },
        { id: "older", label: t("sessionsOlder", "Older"), nodes: [] },
      ];
      for (const node of tree) {
        groups.find((group) => group.id === sessionDateGroup(node.session.modified))?.nodes.push(node);
      }
      return groups;
    },
    [sessionsForProjectRoot, sessionFilter, t],
  );

  function makeTempSessionId(): string {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = worktrees.projectRootFor(selectedCwd);

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

        {/* New project — opens the project picker (recent projects, default
            directory, browse folder, custom path). New sessions live inside
            each project in the tree below. */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={t("newProject", "New project")}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              padding: "8px 10px",
              background: "var(--text)",
              border: "none",
              color: "var(--bg)",
              cursor: "pointer",
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
              transition: "opacity 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            {t("newProject", "New project")}
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
            }}
          >
            {showProjectFilter && (
              <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                <input
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setProjectFilter("");
                      setDropdownOpen(false);
                    }
                  }}
                  placeholder={t("filterProjects", "Filter projects…")}
                  autoFocus
                  style={{
                    width: "100%",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}
            <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
              {visibleProjects.map((project) => (
                <button
                  key={project}
                  onClick={() => {
                    setSelectedCwd(project);
                    setProjectFilter("");
                    setCustomPathOpen(false);
                    setCustomPathValue("");
                    setCustomPathError(null);
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--bg)",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: project === selectedProject ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={project}
                >
                  {project === selectedProject && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  )}
                  {project !== selectedProject && <span style={{ width: 10, flexShrink: 0 }} />}
                  <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
                </button>
              ))}
              {visibleProjects.length === 0 && projectFilter.trim() && (
                <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>
                  {t("noMatchingProjects", "No matching projects")}
                </div>
              )}
            </div>

            {/* Default cwd shortcut */}
            {!customPathOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDefaultCwd();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("useDefaultDirectory", "Use default directory")}</span>
              </button>
            )}

            {/* Native directory picker (desktop) */}
            {!customPathOpen && typeof window !== "undefined" && !!window.piBridge && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePickDirectory();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("browseFolder", "Browse folder…")}</span>
              </button>
            )}

            {/* Custom path entry */}
            {!customPathOpen ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomPathOpen(true);
                  setCustomPathError(null);
                  setTimeout(() => customPathInputRef.current?.focus(), 0);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  style={{ flexShrink: 0 }}
                >
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("customPath", "Custom path…")}</span>
              </button>
            ) : (
              <div style={{ padding: "6px 8px", borderTop: visibleProjects.length > 0 ? "none" : undefined }}>
                <input
                  ref={customPathInputRef}
                  value={customPathValue}
                  onChange={(e) => {
                    setCustomPathValue(e.target.value);
                    setCustomPathError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitCustomPath();
                    }
                    if (e.key === "Escape") {
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                    }
                  }}
                  placeholder="/path/to/project"
                  style={{
                    width: "100%",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    padding: "5px 8px",
                    border: "1px solid var(--accent)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    boxSizing: "border-box",
                  }}
                />
                {customPathError && (
                  <div
                    style={{
                      marginTop: 5,
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {customPathError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                  <button
                    onClick={() => void commitCustomPath()}
                    disabled={customPathValidating || !customPathValue.trim()}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: 5,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                      opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                    }}
                  >
                    {customPathValidating ? t("checking", "Checking…") : t("open", "Open")}
                  </button>
                  <button
                    onClick={() => {
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                    }}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      color: "var(--text-muted)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {t("cancel", "Cancel")}
                  </button>
                </div>
              </div>
            )}
          </AnimatedDropdown>
        </div>

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
      <nav
        aria-label={t("sessions", "Sessions")}
        style={{ flex: "1 1 auto", overflowY: "auto", padding: "0", minHeight: 80 }}
      >
        <div
          style={{
            padding: "10px 10px 6px",
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              padding: "0 4px 7px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text-dim)",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            <span>{t("projects", "Projects")}</span>
            <span aria-label={`${sidebarProjectRoots.length} ${t("projects", "projects")}`}>
              {sidebarProjectRoots.length}
            </span>
          </div>
          <div style={{ position: "relative" }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-dim)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
            <input
              type="search"
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              placeholder={t("searchSessions", "Search sessions…")}
              aria-label={t("searchSessions", "Search sessions")}
              style={{
                width: "100%",
                height: 34,
                padding: "0 30px 0 32px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontSize: 13,
                outline: "none",
              }}
            />
            {sessionFilter && (
              <button
                type="button"
                onClick={() => setSessionFilter("")}
                title={t("clearSessionSearch", "Clear session search")}
                aria-label={t("clearSessionSearch", "Clear session search")}
                style={{
                  position: "absolute",
                  top: 1,
                  right: 1,
                  width: 32,
                  height: 32,
                  border: 0,
                  borderRadius: 7,
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        {loading && <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>Loading...</div>}
        {error && <div style={{ padding: "12px 14px", color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        {!loading && !error && sidebarProjectRoots.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            {t("noProjectsYet", "No projects yet — add a project to start a conversation")}
          </div>
        )}
        <div style={{ padding: "4px 6px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {sidebarProjectRoots.map((root) => {
            const isExpanded = Boolean(sessionFilter.trim()) || expandedProjectRoots.has(root);
            const isPinned = openProjects.some((p) => p.root === root);
            const projectName = getProjectDisplayName(openProjects, root);
            const totalCount = sessionsForProjectRoot(root).length;
            const groups = projectSessionGroups(root);
            const hasVisibleSessions = groups.some((g) => g.nodes.length > 0);
            return (
              <section key={root} aria-labelledby={`project-${root}`}>
                {/* Project header — always collapsible; only sessions highlight */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    padding: "3px 4px 3px 2px",
                    borderRadius: 7,
                    transition: "background 0.12s",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleProjectExpanded(root)}
                    title={isExpanded ? t("collapseProject", "Collapse project") : t("expandProject", "Expand project")}
                    aria-label={
                      isExpanded ? t("collapseProject", "Collapse project") : t("expandProject", "Expand project")
                    }
                    aria-expanded={isExpanded}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 22,
                      padding: 0,
                      flexShrink: 0,
                      background: "none",
                      border: "none",
                      borderRadius: 5,
                      color: "var(--text-dim)",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
                    >
                      <polyline points="2 3 5 6.5 8 3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onActivateProject?.(root);
                      if (sessionFilter.trim()) setSessionFilter("");
                    }}
                    title={root}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 4px",
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 450,
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0, color: "var(--text-dim)" }}
                      aria-hidden="true"
                    >
                      <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {projectName}
                    </span>
                    {totalCount > 0 && (
                      <span
                        style={{
                          flexShrink: 0,
                          marginLeft: "auto",
                          fontSize: 10,
                          color: "var(--text-dim)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {totalCount}
                      </span>
                    )}
                  </button>
                  {isPinned && (
                    <ProjectMenu onRename={() => onRenameProject?.(root)} onRemove={() => onRemoveProject?.(root)} />
                  )}
                  <button
                    type="button"
                    onClick={() => handleNewSessionInProject(root)}
                    title={`${t("newSessionIn", "New session")}: ${projectName}`}
                    aria-label={`${t("newSessionIn", "New session")}: ${projectName}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 22,
                      padding: 0,
                      background: "none",
                      border: "none",
                      borderRadius: 5,
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      flexShrink: 0,
                      fontSize: 13,
                      lineHeight: 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--accent)";
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-dim)";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    +
                  </button>
                </div>
                {isExpanded && (
                  <div style={{ padding: "2px 0 6px 12px" }}>
                    {hasVisibleSessions ? (
                      groups.map(
                        (group) =>
                          group.nodes.length > 0 && (
                            <section key={group.id} aria-labelledby={`session-group-${group.id}`}>
                              <div
                                id={`session-group-${group.id}`}
                                style={{
                                  padding: "7px 8px 4px",
                                  color: "var(--text-dim)",
                                  fontSize: 12,
                                  fontWeight: 650,
                                }}
                              >
                                {group.label}
                              </div>
                              <div role="list" style={{ display: "flex", flexDirection: "column" }}>
                                {group.nodes.map((node) => (
                                  <SessionTreeItem
                                    key={node.session.id}
                                    node={node}
                                    selectedSessionId={selectedSessionId}
                                    runningSessionIds={runningSessionIds}
                                    unreadSessionIds={unreadSessionIds}
                                    onSelectSession={handleSelectSessionFromList}
                                    onRenamed={loadSessions}
                                    onSessionDeleted={(id) => {
                                      onSessionDeleted?.(id);
                                      void loadSessions();
                                    }}
                                    depth={0}
                                  />
                                ))}
                              </div>
                            </section>
                          ),
                      )
                    ) : (
                      <div style={{ padding: "6px 8px 4px", color: "var(--text-dim)", fontSize: 11.5 }}>
                        {sessionFilter.trim()
                          ? t("noMatchingSessions", "No matching sessions")
                          : t("noSessionsInProject", "No sessions in this project yet")}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {!loading && !error && sidebarProjectRoots.length > 0 && (
          <div style={{ padding: "8px 10px 14px" }}>
            <button
              type="button"
              onClick={() => setDropdownOpen(true)}
              title={t("addProject", "Add project")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                width: "100%",
                padding: "7px 10px",
                background: "none",
                border: "1px dashed var(--border)",
                borderRadius: 7,
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 12,
                transition: "color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
              {t("addProject", "Add project")}
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}
