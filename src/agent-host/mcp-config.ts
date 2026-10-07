/**
 * MCP server configuration for the desktop.
 *
 * The file format is the `mcpServers` shape shared by other MCP clients, so the desktop reads and
 * writes the same `mcp.json` pi does: the global file in the agent directory and the project file in
 * `<cwd>/.pi/mcp.json`. A project entry replaces the global entry with the same name, and a project
 * entry without `command`, `url`, or `type` overrides only `enabled`, `exposure`, and `toolExposure`.
 *
 * Direct editing keeps the UI working everywhere, including the self-contained hot-update runtime
 * where pi is not on disk. Anything that needs a live connection (checking servers, OAuth sign-in)
 * goes through pi's own `pi mcp` command, which is used when the package is resolvable.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";
export type McpScope = "global" | "project";
export type McpTransport = "stdio" | "http";

/** One server as the settings UI sees it. `config` is the raw entry from the file. */
export interface McpServerRecord {
  name: string;
  /** Which file defines it: the global `mcp.json` or the project one. */
  scope: McpScope;
  transport: McpTransport;
  /** Endpoint for HTTP servers and the command line for stdio ones, for display. */
  target: string;
  enabled: boolean;
  exposure: McpExposure;
  description: string | null;
  /** The raw entry, so an edit round-trips every field the UI does not show. */
  config: Record<string, unknown>;
  /** True when this name also exists in the global file and the project entry overrides it. */
  overridesGlobal: boolean;
}

export interface McpConfigView {
  servers: McpServerRecord[];
  globalPath: string;
  projectPath: string;
  projectExists: boolean;
  /** Global `autoEnableCodemode`; project value wins when the project file sets it. */
  autoEnableCodemode: boolean;
  /** Parse failures and unreadable files, shown next to the list rather than thrown. */
  errors: string[];
  /** Whether pi's `pi mcp` command is available for live checks and sign-in. */
  cliAvailable: boolean;
}

const EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mcpGlobalPath(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, "mcp.json");
}

export function mcpProjectPath(cwd: string): string {
  return path.join(cwd, ".pi", "mcp.json");
}

interface McpFile {
  servers: Record<string, Record<string, unknown>>;
  autoEnableCodemode?: boolean;
  indentation: string;
}

/** Read one `mcp.json`, tolerating a missing file and reporting malformed content. */
export function readMcpFile(filePath: string, errors: string[]): McpFile {
  if (!existsSync(filePath)) return { servers: {}, indentation: "  " };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return { servers: {}, indentation: "  " };
  }
  const indentation = /\n(\s+)"/u.exec(raw)?.[1] ?? "  ";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("the file is not a JSON object");
    const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
    const entries: Record<string, Record<string, unknown>> = {};
    for (const [name, config] of Object.entries(servers)) {
      if (isRecord(config)) entries[name] = config;
      else errors.push(`${filePath}: server "${name}" is not an object`);
    }
    return {
      servers: entries,
      ...(typeof parsed.autoEnableCodemode === "boolean" ? { autoEnableCodemode: parsed.autoEnableCodemode } : {}),
      indentation,
    };
  } catch (error) {
    errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return { servers: {}, indentation };
  }
}

function transportOf(config: Record<string, unknown>): McpTransport {
  if (typeof config.url === "string" && config.url.trim()) return "http";
  if (config.type === "http" || config.type === "sse") return "http";
  return "stdio";
}

function targetOf(config: Record<string, unknown>): string {
  if (typeof config.url === "string" && config.url.trim()) return config.url;
  const command = typeof config.command === "string" ? config.command : "";
  const args = Array.isArray(config.args) ? config.args.filter((a): a is string => typeof a === "string") : [];
  return [command, ...args].filter(Boolean).join(" ") || "(not configured)";
}

function exposureOf(config: Record<string, unknown>): McpExposure {
  return EXPOSURES.includes(config.exposure as McpExposure) ? (config.exposure as McpExposure) : "codemode";
}

/**
 * A project entry that names none of the connection fields only overrides `enabled`, `exposure`, and
 * `toolExposure`; the global entry keeps everything else.
 */
function projectOverridesGlobal(project: Record<string, unknown>, global: Record<string, unknown>): boolean {
  const connects = (config: Record<string, unknown>) =>
    typeof config.command === "string" || typeof config.url === "string" || typeof config.type === "string";
  return !connects(project) && connects(global);
}

/** The global and project servers as one list, with the project entry winning per name. */
export function mergeMcpServers(
  global: Record<string, Record<string, unknown>>,
  project: Record<string, Record<string, unknown>>,
): McpServerRecord[] {
  const record = (
    name: string,
    config: Record<string, unknown>,
    scope: McpScope,
    overridesGlobal: boolean,
  ): McpServerRecord => ({
    name,
    scope,
    transport: transportOf(config),
    target: targetOf(config),
    enabled: config.enabled !== false,
    exposure: exposureOf(config),
    description: typeof config.description === "string" ? config.description : null,
    config,
    overridesGlobal,
  });

  const names = [...new Set([...Object.keys(global), ...Object.keys(project)])].sort((a, b) => a.localeCompare(b));
  return names.map((name) => {
    const globalEntry = global[name];
    const projectEntry = project[name];
    if (projectEntry === undefined) return record(name, globalEntry, "global", false);
    if (globalEntry === undefined) return record(name, projectEntry, "project", false);
    if (projectOverridesGlobal(projectEntry, globalEntry)) {
      return record(name, { ...globalEntry, ...projectEntry }, "project", true);
    }
    return record(name, projectEntry, "project", true);
  });
}

