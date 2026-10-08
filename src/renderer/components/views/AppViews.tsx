import type { ReactNode } from "react";

import { GitPanel } from "../GitPanel";
import { MemoryPanel } from "../MemoryPanel";
import { TaskBoard } from "../TaskBoard";
import { TrajectoryView } from "./TrajectoryView";

/** What a workspace view is given: enough to load and act on project state. */
export interface ViewContext {
  /** Project root the view works against. */
  cwd: string | null;
  /** Active session, when the view is about one conversation. */
  sessionId: string | null;
  /** Bumped when the project changes on disk, so views can refetch. */
  refreshKey: number;
  /** Open a file in the dock. */
  onOpenFile: (path: string, name: string) => void;
}

export interface WorkspaceView {
  id: string;
  label: string;
  labelEn: string;
  icon: ReactNode;
  /** Views are registered here instead of hardcoded in the shell, so adding one
   * is a single entry rather than an edit to AppShell's JSX. */
  render: (context: ViewContext) => ReactNode;
}

const ICON = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function GitViewIcon() {
  return (
    <svg {...ICON}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7M8.5 7.4 15.6 11" />
    </svg>
  );
}

export function TasksViewIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8.5 13.5l1.8 1.8 3.7-3.6" />
    </svg>
  );
}

export function MemoryViewIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 3a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-8 0v-1a3 3 0 0 1 0-6V7a4 4 0 0 1 4-4Z" />
      <path d="M12 3v18" />
    </svg>
  );
}

export function TrajectoryViewIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 6h6M3 12h11M3 18h7" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="17" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

/**
 * The project-scoped views behind the chat. They are full views rather than
 * dock panels because a diff, a board or a timeline needs the width, and
 * because you go to them deliberately.
 */
export const WORKSPACE_VIEWS: WorkspaceView[] = [
  {
    id: "git",
    label: "Git",
    labelEn: "Git",
    icon: <GitViewIcon />,
    render: (context) => (
      <GitPanel
        cwd={context.cwd}
        refreshKey={context.refreshKey}
        onOpenFile={(path) => {
          context.onOpenFile(path, path.split("/").pop() ?? path);
        }}
      />
    ),
  },
  {
    id: "tasks",
    label: "任务看板",
    labelEn: "Tasks",
    icon: <TasksViewIcon />,
    render: (context) => <TaskBoard cwd={context.cwd} />,
  },
  {
    id: "memory",
    label: "项目记忆",
    labelEn: "Memory",
    icon: <MemoryViewIcon />,
    render: (context) => <MemoryPanel cwd={context.cwd} />,
  },
  {
    id: "trajectory",
    label: "运行轨迹",
    labelEn: "Trajectory",
    icon: <TrajectoryViewIcon />,
    render: (context) => <TrajectoryView sessionId={context.sessionId} refreshKey={context.refreshKey} />,
  },
];
