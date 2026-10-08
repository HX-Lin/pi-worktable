import { useCallback, useEffect, useRef, useState } from "react";
import { call, gitBranches, gitCheckout, gitCommit, gitPull, gitPush, gitStage } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { GitStatusResult } from "@shared/api-types";

interface Props {
  cwd: string | null;
  /** Bumped when the conversation ends, so counts follow the agent's edits. */
  refreshKey?: number;
  /** Rendered with the repository controls: the worktree switcher. */
  worktrees?: React.ReactNode;
}

interface SyncInfo {
  branches: string[];
  upstream: string | null;
  ahead: number;
  behind: number;
}

/**
 * Repository controls next to the composer: where you are (branch, worktree),
 * what is uncommitted, and the four actions you reach for — sync, commit.
 */
export function ComposerScmBar({ cwd, refreshKey = 0, worktrees }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      setSync(null);
      return;
    }
    const [nextStatus, nextSync] = await Promise.all([
      call("git.status", { path: cwd }).catch(() => null),
      gitBranches(cwd).catch(() => null),
    ]);
    setStatus(nextStatus);
    setSync(nextSync);
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!branchesOpen && !commitOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      setBranchesOpen(false);
      setCommitOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [branchesOpen, commitOpen]);

  const run = useCallback(
    async (label: string, operation: () => Promise<{ output?: string }>) => {
      setBusy(label);
      setNote(null);
      try {
        await operation();
        await load();
        setNote({ text: `${label} ✓`, error: false });
      } catch (e) {
        // git's own message is the useful part; the host passes it through.
        setNote({ text: e instanceof Error ? e.message : String(e), error: true });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const commit = useCallback(async () => {
    const text = message.trim();
    if (!cwd || !text) return;
    setBusy("commit");
    setNote(null);
    try {
      // Commit what is staged, and stage tracked changes first so the button
      // does what it says after the agent edited files.
      await gitStage(cwd, ["-u"]).catch(() => undefined);
      await gitCommit(cwd, text);
      setMessage("");
      setCommitOpen(false);
      await load();
      setNote({ text: `${t("scmCommit", "Commit")} ✓`, error: false });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }, [cwd, load, message, t]);

  if (!cwd || !status?.isGit) return null;

  const changed = status.staged + status.modified + status.untracked + status.conflicted;
  const chipStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    fontSize: "var(--text-sm)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--bg-panel)",
    color: "var(--text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  };

  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        margin: "0 0 8px",
      }}
    >
      {worktrees}

      <div style={{ position: "relative" }}>
        <button type="button" style={chipStyle} onClick={() => setBranchesOpen((open) => !open)}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="9" r="2.5" />
            <path d="M6 8.5v7M8.5 6h4A3.5 3.5 0 0 1 16 9.5V9" />
          </svg>
          {status.branch ?? t("scmDetached", "detached")}
          {sync && sync.ahead > 0 && <span title={t("scmAhead", "unpushed commits")}>↑{sync.ahead}</span>}
          {sync && sync.behind > 0 && <span title={t("scmBehind", "unpulled commits")}>↓{sync.behind}</span>}
        </button>
        {branchesOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: 0,
              zIndex: 40,
              minWidth: 200,
              maxHeight: 260,
              overflowY: "auto",
              padding: 4,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            {(sync?.branches ?? []).map((branch) => (
              <button
                key={branch}
                type="button"
                onClick={() => {
                  setBranchesOpen(false);
                  if (branch !== status.branch) void run(t("scmCheckout", "Checkout"), () => gitCheckout(cwd, branch));
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 8px",
                  fontSize: "var(--text-sm)",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: branch === status.branch ? "var(--bg-hover)" : "transparent",
                  color: branch === status.branch ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {branch}
              </button>
            ))}
          </div>
        )}
      </div>

      {changed > 0 && (
        <span style={{ ...chipStyle, cursor: "default" }} title={t("scmChanged", "Changed paths")}>
          {status.staged > 0 && `+${status.staged}`}
          {status.modified > 0 && ` ~${status.modified}`}
          {status.conflicted > 0 && ` !${status.conflicted}`}
          {status.untracked > 0 && ` ?${status.untracked}`}
        </span>
      )}

      <button
        type="button"
        style={{ ...chipStyle, opacity: busy === "push" || !sync?.upstream ? 0.5 : 1 }}
        disabled={busy === "push" || !sync?.upstream}
        title={t("scmPush", "Push")}
        onClick={() => void run(t("scmPush", "Push"), () => gitPush(cwd))}
      >
        ↑ {t("scmPush", "Push")}
      </button>
      <button
        type="button"
        style={{ ...chipStyle, opacity: busy === "pull" || !sync?.upstream ? 0.5 : 1 }}
        disabled={busy === "pull" || !sync?.upstream}
        title={t("scmPull", "Pull")}
        onClick={() => void run(t("scmPull", "Pull"), () => gitPull(cwd))}
      >
        ↓ {t("scmPull", "Pull")}
      </button>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          style={chipStyle}
          onClick={() => setCommitOpen((open) => !open)}
          disabled={busy === "commit"}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <polyline points="4 12.5 9.5 18 20 6" />
          </svg>
          {t("scmCommit", "Commit")}
        </button>
        {commitOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              right: 0,
              zIndex: 40,
              width: 320,
              padding: 8,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-md)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <textarea
              autoFocus
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void commit();
              }}
              placeholder={t("scmCommitPlaceholder", "Commit message")}
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                padding: "6px 8px",
                fontSize: "var(--text-md)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", flex: 1 }}>
                {t("scmCommitHint", "Stages tracked changes, then commits")}
              </span>
              <button
                type="button"
                onClick={() => void commit()}
                disabled={!message.trim() || busy === "commit"}
                style={{
                  padding: "5px 12px",
                  fontSize: "var(--text-sm)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  cursor: message.trim() ? "pointer" : "default",
                  opacity: message.trim() ? 1 : 0.5,
                }}
              >
                {t("scmCommit", "Commit")}
              </button>
            </div>
          </div>
        )}
      </div>

      {note && (
        <span
          title={note.text}
          style={{
            fontSize: "var(--text-xs)",
            color: note.error ? "var(--danger)" : "var(--text-dim)",
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {note.text}
        </span>
      )}
    </div>
  );
}
