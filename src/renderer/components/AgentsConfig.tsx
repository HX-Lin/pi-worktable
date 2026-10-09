import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionTitle } from "./form-controls";
import { useI18n } from "@/i18n";
import { call, listModels } from "@/lib/api-client";
import { pushToast } from "@/lib/toast-store";
import type { AgentInfo } from "@contract/types";

interface Props {
  cwd: string | null;
}

/**
 * Agent definitions used by the `subagent` tool. Each one may pin a model;
 * clearing the picker makes it inherit the caller's model.
 */
export function AgentsConfig({ cwd }: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [draft, setDraft] = useState<{ templateId: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listed, catalog, templateList] = await Promise.all([
        call("agents.list", cwd ? { cwd, scope: "both" } : { scope: "both" }),
        listModels(cwd ?? undefined).catch(() => null),
        call("agents.templates").catch(() => null),
      ]);
      setTemplates(templateList?.templates ?? []);
      setAgents(listed.agents);
      setModels(catalog ? [...new Set(catalog.models.map((model) => `${model.provider}/${model.id}`))].sort() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeModel = useCallback(async (agent: AgentInfo, model: string) => {
    setBusyFile(agent.filePath);
    setError(null);
    try {
      await call("agents.setModel", { filePath: agent.filePath, model: model || null });
      setAgents((current) =>
        current.map((entry) => (entry.filePath === agent.filePath ? { ...entry, model: model || undefined } : entry)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(null);
    }
  }, []);

  const createFromTemplate = useCallback(async () => {
    if (!draft) return;
    setCreating(true);
    setError(null);
    try {
      await call("agents.create", { templateId: draft.templateId, name: draft.name, cwd: cwd ?? undefined });
      pushToast({ level: "success", text: `Created agent "${draft.name}"` });
      setDraft(null);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      pushToast({ level: "error", text: "Could not create that agent", detail: message });
    } finally {
      setCreating(false);
    }
  }, [cwd, draft, load]);

  // A pinned model that is no longer configured must still be selectable.
  const optionsFor = useMemo(
    () => (agent: AgentInfo) => (agent.model && !models.includes(agent.model) ? [agent.model, ...models] : models),
    [models],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionTitle>{t("agentsTitle", "Agents")}</SectionTitle>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        {t(
          "agentsDescription",
          "Agents the subagent tool can delegate to. Definitions live in ~/.pi/agent/agents and <project>/.pi/agents as markdown files with frontmatter; the body becomes the agent's system prompt.",
        )}
      </p>

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)", padding: "7px 9px", background: "var(--bg-panel)" }}>
          {error}
        </div>
      )}

      {templates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("agentTemplates", "Start from a template")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                title={template.description}
                onClick={() => setDraft({ templateId: template.id, name: template.name })}
                style={{
                  padding: "5px 10px",
                  fontSize: 11.5,
                  borderRadius: "var(--radius-sm)",
                  background: draft?.templateId === template.id ? "var(--accent-soft)" : "var(--bg-panel)",
                  color: draft?.templateId === template.id ? "var(--accent)" : "var(--text-muted)",
                  border: `1px solid ${
                    draft?.templateId === template.id
                      ? "color-mix(in srgb, var(--accent) 45%, transparent)"
                      : "var(--border)"
                  }`,
                  cursor: "pointer",
                }}
              >
                {template.name}
              </button>
            ))}
          </div>
          {draft && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createFromTemplate();
                  if (event.key === "Escape") setDraft(null);
                }}
                aria-label={t("agentName", "Agent name")}
                placeholder={t("agentName", "Agent name")}
                autoFocus
                style={{
                  width: 200,
                  padding: "5px 8px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--view-bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              />
              <button
                type="button"
                disabled={creating || draft.name.trim().length === 0}
                onClick={() => void createFromTemplate()}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  border: "none",
                  cursor: creating ? "default" : "pointer",
                  opacity: creating || draft.name.trim().length === 0 ? 0.6 : 1,
                }}
              >
                {creating ? t("creating", "Creating…") : t("createAgent", "Create")}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-panel)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                {t("cancelCreate", "Cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("loading", "Loading…")}</div>
      ) : agents.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {t("agentsEmpty", "No agents found. Add a markdown file to ~/.pi/agent/agents to create one.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agents.map((agent) => (
            <div
              key={agent.filePath}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{agent.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "var(--bg-subtle)",
                      color: "var(--text-dim)",
                    }}
                  >
                    {agent.source === "project" ? t("agentsProject", "project") : t("agentsUser", "user")}
                  </span>
                  {agent.tools && agent.tools.length > 0 && (
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                      {agent.tools.length} {t("agentsTools", "tools")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{agent.description}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", wordBreak: "break-all" }}>{agent.filePath}</div>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("agentsModel", "Model")}</span>
                <select
                  value={agent.model ?? ""}
                  disabled={busyFile === agent.filePath}
                  onChange={(e) => void changeModel(agent, e.target.value)}
                  style={{
                    minWidth: 220,
                    padding: "5px 7px",
                    fontSize: 11,
                    borderRadius: "var(--radius-sm)",
                    background: "var(--view-bg)",
                    color: agent.model ? "var(--text)" : "var(--text-dim)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <option value="">{t("agentsInherit", "inherit from caller")}</option>
                  {optionsFor(agent).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
