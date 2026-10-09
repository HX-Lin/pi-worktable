import { useCallback, useEffect, useRef, useState } from "react";

import { type OAuthLoginState, type OAuthProvider } from "./shared";
import { SectionTitle } from "@/components/form-controls";
import { call, subscribeAuthLogin } from "@/lib/api-client";

export function OAuthDetail({ provider, onRefresh }: { provider: OAuthProvider; onRefresh: () => void }) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  /** Cancels the in-flight login stream (identity-checked against the current attempt). */
  const loginStreamRef = useRef<(() => void) | null>(null);
  const loginAttemptRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes and invalidate any in-flight startup.
  useEffect(() => {
    loginAttemptRef.current += 1;
    setLoginState({ phase: "idle" });
    setInputValue("");
    loginStreamRef.current?.();
    loginStreamRef.current = null;
    void call("auth.loginCancel", { provider: provider.id }).catch(() => {});
  }, [provider.id]);

  useEffect(() => {
    return () => {
      loginAttemptRef.current += 1;
      loginStreamRef.current?.();
      loginStreamRef.current = null;
      void call("auth.loginCancel", { provider: provider.id }).catch(() => {});
    };
  }, [provider.id]);

  const handleLogin = useCallback(async () => {
    const attempt = loginAttemptRef.current + 1;
    loginAttemptRef.current = attempt;
    loginStreamRef.current?.();
    loginStreamRef.current = null;
    setLoginState({ phase: "connecting" });
    setInputValue("");

    try {
      // Do not race cancellation with startup: a late cancel would abort the
      // brand-new OAuth flow and make the Login button appear unresponsive.
      await call("auth.loginCancel", { provider: provider.id });
    } catch (error) {
      if (loginAttemptRef.current !== attempt) return;
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : "Unable to reset login" });
      return;
    }
    if (loginAttemptRef.current !== attempt) return;

    // The stream's unsubscribe doubles as the "this attempt is over" token.
    let unsubscribe: (() => void) | null = null;
    let ended = false;
    const endStream = () => {
      ended = true;
      unsubscribe?.();
      unsubscribe = null;
      if (loginStreamRef.current === endStream) loginStreamRef.current = null;
    };
    loginStreamRef.current = endStream;
    const stale = () => ended || loginAttemptRef.current !== attempt;

    void subscribeAuthLogin(provider.id, (data) => {
      if (stale()) return;
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        // Single open path (ISSUE-008): prefer desktop openExternal
        if (data.url) {
          void (
            window.piBridge?.openExternal(data.url) ??
            Promise.resolve(window.open(data.url, "_blank", "noopener,noreferrer"))
          );
        }
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        if (data.verificationUri) {
          void (
            window.piBridge?.openExternal(data.verificationUri) ??
            Promise.resolve(window.open(data.verificationUri, "_blank", "noopener,noreferrer"))
          );
        }
      } else if (data.type === "prompt_request") {
        setLoginState({
          phase: "prompt",
          message: data.message!,
          placeholder: data.placeholder ?? null,
          token: data.token!,
        });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        endStream();
        setLoginState({
          phase: "success",
          ...(data.warning ? { message: data.warning.message, warning: true } : {}),
        });
        onRefresh();
      } else if (data.type === "error") {
        endStream();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        endStream();
        setLoginState({ phase: "idle" });
      }
    })
      .then((off) => {
        unsubscribe = off;
        if (ended) off();
      })
      .catch((error: unknown) => {
        if (stale()) return;
        endStream();
        setLoginState((prev) =>
          prev.phase === "success"
            ? prev
            : { phase: "error", message: error instanceof Error ? error.message : "Connection lost" },
        );
      });
  }, [provider.id, onRefresh]);

  const handleCancelLogin = useCallback(() => {
    loginAttemptRef.current += 1;
    loginStreamRef.current?.();
    loginStreamRef.current = null;
    setLoginState({ phase: "idle" });
    setInputValue("");
    void call("auth.loginCancel", { provider: provider.id }).catch(() => {});
  }, [provider.id]);

  const handleLogout = useCallback(async () => {
    try {
      const result = await call("auth.logout", { provider: provider.id });
      const warning = result.warning;
      setLoginState(
        warning
          ? { phase: "success", message: warning.message, warning: true }
          : { phase: "success", message: "Disconnected successfully." },
      );
      onRefresh();
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(
    async (token: string, code: string) => {
      if (!code.trim()) return;
      setLoginState({ phase: "progress", message: "Verifying…" });
      try {
        await call("auth.loginSubmit", { provider: provider.id, token, code: code.trim() });
        setInputValue("");
        // Success path: the auth progress stream emits "success" and updates state.
      } catch (e) {
        setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
      }
    },
    [provider.id],
  );

  const submitSelection = useCallback(
    async (token: string, value: string) => {
      setLoginState({ phase: "progress", message: "Continuing…" });
      try {
        await call("auth.loginSubmit", { provider: provider.id, token, code: value });
      } catch (e) {
        setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
      }
    },
    [provider.id],
  );

  const isWorking =
    loginState.phase === "connecting" ||
    loginState.phase === "progress" ||
    loginState.phase === "auth" ||
    loginState.phase === "device_code" ||
    loginState.phase === "prompt" ||
    loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>Subscription</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: provider.loggedIn ? "var(--success)" : "var(--border)",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 11, color: provider.loggedIn ? "var(--success)" : "var(--text-dim)" }}>
            {provider.loggedIn ? "connected" : "not connected"}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn
              ? "Already connected. You can re-login or disconnect."
              : `Connect your ${provider.name} account.`}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Opening browser…</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{loginState.message}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{
                    padding: "6px 9px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                If the browser window did not open,{" "}
                <a
                  href={loginState.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", wordBreak: "break-all" }}
                >
                  click here to open the login page
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCode(loginState.token, inputValue);
                }}
                placeholder={
                  loginState.phase === "auth"
                    ? "http://localhost:1455/auth/callback?code=…"
                    : (loginState.placeholder ?? "Enter value…")
                }
                style={{
                  flex: 1,
                  padding: "6px 9px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  fontSize: 12,
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{
                  padding: "6px 12px",
                  background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  color: inputValue.trim() ? "var(--on-accent)" : "var(--text-dim)",
                  cursor: inputValue.trim() ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                Submit
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Open the verification page and enter this code:
            </p>
            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                letterSpacing: 0,
              }}
            >
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a
                href={loginState.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", wordBreak: "break-all" }}
              >
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: loginState.warning ? "var(--warning)" : "var(--success)" }}>
            {loginState.message ?? "Connected successfully."}
          </p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={handleCancelLogin}
            style={{
              padding: "5px 12px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{
                padding: "5px 14px",
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                color: "var(--on-accent)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {provider.loggedIn ? "Re-login" : "Login"}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{
                  padding: "5px 12px",
                  background: "none",
                  border: "1px solid var(--danger-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Disconnect
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────
