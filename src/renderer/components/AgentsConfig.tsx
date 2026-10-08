import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionTitle } from "./form-controls";
import { useI18n } from "@/i18n";
import { call, listModels } from "@/lib/api-client";
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listed, catalog] = await Promise.all([
        call("agents.list", cwd ? { cwd, scope: "both" } : { scope: "both" }),
        listModels(cwd ?? undefined).catch(() => null),
      ]);
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

  // A pinned model that is no longer configured must still be selectable.
  const optionsFor = useMemo(
    () => (agent: AgentInfo) => (agent.model && !models.includes(agent.model) ? [agent.model, ...models] : models),
    [models],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionTitle>{t("agentsTitle", "Agents")}</SectionTitle>
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-muted)", lineHeight: 1.6 }}>
        {t(
          "agentsDescription",
          "Agents the subagent tool can delegate to. Definitions live in ~/.pi/agent/agents and <project>/.pi/agents as markdown files with frontmatter; the body becomes the agent's system prompt.",
        )}
      </p>

      {error && (
        <div
          style={{
            fontSize: "var(--text-md)",
            color: "var(--danger)",
            padding: "7px 9px",
            background: "var(--bg-panel)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: "var(--text-md)", color: "var(--text-dim)" }}>{t("loading", "Loading…")}</div>
      ) : agents.length === 0 ? (
        <div style={{ fontSize: "var(--text-md)", color: "var(--text-dim)" }}>
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
                  <span style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>{agent.name}</span>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "var(--bg-subtle)",
                      color: "var(--text-dim)",
                    }}
                  >
                    {agent.source === "project" ? t("agentsProject", "project") : t("agentsUser", "user")}
                  </span>
                  {agent.tools && agent.tools.length > 0 && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                      {agent.tools.length} {t("agentsTools", "tools")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {agent.description}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", wordBreak: "break-all" }}>
                  {agent.filePath}
                </div>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                  {t("agentsModel", "Model")}
                </span>
                <select
                  value={agent.model ?? ""}
                  disabled={busyFile === agent.filePath}
                  onChange={(e) => void changeModel(agent, e.target.value)}
                  style={{
                    minWidth: 220,
                    padding: "5px 7px",
                    fontSize: "var(--text-sm)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg)",
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
