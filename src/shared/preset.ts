/**
 * Preset files: the portable half of "how I have this set up".
 *
 * A preset carries agent definitions, appearance, the Jev gate rules and MCP
 * server endpoints. Secrets are deliberately dropped on both ends — an MCP token
 * or an API key must never end up in a file people paste into a chat.
 */
export const PRESET_KIND = "pi-worktable-preset";
export const PRESET_VERSION = 1;

export interface PresetAgent {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  tools?: string[];
}

export interface PresetMcpServer {
  name: string;
  transport: "direct" | "proxy";
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  /** Kept so an import can tell the user to re-add secrets by hand. */
  hadSecrets?: boolean;
}

export interface WorktablePreset {
  kind: typeof PRESET_KIND;
  version: number;
  exportedAt: string;
  appearance?: { theme?: string; language?: string };
  agents?: PresetAgent[];
  mcpServers?: PresetMcpServer[];
  jev?: Record<string, unknown>;
  toolPreset?: string;
}

export type ParsePresetResult =
  { ok: true; preset: WorktablePreset; warnings: string[] } | { ok: false; error: string };

const SECRET_KEY = /(secret|token|key|password|authorization|auth)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Keep only the fields a preset may carry, and note when secrets were dropped. */
export function sanitizeMcpServer(raw: unknown): PresetMcpServer | null {
  if (!isRecord(raw)) return null;
  const name = nonEmptyString(raw.name);
  if (!name) return null;
  const transport = raw.transport === "proxy" ? "proxy" : "direct";
  const url = nonEmptyString(raw.url) ?? undefined;
  const command = nonEmptyString(raw.command) ?? undefined;
  const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : undefined;
  if (!url && !command) return null;

  const env = isRecord(raw.env) ? raw.env : undefined;
  const headers = isRecord(raw.headers) ? raw.headers : undefined;
  const hasSecrets = Boolean(
    (env && Object.keys(env).length > 0) ||
    (headers && Object.keys(headers).length > 0) ||
    Object.keys(raw).some((key) => SECRET_KEY.test(key) && nonEmptyString(raw[key])),
  );

  return {
    name,
    transport,
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(hasSecrets ? { hadSecrets: true } : {}),
  };
}

export function sanitizeAgent(raw: unknown): PresetAgent | null {
  if (!isRecord(raw)) return null;
  const name = nonEmptyString(raw.name);
  const systemPrompt = nonEmptyString(raw.systemPrompt) ?? nonEmptyString(raw.prompt);
  if (!name || !systemPrompt) return null;
  const model = nonEmptyString(raw.model) ?? undefined;
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((tool): tool is string => typeof tool === "string")
    : undefined;
  return {
    name,
    description: nonEmptyString(raw.description) ?? "",
    systemPrompt,
    ...(model ? { model } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
  };
}

export function parsePreset(text: string): ParsePresetResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON" };
  }
  if (!isRecord(raw)) return { ok: false, error: "A preset must be a JSON object" };
  if (raw.kind !== PRESET_KIND) return { ok: false, error: `Not a ${PRESET_KIND} file` };

  const version = typeof raw.version === "number" ? raw.version : NaN;
  if (!Number.isFinite(version) || version < 1) return { ok: false, error: "The preset has no version" };
  if (version > PRESET_VERSION) {
    return {
      ok: false,
      error: `The preset is version ${String(version)}, this build understands ${String(PRESET_VERSION)}`,
    };
  }

  const warnings: string[] = [];
  const agents: PresetAgent[] = [];
  if (Array.isArray(raw.agents)) {
    raw.agents.forEach((candidate, index) => {
      const agent = sanitizeAgent(candidate);
      if (agent) agents.push(agent);
      else warnings.push(`agent #${String(index + 1)} was skipped (needs a name and a prompt)`);
    });
  }

  const mcpServers: PresetMcpServer[] = [];
  if (Array.isArray(raw.mcpServers)) {
    raw.mcpServers.forEach((candidate, index) => {
      const server = sanitizeMcpServer(candidate);
      if (!server) {
        warnings.push(`MCP server #${String(index + 1)} was skipped (needs a name and a url or command)`);
        return;
      }
      if (server.hadSecrets)
        warnings.push(`${server.name}: secrets are not carried by presets, re-add them after import`);
      mcpServers.push(server);
    });
  }

  const appearance = isRecord(raw.appearance)
    ? {
        ...(nonEmptyString(raw.appearance.theme) ? { theme: nonEmptyString(raw.appearance.theme) as string } : {}),
        ...(nonEmptyString(raw.appearance.language)
          ? { language: nonEmptyString(raw.appearance.language) as string }
          : {}),
      }
    : undefined;

  return {
    ok: true,
    warnings,
    preset: {
      kind: PRESET_KIND,
      version: PRESET_VERSION,
      exportedAt: nonEmptyString(raw.exportedAt) ?? new Date(0).toISOString(),
      ...(appearance && Object.keys(appearance).length > 0 ? { appearance } : {}),
      ...(agents.length > 0 ? { agents } : {}),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
      ...(isRecord(raw.jev) ? { jev: raw.jev } : {}),
      ...(nonEmptyString(raw.toolPreset) ? { toolPreset: nonEmptyString(raw.toolPreset) as string } : {}),
    },
  };
}

/** Stable, human-diffable JSON: presets end up in git and in chat messages. */
export function presetToJson(preset: WorktablePreset): string {
  return `${JSON.stringify(preset, null, 2)}\n`;
}
