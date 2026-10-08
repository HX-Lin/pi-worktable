import { useEffect, useRef } from "react";
import type { SessionInfo } from "@/lib/types";
import type { OpenProject } from "@/lib/projects";
import { SessionTree } from "./session-sidebar/SessionTree";
import { SidebarHeader } from "./session-sidebar/SidebarHeader";
import { useProjectPicker } from "./session-sidebar/useProjectPicker";
import { useSessionTree } from "./session-sidebar/useSessionTree";
import { useSessionsFeed } from "./session-sidebar/useSessionsFeed";
import { useSidebarCwd } from "./session-sidebar/useSidebarCwd";
import { useWorktrees } from "./session-sidebar/useWorktrees";

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
  const feed = useSessionsFeed({ refreshKey, selectedSessionId, onSessionDeleted });
  const { allSessions, loading, error, sessionRefreshDone, runningSessionIds, unreadSessionIds, loadSessions } = feed;

  const cwd = useSidebarCwd({
    selectedCwdProp: selectedCwdProp ?? null,
    allSessions,
    initialSessionId,
    activeProjectRoot,
    onSelectSession,
    onInitialRestoreDone,
  });
  const { selectedCwd, setSelectedCwd, homeDir } = cwd;

  const worktrees = useWorktrees({ selectedCwd, refreshKey, allSessions, onSelectCwd: setSelectedCwd });
  const { projectRootFor } = worktrees;

  // Tell the shell only when the effective cwd actually changes — not when
  // projectRootFor's identity changes because sessions or worktrees refreshed.
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <SidebarHeader
        picker={picker}
        worktrees={worktrees}
        selectedCwd={selectedCwd}
        homeDir={homeDir}
        sessionRefreshDone={sessionRefreshDone}
        onRefresh={() => loadSessions(false)}
      />

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
