/**
 * Wire protocol shared by the relay (relay/protocol.go), the desktop bridge, and
 * the Feishu H5 client. Keep this file and relay/protocol.go in sync: the JSON
 * field names are the contract.
 */

export const RELAY_MESSAGE = {
  register: "register",
  registered: "registered",
  prompt: "prompt",
  abort: "abort",
  subscribe: "subscribe",
  event: "event",
  history: "history",
  result: "result",
  error: "error",
  presence: "presence",
  sessions: "sessions",
  uiResponse: "ui_response",
  models: "models",
  setModel: "set_model",
} as const;

export type RelayMessageType = (typeof RELAY_MESSAGE)[keyof typeof RELAY_MESSAGE];

/** Desktop -> relay: authenticate this connection as the paired desktop. */
export interface RelayRegisterMessage {
  type: "register";
  deviceId: string;
  deviceName: string;
  pairingSecret: string;
}

/** Relay -> desktop: register result. */
export interface RelayRegisteredMessage {
  type: "registered";
  ok: boolean;
  deviceId?: string;
  error?: string;
}

/** Client -> relay -> desktop: run a prompt in a session. */
/** One image attached to a prompt: bare base64 plus its mime type, exactly what pi expects. */
export interface RelayImageAttachment {
  type: "image";
  data: string;
  mimeType: string;
}

export interface RelayPromptMessage {
  type: "prompt";
  sessionId: string;
  /** Empty for abort-like control turns; kept for protocol symmetry. */
  text?: string;
  /** Photos picked on the phone; the desktop hands them to pi unchanged. */
  images?: RelayImageAttachment[];
  requestId?: string;
}

/** Client -> relay -> desktop: stop the running turn of a session. */
export interface RelayAbortMessage {
  type: "abort";
  sessionId: string;
  requestId?: string;
}

/** Client -> relay: subscribe this connection to a session's event stream. */
export interface RelaySubscribeMessage {
  type: "subscribe";
  sessionId: string;
}

/** Desktop -> relay -> client: one AgentEvent for a session. */
export interface RelayEventMessage {
  type: "event";
  sessionId: string;
  event: unknown;
}

/** Client -> relay -> desktop (request); desktop -> relay -> client (result). */
export interface RelayHistoryRequestMessage {
  type: "history";
  sessionId: string;
  cursor?: number;
  requestId?: string;
}

export interface RelayHistoryResultMessage {
  type: "history";
  sessionId: string;
  messages: unknown[];
  requestId?: string;
}

/** Desktop -> relay -> client: acknowledgement of a client request. */
export interface RelayResultMessage {
  type: "result";
  requestId?: string;
  ok: boolean;
  error?: string;
  /** Session a prompt resolved to, when the client omitted one. */
  sessionId?: string;
}

/** Either direction: a protocol or authorization failure. */
export interface RelayErrorMessage {
  type: "error";
  code: string;
  message: string;
}

/** Relay -> client: whether the paired desktop is currently connected. */
export interface RelayPresenceMessage {
  type: "presence";
  desktopOnline: boolean;
}

/** Client -> relay -> desktop: list the sessions available on the desktop. */
export interface RelaySessionsRequestMessage {
  type: "sessions";
  requestId?: string;
}

export interface RelaySessionSummary {
  id: string;
  title?: string;
  cwd?: string;
  /** Main project root shared by all worktrees; the grouping key in the UI. */
  project?: string;
  updatedAt?: string;
}

/** Desktop -> relay -> client: which sessions have a turn in flight right now. */
export interface RelayRunningMessage {
  type: "running";
  sessionIds: string[];
}

/** Desktop -> relay -> client: the session list. */
export interface RelaySessionsResultMessage {
  type: "sessions";
  requestId?: string;
  sessions: RelaySessionSummary[];
}

/** Client -> relay -> desktop: rename a session. */
export interface RelayRenameSessionMessage {
  type: "rename_session";
  requestId?: string;
  sessionId: string;
  title: string;
}

/** Client -> relay -> desktop: delete a session and its transcript. */
export interface RelayDeleteSessionMessage {
  type: "delete_session";
  requestId?: string;
  sessionId: string;
}

/**
 * Client -> relay -> desktop: answer an extension UI request surfaced in the web
 * app (a Jev gate approval, a confirmation, or a text prompt). Exactly one of
 * value / confirmed / cancelled is set.
 */
export interface RelayUiResponseMessage {
  type: "ui_response";
  sessionId: string;
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
  requestId?: string;
}

/** Client -> relay -> desktop: list selectable models and the session's current one. */
export interface RelayModelsRequestMessage {
  type: "models";
  sessionId: string;
  requestId?: string;
}

export interface RelayModelInfo {
  provider: string;
  id: string;
  name?: string;
}

/** Desktop -> relay -> client: the model list plus the current selection. */
export interface RelayModelsResultMessage {
  type: "models";
  sessionId: string;
  requestId?: string;
  current?: RelayModelInfo;
  models: RelayModelInfo[];
}

/** Client -> relay -> desktop: switch the session's model. */
export interface RelaySetModelMessage {
  type: "set_model";
  sessionId: string;
  provider: string;
  modelId: string;
  requestId?: string;
}

export type RelayMessage =
  | RelayRegisterMessage
  | RelayRegisteredMessage
  | RelayPromptMessage
  | RelayAbortMessage
  | RelaySubscribeMessage
  | RelayEventMessage
  | RelayHistoryRequestMessage
  | RelayHistoryResultMessage
  | RelayResultMessage
  | RelayErrorMessage
  | RelayPresenceMessage
  | RelaySessionsRequestMessage
  | RelaySessionsResultMessage
  | RelayRunningMessage
  | RelayRenameSessionMessage
  | RelayDeleteSessionMessage
  | RelayUiResponseMessage
  | RelayModelsRequestMessage
  | RelayModelsResultMessage
  | RelaySetModelMessage;

/** Response body of POST /api/login. */
export interface RelayLoginResponse {
  token: string;
  openId: string;
  name?: string;
}

/** Response body of GET /api/health. */
export interface RelayHealthResponse {
  ok: boolean;
  desktopOnline: boolean;
}
