import { useCallback, useEffect, useState } from "react";
import { call, gitCommitPatch, gitDiff, gitLog, gitStage, gitUnstage } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { GitStatusResult } from "@shared/api-types";

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

interface Props {
  cwd: string | null;
  refreshKey?: number;
  onOpenFile?: (path: string) => void;
}

type View = "changes" | "history";

/** git's two-axis status letter, e.g. "M " (staged) vs " M" (unstaged). */
function statusLabel(index: string, workingTree: string): string {
  if (index === "?" && workingTree === "?") return "??";
  return `${index}${workingTree}`.trim() || "M";
}

/**
 * Repository panel: what changed, and what has been committed. Mirrors the
 * reference layout — one panel, two views, staging where the files are.
 */
export function GitPanel({ cwd, refreshKey = 0, onOpenFile }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<View>("changes");
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      setCommits([]);
      return;
    }
    try {
      const [nextStatus, log] = await Promise.all([
        call("git.status", { path: cwd }).catch(() => null),
        gitLog(cwd).catch(() => ({ commits: [] as CommitInfo[] })),
      ]);
      setStatus(nextStatus);
      setCommits(log.commits);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const stage = useCallback(
    async (path: string, staged: boolean) => {
      if (!cwd) return;
      setBusy(path);
      try {
        if (staged) await gitUnstage(cwd, [path]);
        else await gitStage(cwd, [path]);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [cwd, load],
  );

  const toggleCommit = useCallback(
    async (commit: CommitInfo) => {
      if (!cwd) return;
      if (expanded === commit.hash) {
        setExpanded(null);
        setPatch(null);
        return;
      }
      setExpanded(commit.hash);
      setBusy(commit.hash);
      try {
        const result = await gitCommitPatch(cwd, commit.hash);
        setPatch(result.patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [cwd, expanded],
  );

  const showWorkingDiff = useCallback(
    async (path: string, staged: boolean) => {
      if (!cwd) return;
      setBusy(path);
      try {
        const result = await gitDiff(cwd, staged);
        setPatch(result.patch);
        setExpanded(`work:${path}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [cwd],
  );

  if (!cwd) {
    return (
      <div style={{ padding: 12, fontSize: "var(--text-md)", color: "var(--text-dim)" }}>
        {t("gitNoProject", "Open a project to see its repository.")}
      </div>
    );
  }
  if (status && !status.isGit) {
    return (
      <div style={{ padding: 12, fontSize: "var(--text-md)", color: "var(--text-dim)" }}>
        {t("gitNotARepo", "This project is not a git repository.")}
      </div>
    );
  }

  const notStaged = (status?.entries ?? []).filter((entry) => entry.index === "?" || entry.workingTree !== " ");
  const staged = (status?.entries ?? []).filter((entry) => entry.index !== " " && entry.index !== "?");

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 4px",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-md)",
    color: "var(--text)",
  };
  const badgeStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 20,
    textAlign: "center",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    color: "var(--warning)",
  };
  const actionStyle: React.CSSProperties = {
    flexShrink: 0,
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-dim)",
    cursor: "pointer",
    fontSize: "var(--text-xs)",
    padding: "1px 6px",
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {(["changes", "history"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setView(id);
              setPatch(null);
              setExpanded(null);
            }}
            aria-pressed={view === id}
            style={{
              padding: "3px 9px",
              fontSize: "var(--text-sm)",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: view === id ? "var(--accent-soft)" : "transparent",
              color: view === id ? "var(--accent)" : "var(--text-dim)",
              fontWeight: view === id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {id === "changes" ? t("gitChanges", "Changes") : t("gitHistory", "History")}
          </button>
        ))}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "var(--text-sm)",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {status?.branch ?? ""}
        </span>
      </div>

      {error && (
        <div style={{ padding: "6px 10px", fontSize: "var(--text-sm)", color: "var(--danger)" }} role="alert">
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px" }}>
        {view === "changes" ? (
          status && status.entries.length === 0 ? (
            <div style={{ fontSize: "var(--text-md)", color: "var(--text-dim)" }}>{t("gitClean", "No changes.")}</div>
          ) : (
            <>
              {staged.length > 0 && (
                <>
                  <div style={groupTitle}>{t("gitStaged", "Staged")}</div>
                  {staged.map((entry) => (
                    <div key={`s:${entry.path}`} style={rowStyle}>
                      <span style={{ ...badgeStyle, color: "var(--success)" }}>{statusLabel(entry.index, " ")}</span>
                      <span
                        onClick={() => onOpenFile?.(entry.path)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: onOpenFile ? "pointer" : "default",
                        }}
                        title={entry.path}
                      >
                        {entry.path}
                      </span>
                      <button
                        type="button"
                        style={actionStyle}
                        disabled={busy === entry.path}
                        onClick={() => void stage(entry.path, true)}
                      >
                        −
                      </button>
                    </div>
                  ))}
                </>
              )}
              {notStaged.length > 0 && (
                <>
                  <div style={groupTitle}>{t("gitUnstaged", "Not staged")}</div>
                  {notStaged.map((entry) => (
                    <div key={`u:${entry.path}`} style={rowStyle}>
                      <span style={badgeStyle}>{statusLabel(entry.index, entry.workingTree)}</span>
                      <span
                        onClick={() => void showWorkingDiff(entry.path, false)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                        title={entry.path}
                      >
                        {entry.path}
                      </span>
                      <button
                        type="button"
                        style={actionStyle}
                        disabled={busy === entry.path}
                        onClick={() => void stage(entry.path, false)}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )
        ) : commits.length === 0 ? (
          <div style={{ fontSize: "var(--text-md)", color: "var(--text-dim)" }}>
            {t("gitNoCommits", "No commits yet.")}
          </div>
        ) : (
          commits.map((commit) => (
            <div key={commit.hash}>
              <button
                type="button"
                onClick={() => void toggleCommit(commit)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 4px",
                  border: "none",
                  background: expanded === commit.hash ? "var(--bg-hover)" : "transparent",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-sm)",
                    color: "var(--accent)",
                  }}
                >
                  {commit.shortHash}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "var(--text-md)",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {commit.subject}
                </span>
                <span style={{ flexShrink: 0, fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
                  {commit.date.slice(0, 10)}
                </span>
              </button>
            </div>
          ))
        )}

        {patch !== null && (
          <pre
            style={{
              margin: "8px 0 0",
              padding: "var(--code-pad, 8px 10px)",
              borderRadius: "var(--radius-sm)",
              background: "var(--code-bg)",
              color: "var(--code-text)",
              fontSize: "var(--text-sm)",
              lineHeight: 1.5,
              maxHeight: 320,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            {patch}
          </pre>
        )}
      </div>
    </div>
  );
}

const groupTitle: React.CSSProperties = {
  margin: "6px 0 2px",
  fontSize: "var(--text-xs)",
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--text-dim)",
};
