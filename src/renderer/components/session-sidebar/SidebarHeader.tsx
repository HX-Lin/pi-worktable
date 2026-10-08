import { useI18n } from "@/i18n";
import { PiAgentTitle } from "./PiAgentTitle";
import { ProjectPicker } from "./ProjectPicker";
import type { ProjectPickerController } from "./useProjectPicker";
import type { WorktreesController } from "./useWorktrees";

interface Props {
  picker: ProjectPickerController;
  worktrees: WorktreesController;
  selectedCwd: string | null;
  homeDir: string;
  sessionRefreshDone: boolean;
  onRefresh: () => void;
}

/** Title, refresh action, and the project / worktree rows. */
export function SidebarHeader({ picker, worktrees, selectedCwd, homeDir, sessionRefreshDone, onRefresh }: Props) {
  const { t } = useI18n();

  return (
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
          onClick={onRefresh}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: sessionRefreshDone ? "color-mix(in srgb, var(--success) 18%, transparent)" : "var(--bg-hover)",
            border: `1px solid ${sessionRefreshDone ? "color-mix(in srgb, var(--success) 40%, transparent)" : "var(--border)"}`,
            color: sessionRefreshDone ? "var(--success)" : "var(--text-muted)",
            cursor: "pointer",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
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
    </div>
  );
}