/** Read both files and build the view the settings UI renders. */
export function readMcpConfig(cwd: string, agentDir: string = getAgentDir()): McpConfigView {
  const errors: string[] = [];
  const globalPath = mcpGlobalPath(agentDir);
  const projectPath = mcpProjectPath(cwd);
  const global = readMcpFile(globalPath, errors);
  const project = readMcpFile(projectPath, errors);
  return {
    servers: mergeMcpServers(global.servers, project.servers),
    globalPath,
    projectPath,
    projectExists: existsSync(projectPath),
    autoEnableCodemode: project.autoEnableCodemode ?? global.autoEnableCodemode ?? true,
    errors,
    cliAvailable: piCliPath() !== null,
  };
}

function fileFor(scope: McpScope, cwd: string, agentDir: string): string {
  return scope === "project" ? mcpProjectPath(cwd) : mcpGlobalPath(agentDir);
}

function writeMcpFile(
  filePath: string,
  servers: Record<string, unknown>,
  autoEnableCodemode: boolean | undefined,
  indentation: string,
): void {
  const document: Record<string, unknown> = { mcpServers: servers };
  if (autoEnableCodemode !== undefined) document.autoEnableCodemode = autoEnableCodemode;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, indentation)}\n`, "utf8");
}

/** Add or replace one server in one scope. */
export function setMcpServer(
  cwd: string,
  name: string,
  config: Record<string, unknown>,
  scope: McpScope = "global",
  agentDir: string = getAgentDir(),
): void {
  const filePath = fileFor(scope, cwd, agentDir);
  const errors: string[] = [];
  const file = readMcpFile(filePath, errors);
  if (errors.length > 0) throw new Error(errors[0]);
  writeMcpFile(filePath, { ...file.servers, [name]: config }, file.autoEnableCodemode, file.indentation);
}

/** Change the settings the UI exposes, keeping every other field of the entry. */
export function patchMcpServer(
  cwd: string,
  name: string,
  patch: { enabled?: boolean; exposure?: McpExposure; description?: string | null },
  scope: McpScope = "global",
  agentDir: string = getAgentDir(),
): void {
  const filePath = fileFor(scope, cwd, agentDir);
  const errors: string[] = [];
  const file = readMcpFile(filePath, errors);
  if (errors.length > 0) throw new Error(errors[0]);
  const current = file.servers[name];
  if (!current) throw new Error(`MCP server "${name}" is not defined in ${filePath}`);
  const next = { ...current };
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.exposure !== undefined) next.exposure = patch.exposure;
  if (patch.description !== undefined) {
    if (patch.description === null || patch.description.trim() === "") delete next.description;
    else next.description = patch.description.trim();
  }
  writeMcpFile(filePath, { ...file.servers, [name]: next }, file.autoEnableCodemode, file.indentation);
}

/** Remove one server from one scope; false when that scope did not define it. */
export function removeMcpServer(
  cwd: string,
  name: string,
  scope: McpScope = "global",
  agentDir: string = getAgentDir(),
): boolean {
  const filePath = fileFor(scope, cwd, agentDir);
  const errors: string[] = [];
  const file = readMcpFile(filePath, errors);
  if (errors.length > 0) throw new Error(errors[0]);
  if (!(name in file.servers)) return false;
  const servers = { ...file.servers };
  delete servers[name];
  writeMcpFile(filePath, servers, file.autoEnableCodemode, file.indentation);
  return true;
}

/** Set the global `autoEnableCodemode` switch. */
export function setAutoEnableCodemode(
  cwd: string,
  value: boolean,
  scope: McpScope = "global",
  agentDir: string = getAgentDir(),
): void {
  const filePath = fileFor(scope, cwd, agentDir);
  const errors: string[] = [];
  const file = readMcpFile(filePath, errors);
  if (errors.length > 0) throw new Error(errors[0]);
  writeMcpFile(filePath, file.servers, value, file.indentation);
}

/**
 * The `pi` command of the installed pi package, or null when it is not resolvable (the self-contained
 * hot-update runtime inlines pi, so only direct file editing works there).
 *
 * Resolution goes through the ESM `import` condition, because the package's exports map defines no
 * `require` entry — `createRequire().resolve()` would report it as not exported.
 */
export function piCliPath(): string | null {
  const entry = resolvePackageEntry();
  if (!entry) return null;
  try {
    const packagePath = path.join(path.dirname(entry), "..", "package.json");
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { bin?: Record<string, string> };
    const bin = manifest.bin?.pi;
    return bin ? path.resolve(path.dirname(packagePath), bin) : null;
  } catch {
    return null;
  }
}

function resolvePackageEntry(): string | null {
  try {
    return fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  } catch {
    /* fall through to the CommonJS attempt */
  }
  try {
    return createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent");
  } catch {
    return null;
  }
}

export interface McpCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `pi mcp <args>` in a child process.
 *
 * The host runs inside an Electron utility process, so the child needs `ELECTRON_RUN_AS_NODE` to be
 * plain Node. Sign-in uses pi's loopback callback and the platform browser, which is exactly what a
 * desktop user needs; the UI only shows the command's output.
 */
export function runPiMcpCommand(
  args: string[],
  options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<McpCommandResult> {
  const cli = piCliPath();
  if (!cli) return Promise.reject(new Error("pi's mcp command is not available in this build"));
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    const child = spawn(process.execPath, [cli, "mcp", ...args], {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error(`pi mcp ${args.join(" ")} timed out`));
      },
      options.timeoutMs ?? 10 * 60 * 1000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
