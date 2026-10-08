import { useI18n } from "@/i18n";
import { dismissToast, useToasts, type ToastLevel } from "@/lib/toast-store";

const LEVEL_STYLE: Record<ToastLevel, { color: string; icon: string }> = {
  info: { color: "var(--blue)", icon: "M12 16v-4M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" },
  success: { color: "var(--green)", icon: "m5 13 4 4L19 7" },
  warning: {
    color: "var(--amber)",
    icon: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0",
  },
  error: { color: "var(--red)", icon: "M12 8v4M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" },
};

/**
 * Toasts sit above everything, opaque (they must stay readable over the
 * wallpaper and over message text), and never take focus.
 */
export function ToastHost() {
  const { t } = useI18n();
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1300,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "min(520px, calc(100vw - 24px))",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const style = LEVEL_STYLE[toast.level];
        return (
          <div
            key={toast.id}
            role="status"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              padding: "8px 10px",
              borderRadius: "var(--radius-md)",
              background: "var(--menu-bg)",
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${style.color}`,
              boxShadow: "var(--shadow-md)",
              pointerEvents: "auto",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={style.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d={style.icon} />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--text)", overflowWrap: "anywhere" }}>{toast.text}</div>
              {toast.detail && (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label={t("dismiss", "Dismiss")}
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "var(--text-faint)",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
