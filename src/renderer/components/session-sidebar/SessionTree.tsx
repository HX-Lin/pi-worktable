import type { OpenProject } from "@/lib/projects";
import { getProjectDisplayName } from "@/lib/projects";
import { useI18n } from "@/i18n";
import { ProjectMenu } from "../ProjectMenu";
import { SessionTreeItem } from "./SessionTreeItem";
import type { SessionTreeController } from "./useSessionTree";

interface Props extends SessionTreeController {
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  loading: boolean;
  error: string | null;
  openProjects: OpenProject[];
  onActivateProject?: (root: string) => void;
  onRenameProject?: (root: string) => void;
  onRemoveProject?: (root: string) => void;
  onSessionDeleted?: (id: string) => void;
  /** Re-read the session list (after a rename or delete). */
  loadSessions: (showLoading?: boolean) => void | Promise<void>;
  /** Open the "new project" picker. */
  onAddProject: () => void;
}

/** The project tree: one collapsible section per project, sessions inside. */
export function SessionTree(props: Props) {
  const {
    selectedSessionId,
    runningSessionIds,
    unreadSessionIds,
    loading,
    error,
    openProjects,
    onActivateProject,
    onRenameProject,
    onRemoveProject,
    onSessionDeleted,
    loadSessions,
    onAddProject,
    sessionFilter,
    setSessionFilter,
    expandedProjectRoots,
    toggleProjectExpanded,
    sidebarProjectRoots,
    sessionsForProjectRoot,
    projectSessionGroups,
    handleSelectSessionFromList,
    handleNewSessionInProject,
  } = props;
  const { t } = useI18n();

  return (
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
              borderRadius: "var(--radius-md)",
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
                borderRadius: "var(--radius-sm)",
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
                  borderRadius: "var(--radius-sm)",
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
                    borderRadius: "var(--radius-sm)",
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
                    borderRadius: "var(--radius-sm)",
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
            onClick={onAddProject}
            title={t("addProject", "Add project")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              padding: "7px 10px",
              /* 虚线框 + 透明底在照片上和背景分不开，给它和其他浮控件一样的实底。 */
              background: "var(--control-chip-bg)",
              border: "1px dashed var(--control-chip-border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--control-chip-fg)",
              cursor: "pointer",
              fontSize: 12,
              transition: "color 0.12s, border-color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--control-chip-fg)";
              e.currentTarget.style.borderColor = "var(--control-chip-border)";
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            {t("addProject", "Add project")}
          </button>
        </div>
      )}
    </nav>
  );
}
