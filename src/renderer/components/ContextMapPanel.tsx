import { useEffect, useRef } from "react";
import { ContextFoldMap } from "./ContextFoldMap";
import { useI18n } from "@/i18n";

interface Props {
  sessionId: string | null;
  /** Bumped when the transcript changes, so the map re-reads host state. */
  refreshKey?: number;
  onClose: () => void;
}

/**
 * Drawer around the context map: the same fold engine the host applies, shown
 * as the blocks currently being sent.
 */
export function ContextMapPanel({ sessionId, refreshKey = 0, onClose }: Props) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("contextMap", "Context map")}
        onClick={(event) => event.stopPropagation()}
        style={dialogStyle}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text)" }}>{t("contextMap", "Context map")}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("close", "Close")}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              padding: "3px 9px",
            }}
          >
            {t("close", "Close")}
          </button>
        </div>
        <div style={bodyStyle}>
          <ContextFoldMap sessionId={sessionId} refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 90,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(0,0,0,0.18)",
} as const;

const dialogStyle = {
  width: "min(1040px, 96%)",
  height: "min(760px, 88vh)",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 18px 48px rgba(0,0,0,0.22)",
  overflow: "hidden",
} as const;

const bodyStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: "14px 16px 18px",
} as const;
