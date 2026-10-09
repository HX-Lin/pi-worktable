import type { MutableRefObject } from "react";

import { useI18n } from "@/i18n";
import { FolderIcon, getFileIcon } from "./FileIcons";
import type { FileIndexEntry } from "@/lib/file-fuzzy";

interface Props {
  /** What the user typed after `@`. */
  query: string;
  matches: FileIndexEntry[];
  loading: boolean;
  /** The index was truncated, so local results are provisional. */
  truncated: boolean;
  /** True once the debounced full-listing search has answered. */
  serverResultInUse: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** So arrow-key navigation can scroll the active item into view. */
  itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onPick: (entry: FileIndexEntry) => void;
}

/**
 * The `@` file picker above the composer. Rendering only: matching, ranking and
 * the keyboard handling stay with the input that owns the draft.
 */
export function AtMentionMenu({
  query,
  matches,
  loading,
  truncated,
  serverResultInUse,
  activeIndex,
  onActiveIndexChange,
  itemRefs,
  onPick,
}: Props) {
  const { t } = useI18n();

  const matchCountLabel =
    matches.length === 1
      ? t("atMatchOne", "1 match")
      : t("atMatchMany", "{count} matches").replace("{count}", String(matches.length));
  const truncatedHint =
    truncated && !serverResultInUse
      ? query
        ? t("atSearchingAll", " · searching all files…")
        : t("atIndexTruncated", " · index truncated")
      : "";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
        maxHeight: "min(48vh, 400px)",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>
          {loading
            ? t("atLoading", "Loading files...")
            : `${t("atFiles", "Files")} · ${matchCountLabel}${truncatedHint}`}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div style={{ maxHeight: "calc(min(48vh, 400px) - 34px)", overflowY: "auto", padding: 4 }}>
        {!loading && matches.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-dim)" }}>
            {truncated && !serverResultInUse ? t("atSearching", "Searching…") : t("atNoMatch", "No matching files")}
          </div>
        ) : (
          matches.map((entry, index) => {
            const active = index === activeIndex;
            const name = entry.path.split("/").pop() ?? entry.path;
            const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
            return (
              <button
                key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(entry);
                }}
                onMouseEnter={() => onActiveIndexChange(index)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: active ? "var(--bg-selected)" : "none",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 12.5,
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                  {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                </span>
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                  {name}
                  {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
