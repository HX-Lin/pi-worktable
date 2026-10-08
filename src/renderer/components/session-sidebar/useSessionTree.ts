import { useCallback, useMemo, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { OpenProject } from "@/lib/projects";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, sessionDateGroup, type SessionDateGroup } from "@/lib/session-list";
import { buildSessionTree, type SessionTreeNode } from "./helpers";

interface Params {
  allSessions: SessionInfo[];
  recentProjects: string[];
  openProjects: OpenProject[];
  onSelectCwd: (cwd: string) => void;
  onSelectSession: (s: SessionInfo) => void;
  onActivateProject?: (root: string) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
}

/**
 * The project tree: which projects are listed, the per-project session groups
 * (filtered by the search box), expansion state, and the row actions.
 */
export function useSessionTree({
  allSessions,
  recentProjects,
  openProjects,
  onSelectCwd: setSelectedCwd,
  onSelectSession,
  onActivateProject,
  onNewSession,
}: Params) {
  const { t } = useI18n();

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

  function makeTempSessionId(): string {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  const handleSelectSessionFromList = useCallback(
    (s: SessionInfo) => {
      if (s.cwd) setSelectedCwd(s.cwd);
      onSelectSession(s);
    },
    [onSelectSession, setSelectedCwd],
  );

  const handleNewSessionInProject = useCallback(
    (root: string) => {
      onActivateProject?.(root);
      onNewSession?.(makeTempSessionId(), root);
    },
    [onActivateProject, onNewSession],
  );

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

  return {
    sessionFilter,
    setSessionFilter,
    expandedProjectRoots,
    toggleProjectExpanded,
    sidebarProjectRoots,
    sessionsForProjectRoot,
    projectSessionGroups,
    handleSelectSessionFromList,
    handleNewSessionInProject,
  };
}

export type SessionTreeController = ReturnType<typeof useSessionTree>;
