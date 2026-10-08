import { useI18n } from "@/i18n";
import { displayCwd } from "./helpers";
import { AnimatedDropdown, PathLabel } from "./primitives";
import type { ProjectPickerController } from "./useProjectPicker";

/** "New project" dropdown: recent projects, default dir, browse, custom path. */
export function ProjectPicker(props: ProjectPickerController & { selectedProject: string | null; homeDir: string }) {
  const { selectedProject, homeDir, onSelectCwd: setSelectedCwd } = props;
  const {
    dropdownOpen,
    setDropdownOpen,
    dropdownRef,
    projectFilter,
    setProjectFilter,
    customPathOpen,
    setCustomPathOpen,
    customPathValue,
    setCustomPathValue,
    customPathError,
    setCustomPathError,
    customPathValidating,
    customPathInputRef,
    commitCustomPath,
    handleDefaultCwd,
    handlePickDirectory,
    showProjectFilter,
    visibleProjects,
  } = props;
  const { t } = useI18n();

  // Recent projects, the default directory, the native folder picker, and the
  // manual path entry. New sessions live inside each project in the tree below.
  return (
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
          background: "var(--accent)",
          border: "1px solid var(--accent)",
          color: "var(--on-accent)",
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
          transition: "opacity 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--accent)";
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
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-md)",
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
                borderRadius: "var(--radius-sm)",
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
                borderRadius: "var(--radius-sm)",
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
                  color: "var(--danger)",
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
                  borderRadius: "var(--radius-sm)",
                  color: "var(--on-accent)",
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
                  borderRadius: "var(--radius-sm)",
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
  );
}
