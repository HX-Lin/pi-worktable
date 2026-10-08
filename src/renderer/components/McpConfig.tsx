/**
 * MCP servers: what the agent can call besides its own tools.
 *
 * The list is the two `mcp.json` files pi reads (global in the agent directory, project in
 * `.pi/mcp.json`), with the project entry winning per name. Adding, editing and removing writes
 * those files directly, so the section works even in the self-contained hot-update runtime. Live
 * operations that need a real connection — checking a server and signing in through OAuth — go
 * through pi's own `pi mcp` command, which is available whenever the package is on disk.
 */
import { useCallback, useEffect, useState } from "react";
import type { McpConfigPayload, McpExposurePayload, McpScopePayload, McpServerPayload } from "@shared/api-types";
import { useI18n } from "@/i18n";
import {
  mcpGetConfig,
  mcpPatchServer,
  mcpRemoveServer,
  mcpRunCommand,
  mcpSetAutoEnableCodemode,
  mcpSetServer,
} from "@/lib/api-client";

const EXPOSURES: McpExposurePayload[] = ["codemode", "deferred", "direct", "hidden"];

const inputStyle: React.CSSProperties = {
  background: "var(--sunken-bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  font: "inherit",
  fontSize: "var(--text-md)",
  padding: "5px 8px",
  minWidth: 0,
  flex: 1,
};

const selectStyle: React.CSSProperties = { ...inputStyle, flex: "0 0 auto" };
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

