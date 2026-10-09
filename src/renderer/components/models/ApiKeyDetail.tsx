import { useCallback, useEffect, useState } from "react";

import { type ApiKeyProvider } from "./shared";
import { Field, SecretTextInput, SectionTitle } from "@/components/form-controls";
import { call } from "@/lib/api-client";

export function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setWarning(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setWarning(null);
    setSavedOk(false);
    try {
      const d = await call("auth.setApiKey", { provider: provider.id, key: apiKey.trim() });
      setApiKey("");
      setSavedOk(true);
      setWarning(d.warning?.message ?? null);
      setTimeout(() => setSavedOk(false), 2000);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    setWarning(null);
    try {
      const d = await call("auth.deleteApiKey", { provider: provider.id });
      setWarning(d.warning?.message ?? null);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>API Key</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: provider.configured ? "var(--success)" : "var(--border)",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 11, color: provider.configured ? "var(--success)" : "var(--text-dim)" }}>
            {provider.configured ? "configured" : "not configured"}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? `API key is stored. Enter a new key below to replace it, or disconnect to remove it.`
          : `Enter your ${provider.displayName} API key to enable ${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}.`}
      </p>

      {!provider.configured && provider.environmentSource && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.5,
            padding: "7px 9px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          A credential is supplied by the environment variable {provider.environmentSource}. Pi uses it at request time,
          but it is not an app-managed connection, so it is not counted as configured here. A key saved below takes
          precedence.
        </p>
      )}

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey.trim()) void handleSave();
            }}
            placeholder={provider.configured ? "Enter new key to replace…" : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "var(--success)" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: apiKey.trim() || savedOk ? "var(--on-accent)" : "var(--text-dim)",
              cursor: saving || !apiKey.trim() || savedOk ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {savedOk && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{error}</p>}
      {warning && <p style={{ margin: 0, fontSize: 12, color: "var(--warning)" }}>{warning}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start",
            padding: "5px 12px",
            background: "none",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--danger)",
            cursor: removing ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
        >
          {removing ? "Removing…" : "Disconnect"}
        </button>
      )}
    </div>
  );
}

// ── Provider icon ─────────────────────────────────────────────────────────────
