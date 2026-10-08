/**
 * What the agent can actually do right now.
 *
 * Tools, Skills, Plugins, MCP and Jev each own a page of their own, which makes the whole picture
 * hard to assemble: is codemode on, which MCP servers are connected, what does the gate let through?
 * This panel is read-only and answers exactly that, from the same RPCs those pages use.
 */
import { useCallback, useEffect, useState } from "react";
import type { JevConfigPayload, McpConfigPayload } from "@shared/api-types";
import { useI18n } from "@/i18n";
import { sendAgentCommand } from "@/lib/agent-client";
import { jevGetConfig, mcpGetConfig } from "@/lib/api-client";

interface ToolEntry {
  name: string;
  description?: string;
  active: boolean;
}

/** Tools the desktop always registers, so a missing one is worth pointing out. */
const NOTABLE_TOOLS = ["codemode", "tool_search"];

export function CapabilitiesPanel({ sessionId, cwd }: { sessionId: string | null; cwd: string | null }) {
  const { t } = useI18n();
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [mcp, setMcp] = useState<McpConfigPayload | null>(null);
  const [jev, setJev] = useState<JevConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    if (sessionId) {
      try {
        const list = await sendAgentCommand<ToolEntry[]>(sessionId, { type: "get_tools" });
        setTools(Array.isArray(list) ? list : []);
      } catch (e) {
        setTools(null);
        failures.push(e instanceof Error ? e.message : String(e));
      }
    } else {
      setTools(null);
    }
    try {
      setMcp(await mcpGetConfig(cwd));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
    try {
      setJev(await jevGetConfig());
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
    setError(failures.length > 0 ? failures.join(" · ") : null);
    setBusy(false);
  }, [sessionId, cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTools = tools?.filter((tool) => tool.active) ?? [];
  const inactiveTools = tools?.filter((tool) => !tool.active) ?? [];
  const codemodeActive = activeTools.some((tool) => tool.name === "codemode");
  const mcpServers = mcp?.servers ?? [];
  const mcpEnabled = mcpServers.filter((server) => server.enabled);

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "28px clamp(18px, 5vw, 52px)" }}>
      <Section
        title={t("capabilitiesTitle", "Capabilities")}
        description={t(
          "capabilitiesDescription",
          "A read-only summary of what the agent can use in this session, and what the gate does with it.",
        )}
      >
        <Row label="">
          <button type="button" onClick={() => void load()} disabled={busy} style={buttonStyle}>
            {busy ? t("capabilitiesRefreshing", "Refreshing…") : t("capabilitiesRefresh", "Refresh")}
          </button>
        </Row>
      </Section>

      <Divider />

      <Section
        title={t("capabilitiesTools", "Tools")}
        description={
          sessionId
            ? t("capabilitiesToolsHint", "Active tools are declared to the model; the rest stay callable from scripts.")
            : t("capabilitiesNeedsSession", "Open a session to see its tool set.")
        }
      >
        {tools ? (
          <>
            <Row label={t("capabilitiesActiveCount", "Active")}>
              <span style={valueStyle}>
                {activeTools.length} / {tools.length}
              </span>
            </Row>
            <Row label={t("capabilitiesCodemode", "codemode")}>
              <span style={{ ...valueStyle, color: codemodeActive ? "var(--accent)" : "var(--text-muted)" }}>
                {codemodeActive
                  ? t("capabilitiesOn", "active — the model can run scripts that call other tools")
                  : t("capabilitiesCodemodeOff", "inactive — enable it in Tools, or it turns on with MCP")}
              </span>
            </Row>
            <Row label={t("capabilitiesActiveList", "Active tools")}>
              <span style={valueStyle}>{activeTools.map((tool) => tool.name).join(", ") || "—"}</span>
            </Row>
            {inactiveTools.length > 0 && (
              <>
                <Row label="">
                  <button type="button" onClick={() => setShowInactive((value) => !value)} style={buttonStyle}>
                    {showInactive
                      ? t("capabilitiesHideInactive", "Hide inactive tools")
                      : t("capabilitiesShowInactive", "Show inactive tools ({count})").replace(
                          "{count}",
                          String(inactiveTools.length),
                        )}
                  </button>
                </Row>
                {showInactive && (
                  <ul style={listStyle}>
                    {inactiveTools.map((tool) => (
                      <li key={tool.name}>
                        <code style={codeStyle}>{tool.name}</code>
                        {tool.description ? ` — ${tool.description}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        ) : (
          <p style={hintStyle}>{t("capabilitiesNoTools", "Tool information is not available right now.")}</p>
        )}
      </Section>

      <Divider />

      <Section
        title={t("capabilitiesMcp", "MCP servers")}
        description={t(
          "capabilitiesMcpHint",
          "Every MCP call goes through the same permission gate as the built-in tools.",
        )}
      >
        {mcpServers.length === 0 ? (
          <p style={hintStyle}>{t("capabilitiesNoMcp", "No MCP servers configured (Settings → MCP).")}</p>
        ) : (
          <>
            <Row label={t("capabilitiesMcpEnabled", "Enabled")}>
              <span style={valueStyle}>
                {mcpEnabled.length} / {mcpServers.length}
              </span>
            </Row>
            <ul style={listStyle}>
              {mcpServers.map((server) => (
                <li key={`${server.scope}/${server.name}`}>
                  <code style={codeStyle}>{server.name}</code>{" "}
                  <span style={{ color: "var(--text-dim)" }}>
                    {server.transport} · {server.exposure} · {server.scope}
                    {server.enabled ? "" : ` · ${t("capabilitiesDisabled", "disabled")}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {NOTABLE_TOOLS.some((name) => tools?.some((tool) => tool.name === name)) && (
          <p style={hintStyle}>
            {t(
              "capabilitiesBuiltins",
              "codemode, tool_search and the MCP client are built into this build; llama.cpp is deliberately not loaded.",
            )}
          </p>
        )}
      </Section>

      <Divider />

      <Section
        title={t("capabilitiesGate", "Permission gate")}
        description={t(
          "capabilitiesGateHint",
          "Jev rates each tool call; the gate blocks, asks or allows it before it runs.",
        )}
      >
        {jev ? (
          <>
            <Row label={t("capabilitiesGateState", "Gate")}>
              <span style={valueStyle}>
                {!jev.settings.enabled
                  ? t("capabilitiesOff", "off (Jev disabled)")
                  : jev.settings.gate.enabled
                    ? t("capabilitiesGateOn", "on · scope {scope} · middle band: {uncertain}")
                        .replace("{scope}", jev.settings.gate.scope)
                        .replace("{uncertain}", jev.settings.gate.uncertain)
                    : t("capabilitiesGateDisabled", "off (tool calls run ungated)")}
              </span>
            </Row>
            <Row label={t("capabilitiesClassifier", "Classifier")}>
              <span style={valueStyle}>{jev.settings.classifier ?? "jev/jev-1.13-free"}</span>
            </Row>
            <Row label={t("capabilitiesCompaction", "Compaction")}>
              <span style={valueStyle}>
                {jev.settings.compaction.enabled ? t("capabilitiesOnShort", "on") : t("capabilitiesOffShort", "off")}
              </span>
            </Row>
            <Row label={t("capabilitiesRouting", "Model routing")}>
              <span style={valueStyle}>
                {jev.settings.routing.mode === "jev"
                  ? t("capabilitiesRoutingOn", "jev/auto decides per session")
                  : t("capabilitiesRoutingOff", "off (the model you pick is used)")}
              </span>
            </Row>
            {jev.settings.gate.enabled && (
              <p style={hintStyle}>
                {t(
                  "capabilitiesGateRuleCount",
                  "{count} rules carry a custom threshold; the rest use the calibrated defaults.",
                ).replace("{count}", String(Object.keys(jev.settings.gate.thresholds).length))}
              </p>
            )}
          </>
        ) : (
          <p style={hintStyle}>{t("capabilitiesNoGate", "Jev configuration is not available right now.")}</p>
        )}
      </Section>

      {error && <p style={{ ...hintStyle, color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

const valueStyle: React.CSSProperties = {
  fontSize: "var(--text-md)",
  color: "var(--text)",
  minWidth: 0,
  wordBreak: "break-word",
};
const hintStyle: React.CSSProperties = { color: "var(--text-dim)", fontSize: "var(--text-sm)", margin: "6px 0 0" };
const codeStyle: React.CSSProperties = {
  background: "var(--sunken-bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
  padding: "2px 6px",
};
const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: "grid",
  gap: 5,
  fontSize: "var(--text-md)",
  color: "var(--text-muted)",
};
const buttonStyle: React.CSSProperties = {
  background: "var(--sunken-bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  cursor: "pointer",
  font: "inherit",
  fontSize: "var(--text-md)",
  padding: "5px 12px",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div>
        <h3 style={{ fontSize: "var(--text-base)", margin: 0 }}>{title}</h3>
        {description && <p style={{ ...hintStyle, marginTop: 4 }}>{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", minHeight: 26 }}>
      <span style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", minWidth: 160 }}>{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "20px 0" }} />;
}
