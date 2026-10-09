import { useEffect, useState } from "react";

import { API_OPTIONS } from "./shared";
import { Field, SecretTextInput, Select, SectionTitle, TextInput } from "@/components/form-controls";

import { type ProviderEntry } from "@/lib/models-config-state";

export function ProviderDetail({
  name,
  provider,
  onChange,
  onRename,
  onDelete,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(name);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial provider load intentionally runs once.
  }, [provider.api]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>Provider</SectionTitle>
        <button
          type="button"
          onClick={onDelete}
          style={{
            minHeight: 32,
            padding: "0 10px",
            background: "none",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--danger)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Delete
        </button>
      </div>

      <Field label="Provider name">
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button
            type="button"
            onClick={() => onRename(editingName.trim())}
            style={{
              marginTop: 4,
              minHeight: 32,
              padding: "0 12px",
              background: "var(--accent)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: "var(--on-accent)",
              cursor: "pointer",
              fontSize: 12,
              alignSelf: "flex-start",
            }}
          >
            Rename
          </button>
        )}
      </Field>

      <Field label="Base URL">
        <TextInput
          value={provider.baseUrl ?? ""}
          onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1"
          mono
        />
      </Field>

      <Field label="API Key">
        <SecretTextInput
          value={provider.apiKey ?? ""}
          onChange={(v) => set("apiKey", v || undefined)}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key"
          mono
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Prefix with <code style={{ fontFamily: "var(--font-mono)" }}>!</code> to run a shell command, or use an env
          var name
        </span>
      </Field>

      <Field label="API">
        <Select
          value={provider.api ?? "openai-completions"}
          onChange={(v) => set("api", v)}
          options={API_OPTIONS}
          required
        />
      </Field>
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────
