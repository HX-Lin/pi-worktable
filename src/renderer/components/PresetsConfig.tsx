import { useState } from "react";

import { useI18n } from "@/i18n";
import { call, rpcErrorBody } from "@/lib/api-client";
import { readStoredTheme, writeStoredTheme } from "@/lib/theme-storage";

interface Props {
  cwd: string | null;
  /** Applied after an import so the palette and language follow the preset. */
  onAppearanceChange?: (appearance: { theme?: string; language?: string }) => void;
}

interface ImportResult {
  applied: { agentsAdded: number; agentsSkipped: number; mcpAdded: number; mcpSkipped: number };
  warnings: string[];
}

/**
 * Presets: export the portable half of this setup, or paste someone else's.
 *
 * The host owns agents, MCP endpoints and gate rules; the palette and language
 * live in the renderer, so both halves are merged here.
 */
export function PresetsConfig({ cwd, onAppearanceChange }: Props) {
  const { t, language, setLanguage } = useI18n();
  const [exported, setExported] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ agents: number; mcpServers: number } | null>(null);
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await call("preset.export", cwd ? { cwd } : {});
      const parsed = JSON.parse(response.json) as Record<string, unknown>;
      // The renderer owns these two, so they are folded in before showing the file.
      parsed.appearance = { theme: readStoredTheme() ?? "dark", language };
      const json = `${JSON.stringify(parsed, null, 2)}\n`;
      setExported(json);
      setCounts(response.counts);
      setCopied(false);
    } catch (cause) {
      setError(String(rpcErrorBody(cause).error ?? cause));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
    } catch {
      setError(t("presetCopyFailed", "Could not reach the clipboard"));
    }
  };

  const handleImport = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await call("preset.import", cwd ? { json: pasted, cwd } : { json: pasted });
      setResult(response as ImportResult);
      // Apply the renderer half, so the imported look takes effect immediately.
      try {
        const appearance = (JSON.parse(pasted) as { appearance?: { theme?: string; language?: string } }).appearance;
        if (appearance?.theme) {
          writeStoredTheme(appearance.theme);
          onAppearanceChange?.({ theme: appearance.theme });
        }
        if (appearance?.language === "zh-CN" || appearance?.language === "en-US") {
          setLanguage(appearance.language);
          onAppearanceChange?.({ language: appearance.language });
        }
      } catch {
        // The host already validated the JSON; a missing appearance is fine.
      }
    } catch (cause) {
      setError(String(rpcErrorBody(cause).error ?? cause));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!exported) return;
    const blob = new Blob([exported], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pi-worktable-preset-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "0 4px 24px" }}>
      <section style={{ maxWidth: 680 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>{t("presets", "Presets")}</h2>
        <p style={{ margin: "6px 0 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "presetsDescription",
            "Share this setup, or bring one over: agents, MCP endpoints, gate rules, theme and language. Secrets are not included.",
          )}
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void handleExport()} disabled={busy} style={BUTTON_STYLE}>
            {t("presetExport", "Export")}
          </button>
          {exported && (
            <>
              <button type="button" onClick={() => void handleCopy()} style={BUTTON_STYLE}>
                {copied ? t("copied", "Copied") : t("copy", "Copy")}
              </button>
              <button type="button" onClick={download} style={BUTTON_STYLE}>
                {t("download", "Download")}
              </button>
              {counts && (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  {counts.agents} {t("agents", "agents")} · {counts.mcpServers} MCP
                </span>
              )}
            </>
          )}
        </div>

        {exported && (
          <textarea
            readOnly
            value={exported}
            spellCheck={false}
            style={{ ...TEXTAREA_STYLE, marginTop: 10, height: 180 }}
            aria-label={t("presetExport", "Export")}
          />
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "22px 0" }} />

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={busy || pasted.trim().length === 0}
            style={{ ...BUTTON_STYLE, opacity: busy || pasted.trim().length === 0 ? 0.5 : 1 }}
          >
            {t("presetImport", "Import")}
          </button>
          <label style={{ ...BUTTON_STYLE, cursor: "pointer" }}>
            {t("presetChooseFile", "Choose file…")}
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => setPasted(text));
                event.target.value = "";
              }}
            />
          </label>
          <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
            {t("presetImportHint", "Paste a preset below, or pick a file")}
          </span>
        </div>

        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          spellCheck={false}
          placeholder="{ ... }"
          style={{ ...TEXTAREA_STYLE, marginTop: 10, height: 140 }}
          aria-label={t("presetImport", "Import")}
        />

        {error && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)" }}>{error}</div>}

        {result && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--panel-color)",
              fontSize: 11.5,
              lineHeight: 1.7,
              color: "var(--text)",
            }}
          >
            <div>
              {t("presetApplied", "Applied")}: {result.applied.agentsAdded} {t("agents", "agents")},{" "}
              {result.applied.mcpAdded} MCP
            </div>
            {result.warnings.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--amber)" }}>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 32,
  padding: "0 12px",
  background: "var(--control-chip-bg)",
  border: "1px solid var(--control-chip-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--control-chip-fg)",
  fontSize: 12.5,
  cursor: "pointer",
};

const TEXTAREA_STYLE: React.CSSProperties = {
  width: "100%",
  padding: 10,
  background: "var(--code-bg)",
  color: "var(--code-text)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  lineHeight: 1.5,
  resize: "vertical",
};
