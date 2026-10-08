import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { getHome } from "@/lib/api-client";
import { getRecentProjects } from "./helpers";

interface Params {
  /** The shell's cwd; when it changes the sidebar follows it. */
  selectedCwdProp: string | null;
  allSessions: SessionInfo[];
  initialSessionId?: string | null;
  activeProjectRoot?: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onInitialRestoreDone?: () => void;
}

/**
 * The sidebar's effective cwd: restored from a deep link on first load and kept
 * in step with the shell.
 */
export function useSidebarCwd({
  selectedCwdProp,
  allSessions,
  initialSessionId,
  activeProjectRoot,
  onSelectSession,
  onInitialRestoreDone,
}: Params) {
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");

  useEffect(() => {
    void getHome()
      .then((d) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch(() => {});
  }, []);

  const restoredRef = useRef(false);

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

  return { selectedCwd, setSelectedCwd, homeDir };
}

export type SidebarCwdController = ReturnType<typeof useSidebarCwd>;
