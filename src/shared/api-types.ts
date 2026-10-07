export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export interface SkillRecord {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
}

export interface SkillUpdateParams {
  cwd: string;
  filePath: string;
  disableModelInvocation?: boolean;
  content?: string;
}

/** Jev: one channel's resolved status, as the Settings page shows it. */
export interface JevChannelStatus {
  id: string;
  label: string;
  protocol: "decisions" | "chat" | "evaluate";
  /** Effective endpoint and model, i.e. the override when one is set. */
  baseUrl: string;
  model: string;
  /** What clearing the override gives back, for the field placeholder. */
  defaultBaseUrl: string;
  defaultModel: string;
  keyHint: string;
  keySource: "env" | "vault" | null;
  keyVariable: string | null;
  hasKey: boolean;
  /** Free/keyless channel: no key is needed and none is sent. */
  keyless: boolean;
}

/** One gate condition, as the Settings page lists it for threshold tuning. */
export interface JevRuleInfo {
  id: string;
  label: string;
  /** Calibrated default from upstream. */
  threshold: number;
  mode: "required" | "hazard";
  severity: "hazard" | "soft";
  question: string;
}

export interface JevConfigPayload {
  settings: JevSettingsPayload;
  channel: JevChannelStatus;
  channels: Array<{
    id: string;
    label: string;
    protocol: "decisions" | "chat" | "evaluate";
    keyHint: string;
    keyless?: boolean;
  }>;
  rules: JevRuleInfo[];
  /** Classifier models the app can reach, cheapest first; the app's own Jev entry is keyless. */
  classifiers: JevClassifierInfo[];
}

export interface JevClassifierInfo {
  provider: string;
  id: string;
  name: string;
  /** Registered by the app and served without a key. */
  keyless: boolean;
  /** The one the current settings resolve to. */
  active: boolean;
}

/** Mirrors the host's JevSettings shape (kept structural, no host import). */
export interface JevSettingsPayload {
  enabled: boolean;
  /** `provider/id` of the classifier; empty uses the app's keyless Jev provider. */
  classifier: string | null;
  channel: string;
  model: string | null;
  baseUrl: string | null;
  gate: {
    enabled: boolean;
    scope: "all" | "matched";
    uncertain: "deny" | "ask" | "allow";
    /** What an unavailable classifier resolves to: skip the gate or block the call. */
    onUnavailable: "skip" | "block";
    timeoutMs: number;
    maxRetries: number;
    safeCommands: string[];
    allowedCommands: string[];
    disallowedCommands: string[];
    extraProtectedPaths: string[];
    thresholds: Record<string, number>;
    policyNotes: string;
  };
  compaction: {
    enabled: boolean;
    keepThreshold: number;
    borderline: number;
    truncateHeadChars: number;
    minReduction: number;
    maxStateTokens: number;
    maxRequestTokens: number;
  };
  routing: {
    mode: "off" | "jev";
    cheap: string | null;
    strong: string | null;
    default: string | null;
    cheapThinking: string | null;
    strongThinking: string | null;
    easyMax: number;
    hardMin: number;
    minConfidence: number;
  };
}

export interface JevTestResult {
  ok: boolean;
  reason?: string;
  message?: string;
  model?: string;
  probability?: number;
  latencyMs?: number;
  /** `provider/id` of the classifier that answered. */
  classifier?: string;
}

export type McpExposurePayload = "codemode" | "deferred" | "direct" | "hidden";
export type McpScopePayload = "global" | "project";

export interface McpServerPayload {
  name: string;
  scope: McpScopePayload;
  transport: "stdio" | "http";
  /** Endpoint for HTTP servers, command line for stdio ones. */
  target: string;
  enabled: boolean;
  exposure: McpExposurePayload;
  description: string | null;
  /** The raw `mcpServers` entry, so the UI can round-trip fields it does not show. */
  config: Record<string, unknown>;
  overridesGlobal: boolean;
}

export interface McpConfigPayload {
  servers: McpServerPayload[];
  globalPath: string;
  projectPath: string;
  projectExists: boolean;
  autoEnableCodemode: boolean;
  errors: string[];
  /** Whether pi's `pi mcp` command is available for live checks and sign-in. */
  cliAvailable: boolean;
}

export interface McpCommandResultPayload {
  code: number;
  stdout: string;
  stderr: string;
}

/** Kinds the fold engine distinguishes in the context window. */
export type ContextBlockKind = "system" | "user" | "text" | "thinking" | "tool_call" | "tool_result";

/** One block of the context window, as the map renders it. */
export interface ContextBlockView {
  id: string;
  kind: ContextBlockKind;
  label: string;
  turn: number;
  order: number;
  /** Tokens this block costs right now (its folded size when folded). */
  tokens: number;
  /** Tokens at full fidelity. */
  fullTokens: number;
  folded: boolean;
  pinned: boolean;
  /** Inside the protected working tail: never folded automatically. */
  protectedBlock: boolean;
  foldable: boolean;
  /** The `{#code FOLDED}` digest standing in for this block, when folded. */
  digest: string;
  preview: string;
}

export interface ContextMapSnapshot {
  sessionId: string;
  /** True once the user armed folding for this session. */
  folding: boolean;
  stats: {
    rev: number;
    liveTokens: number;
    fullTokens: number;
    savedTokens: number;
    budget: number;
    contextWindow: number | null;
    protectTokens: number;
    blockCount: number;
    foldedCount: number;
    protectedFromIndex: number;
  };
  blocks: ContextBlockView[];
  truncated: boolean;
}

export interface ContextFoldRefusal {
  id: string;
  reason: string;
}

export interface ContextFoldResult {
  applied: number;
  refused: ContextFoldRefusal[];
  snapshot: ContextMapSnapshot;
}

/** Steering command from the map. */
export type ContextFoldCommand =
  | { action: "fold" | "unfold" | "pin" | "unpin"; ids: string[] }
  | { action: "reset" }
  | { action: "folding"; enabled: boolean }
  | { action: "budget" | "protect"; tokens: number };

export type PromptScope = "project" | "global";

export interface PromptRecord {
  /** Template name = file name without the .md suffix. */
  name: string;
  /** Front-matter description or first line of the file. */
  description: string;
  filePath: string;
  scope: PromptScope;
}

export interface PromptsListResult {
  project: PromptRecord[];
  global: PromptRecord[];
}

export interface GitStatusEntry {
  path: string;
  index: string;
  workingTree: string;
}

export interface GitStatusResult {
  isGit: boolean;
  branch: string | null;
  clean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  entries: GitStatusEntry[];
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
}

export interface PluginActionParams {
  action: "install" | "remove" | "update" | "disable" | "enable";
  source?: string;
  scope?: PluginScope;
  cwd: string;
}
