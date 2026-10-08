import { useEffect, useRef } from "react";

import { useI18n } from "@/i18n";

interface Props {
  /** Absolute project root being renamed. */
  root: string;
  value: string;
  onValueChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * Rename a project (its display name, not the folder). Kept as its own
 * component so the shell does not carry another modal's markup.
 */
export function ProjectRenameDialog({ root, value, onValueChange, onCommit, onCancel }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--scrim)",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("renameProjectTitle", "Rename project")}
        style={{
          width: 360,
          maxWidth: "calc(100vw - 40px)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 18,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("renameProjectTitle", "Rename project")}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 12, wordBreak: "break-all" }}>{root}</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder={t("renameProjectPlaceholder", "Name (empty restores the folder name)")}
          aria-label={t("renameProjectTitle", "Rename project")}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "7px 14px",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onCommit}
            style={{
              padding: "7px 14px",
              background: "var(--accent)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: "var(--on-accent)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("rename", "Rename")}
          </button>
        </div>
      </div>
    </div>
  );
}
