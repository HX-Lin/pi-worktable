import { Component, type CSSProperties, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ensureRpc, resetRpc } from "@/lib/api-client";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pi-desktop] render error:", error, info.componentStack);
    // One automatic recovery attempt: reloading usually clears the transient
    // state (stale session stream, extension UI request) that triggered the
    // update loop. Only surface the crash UI if it happens repeatedly.
    try {
      const count = Number(window.sessionStorage.getItem("pi-crash-count") ?? "0") + 1;
      window.sessionStorage.setItem("pi-crash-count", String(count));
      if (count <= 1) {
        window.location.reload();
        return;
      }
    } catch {
      /* sessionStorage unavailable — fall through to the crash UI */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={centerStyle}>
          <div style={cardStyle}>
            <h1 style={titleStyle}>UI crashed</h1>
            <p style={bodyStyle}>{this.state.error.message}</p>
            <pre style={preStyle}>{this.state.error.stack}</pre>
            <button type="button" onClick={() => window.location.reload()} style={btnPrimary}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting…");
  /** Set while the error screen is up because the host died, cleared once it answers again. */
  const crashPending = useRef(false);
  /** A runtime update is waiting for running sessions, so the wait is visible instead of silent. */
  const [hotUpdatePending, setHotUpdatePending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus(window.piBridge ? "Waiting for Agent Host…" : "piBridge missing (preload failed?)");

    const connect = () => {
      ensureRpc()
        .then(() => {
          if (!cancelled) {
            setReady(true);
            setError(null);
            // Let mounted consumers (useAgentSession etc.) know the RPC
            // connection was (re)established so they can resubscribe their
            // session event streams after a host restart.
            window.dispatchEvent(new CustomEvent("pi:host-ready"));
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setReady(false);
          }
        });
    };

    connect();

    const offRestart = window.piBridge?.onHostRestarted?.((payload) => {
      console.warn("[pi-desktop] host restarted:", payload.reason);
      resetRpc();
      setReady(false);
      setStatus("Agent Host restarted — reconnecting…");
      setError(null);
      connect();
    });

    const offCrash = window.piBridge?.onHostCrashed?.((payload) => {
      resetRpc();
      setReady(false);
      crashPending.current = true;
      setError(payload.detail || "Agent Host crashed and could not recover");
    });

    // A crashed host is restarted by the supervisor, and a hot update restarts it too. Either way the
    // UI has to come back from the error screen by itself instead of waiting for a manual reload.
    const offStatus = window.piBridge?.onHostStatus?.((payload) => {
      if (payload.status !== "ready" || !crashPending.current) return;
      crashPending.current = false;
      resetRpc();
      setError(null);
      setStatus("Agent Host restarted — reconnecting…");
      connect();
    });

    const offHotUpdate = window.piBridge?.onHostHotUpdate?.((payload) => {
      setHotUpdatePending(payload.pending);
      if (payload.pending) {
        console.warn("[pi-desktop] hot update ready; waiting for running sessions");
      }
    });

    const offMenuDiag = window.piBridge?.onMenu?.("export-diagnostics", () => {
      void window.piBridge?.exportDiagnostics?.();
    });

    // Clear dock badge when user focuses the app
    const onFocus = () => window.piBridge?.clearBadge?.();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      offRestart?.();
      offCrash?.();
      offStatus?.();
      offHotUpdate?.();
      offMenuDiag?.();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Cannot connect to Agent Host</h1>
          <p style={bodyStyle}>{error}</p>
          <p style={{ ...bodyStyle, fontSize: 12 }}>
            Host must be running (utilityProcess). Check logs if this persists.
          </p>
          <button type="button" onClick={() => window.location.reload()} style={btnPrimary}>
            Retry
          </button>
          <button type="button" onClick={() => void window.piBridge?.openLogs()} style={btnSecondary}>
            Open logs
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={centerStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>{status}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Pi Worktable</div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AppShell />
      {hotUpdatePending && (
        <div style={hotUpdateBannerStyle} role="status">
          Hot update ready — it applies once the running tasks finish.
        </div>
      )}
    </ErrorBoundary>
  );
}

const centerStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
  background: "var(--bg)",
  fontFamily: "Inter, system-ui, sans-serif",
};

const cardStyle: CSSProperties = {
  maxWidth: 520,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "28px 32px",
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  margin: "0 0 12px",
  fontFamily: "ui-monospace, monospace",
  color: "var(--text)",
};

const bodyStyle: CSSProperties = { fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 8px" };

const preStyle: CSSProperties = {
  fontSize: 11,
  overflow: "auto",
  maxHeight: 200,
  background: "var(--tool-bg)",
  color: "var(--tool-fg)",
  padding: 12,
  borderRadius: "var(--radius-md)",
};

const btnPrimary: CSSProperties = {
  marginTop: 16,
  padding: "8px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--text)",
  color: "var(--bg)",
  cursor: "pointer",
};

/** Sits above the app so a waiting runtime update is visible without taking space. */
const hotUpdateBannerStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  zIndex: 60,
  maxWidth: "calc(100vw - 36px)",
  padding: "7px 14px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  boxShadow: "var(--shadow-md)",
  color: "var(--text-muted)",
  fontSize: 12,
  pointerEvents: "none",
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  marginLeft: 8,
  background: "var(--bg-panel)",
  color: "var(--text)",
};