export function McpConfig({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<McpConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", target: "", url: false, scope: "global" as McpScopePayload });

  const load = useCallback(async () => {
    try {
      setConfig(await mcpGetConfig(cwd));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every mutation returns the fresh view, so the list never goes stale. */
  const run = useCallback(async (action: () => Promise<McpConfigPayload>) => {
    setBusy(true);
    try {
      setConfig(await action());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const runCommand = useCallback(
    async (args: string[]) => {
      setBusy(true);
      setOutput(`${t("mcpRunning", "Running")} pi mcp ${args.join(" ")}…`);
      try {
        const result = await mcpRunCommand(args, cwd);
        setOutput([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") || `exit ${result.code}`);
        setError(result.code === 0 ? null : `pi mcp ${args.join(" ")} exited ${result.code}`);
      } catch (e) {
        setOutput(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [cwd, t],
  );

  const addServer = useCallback(async () => {
    const name = draft.name.trim();
    const target = draft.target.trim();
    if (!name || !target) return;
    let config: Record<string, unknown>;
    if (draft.url) {
      config = { url: target };
    } else {
      const [command, ...args] = target.split(/\s+/u);
      config = { command, ...(args.length > 0 ? { args } : {}) };
    }
    await run(() => mcpSetServer(name, config, draft.scope, cwd));
    setDraft({ name: "", target: "", url: draft.url, scope: draft.scope });
  }, [draft, cwd, run]);

  if (!cwd) {
    return (
      <div style={{ padding: "28px clamp(18px, 5vw, 52px)", color: "var(--text-muted)" }}>
        {t("mcpNeedsProject", "Open a project to manage its MCP servers.")}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "28px clamp(18px, 5vw, 52px)" }}>
      <Section
        title={t("mcpTitle", "MCP servers")}
        description={t(
          "mcpDescription",
          "Model Context Protocol servers add tools to the agent. Tools are reached through the codemode script tool by default, and every call passes the same permission gate as the built-in tools.",
        )}
      >
        {config ? (
          <>
            <Row label={t("mcpGlobalFile", "Global file")}>
              <code style={codeStyle}>{config.globalPath}</code>
            </Row>
            <Row label={t("mcpProjectFile", "Project file")}>
              <code style={codeStyle}>
                {config.projectPath}
                {config.projectExists ? "" : ` ${t("mcpFileMissing", "(not created yet)")}`}
              </code>
            </Row>
            <Row label={t("mcpAutoCodemode", "Activate codemode for connected servers")}>
              <Checkbox
                checked={config.autoEnableCodemode}
                disabled={busy}
                onChange={(value) => void run(() => mcpSetAutoEnableCodemode(value, "global", cwd))}
              />
            </Row>
            {!config.cliAvailable && (
              <p style={hintStyle}>
                {t(
                  "mcpCliMissing",
                  "pi's own mcp command is not available in this build, so live checks and sign-in are disabled; the files are still editable.",
                )}
              </p>
            )}
          </>
        ) : (
          <p style={hintStyle}>{error ?? t("loading", "Loading…")}</p>
        )}
      </Section>

      <Divider />

      <Section title={t("mcpServers", "Servers")}>
        {config && config.errors.length > 0 && (
          <pre style={{ ...codeStyle, whiteSpace: "pre-wrap", color: "var(--danger)" }}>{config.errors.join("\n")}</pre>
        )}
        {config?.servers.length === 0 && (
          <p style={hintStyle}>{t("mcpNoServers", "No MCP servers yet. Add one below.")}</p>
        )}
        {config?.servers.map((server) => (
          <ServerRow
            key={`${server.scope}/${server.name}`}
            server={server}
            busy={busy}
            cliAvailable={config.cliAvailable}
            onPatch={(patch) => void run(() => mcpPatchServer(server.name, patch, server.scope, cwd))}
            onRemove={() => void run(() => mcpRemoveServer(server.name, server.scope, cwd))}
            onCheck={() => void runCommand(["list", "--json"])}
            onLogin={() => void runCommand(["login", server.name])}
            onLogout={() => void runCommand(["logout", server.name])}
          />
        ))}
      </Section>

      <Divider />

      <Section title={t("mcpAddServer", "Add a server")}>
        <Row label={t("mcpName", "Name")}>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="sentry"
            style={inputStyle}
            spellCheck={false}
          />
        </Row>
        <Row label={draft.url ? t("mcpUrl", "URL") : t("mcpCommand", "Command")}>
          <input
            value={draft.target}
            onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            placeholder={draft.url ? "https://mcp.example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem ."}
            style={inputStyle}
            spellCheck={false}
          />
        </Row>
        <Row label={t("mcpTransport", "Transport")}>
          <select
            value={draft.url ? "http" : "stdio"}
            onChange={(event) => setDraft({ ...draft, url: event.target.value === "http" })}
            style={selectStyle}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </Row>
        <Row label={t("mcpScope", "Write to")}>
          <select
            value={draft.scope}
            onChange={(event) => setDraft({ ...draft, scope: event.target.value as McpScopePayload })}
            style={selectStyle}
          >
            <option value="global">{t("mcpScopeGlobal", "global mcp.json")}</option>
            <option value="project">{t("mcpScopeProject", "project .pi/mcp.json")}</option>
          </select>
        </Row>
        <Row label="">
          <button
            type="button"
            onClick={() => void addServer()}
            disabled={busy || !draft.name.trim() || !draft.target.trim()}
            style={buttonStyle}
          >
            {t("mcpAdd", "Add")}
          </button>
        </Row>
      </Section>

      {output !== null && (
        <>
          <Divider />
          <Section title={t("mcpOutput", "Command output")}>
            <pre style={{ ...codeStyle, whiteSpace: "pre-wrap" }}>{output}</pre>
          </Section>
        </>
      )}

      {error && <p style={{ ...hintStyle, color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function ServerRow({
  server,
  busy,
  cliAvailable,
  onPatch,
  onRemove,
  onCheck,
  onLogin,
  onLogout,
}: {
  server: McpServerPayload;
  busy: boolean;
  cliAvailable: boolean;
  onPatch: (patch: { enabled?: boolean; exposure?: McpExposurePayload; description?: string | null }) => void;
  onRemove: () => void;
  onCheck: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(server.description ?? "");
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "12px 0", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Checkbox checked={server.enabled} disabled={busy} onChange={(value) => onPatch({ enabled: value })} />
        <strong style={{ fontSize: "var(--text-base)" }}>{server.name}</strong>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>
          {server.scope === "project" ? t("mcpScopeProjectBadge", "project") : t("mcpScopeGlobalBadge", "global")}
          {server.overridesGlobal ? ` · ${t("mcpOverrides", "overrides global")}` : ""} · {server.transport}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onRemove} disabled={busy} style={buttonStyle}>
          {t("mcpRemove", "Remove")}
        </button>
      </div>
      <code style={{ ...codeStyle, wordBreak: "break-all" }}>{server.target}</code>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {t("mcpExposure", "Tools reach the model as")}
        </span>
        <select
          value={server.exposure}
          disabled={busy}
          onChange={(event) => onPatch({ exposure: event.target.value as McpExposurePayload })}
          style={selectStyle}
        >
          {EXPOSURES.map((exposure) => (
            <option key={exposure} value={exposure}>
              {exposure}
            </option>
          ))}
        </select>
        <input
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== (server.description ?? "")) onPatch({ description });
          }}
          placeholder={t("mcpDescriptionPlaceholder", "one line about what this server offers")}
          style={{ ...inputStyle, minWidth: 220 }}
          spellCheck={false}
        />
        {cliAvailable && (
          <>
            <button type="button" onClick={onCheck} disabled={busy} style={buttonStyle}>
              {t("mcpCheck", "Check")}
            </button>
            <button type="button" onClick={onLogin} disabled={busy || server.transport !== "http"} style={buttonStyle}>
              {t("mcpSignIn", "Sign in")}
            </button>
            <button type="button" onClick={onLogout} disabled={busy || server.transport !== "http"} style={buttonStyle}>
              {t("mcpSignOut", "Sign out")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  background: "var(--sunken-bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-muted)",
  fontSize: "var(--text-sm)",
  padding: "4px 8px",
};
const hintStyle: React.CSSProperties = { color: "var(--text-dim)", fontSize: "var(--text-sm)", margin: "6px 0 0" };

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
    <div style={{ display: "flex", gap: 12, alignItems: "center", minHeight: 28 }}>
      <span style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", minWidth: 160 }}>{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "20px 0" }} />;
}

function Checkbox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      style={{ cursor: disabled ? "default" : "pointer" }}
    />
  );
}
