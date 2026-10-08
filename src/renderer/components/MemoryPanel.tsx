import { useCallback, useEffect, useState } from "react";
import { addMemory, listMemory, removeMemory } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import type { MemoryEntry } from "@contract/types";

/**
 * The project memory the agent records with the `memory` tool. Everything here
 * is injected into every session's system prompt.
 */
export function MemoryPanel({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const { entries: listed } = await listMemory(cwd);
      setEntries(listed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || !cwd) return;
    setDraft("");
    try {
      const { entry } = await addMemory(cwd, text);
      setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd, draft]);

  const forget = useCallback(
    async (entry: MemoryEntry) => {
      if (!cwd) return;
      setBusyId(entry.id);
      try {
        await removeMemory(cwd, entry.id);
        setEntries((current) => current.filter((item) => item.id !== entry.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [cwd],
  );

  if (!cwd) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>
        {t("memoryNoProject", "Open a project to see what it remembers.")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={t("memoryAddPlaceholder", "Remember something…")}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 8px",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim()}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-hover)",
            color: "var(--text)",
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          {t("memoryAdd", "Remember")}
        </button>
      </div>

      {error && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--danger)" }} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>{t("loading", "Loading…")}</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
          {t(
            "memoryEmpty",
            "Nothing remembered yet. The agent records durable facts with the `memory` tool; they are injected into every session in this project.",
          )}
        </div>
      ) : (
        <div
          style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}
        >
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                opacity: busyId === entry.id ? 0.6 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {entry.tag && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      marginRight: 6,
                      borderRadius: 999,
                      background: "var(--bg-subtle)",
                      color: "var(--text-dim)",
                    }}
                  >
                    {entry.tag}
                  </span>
                )}
                <span style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>{entry.text}</span>
              </div>
              <button
                type="button"
                onClick={() => void forget(entry)}
                title={t("memoryForget", "Forget this")}
                style={{
                  flexShrink: 0,
                  padding: "2px 7px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--danger)",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
