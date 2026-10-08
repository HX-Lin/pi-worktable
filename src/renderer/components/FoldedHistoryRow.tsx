import { useI18n } from "@/i18n";

interface Props {
  messages: number;
  thinking: number;
  tools: number;
  images: number;
  /** First line of the oldest folded message, so you know where you are. */
  preview: string;
  onExpand: () => void;
}

/**
 * Old turns collapse into one line. The reference does this so a long
 * conversation opens at the end instead of rendering hundreds of cards; the
 * counts say what is hidden, and expanding renders it all.
 */
export function FoldedHistoryRow({ messages, thinking, tools, images, preview, onExpand }: Props) {
  const { t } = useI18n();
  const parts = [
    `${String(messages)} ${t("foldedMessages", "earlier messages")}`,
    thinking > 0 ? `${t("foldedThinking", "thinking")} ${String(thinking)}` : null,
    tools > 0 ? `${t("foldedTools", "tools")} ${String(tools)}` : null,
    images > 0 ? `${t("foldedImages", "images")} ${String(images)}` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onExpand}
      title={preview}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        margin: "6px 0",
        padding: "6px 10px",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-md)",
        background: "transparent",
        color: "var(--text-dim)",
        fontSize: 11.5,
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "var(--text)";
        event.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = "var(--text-dim)";
        event.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <span aria-hidden="true">▸</span>
      <span style={{ flexShrink: 0 }}>{parts.join(" · ")}</span>
      {preview && (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text-faint)",
          }}
        >
          {preview}
        </span>
      )}
    </button>
  );
}
