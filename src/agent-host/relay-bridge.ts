/**
 * Desktop side of the pi-relay bridge.
 *
 * Opens one outbound WebSocket to the public relay, authenticates with the
 * pre-shared pairing secret, then lets authenticated Feishu/mobile clients drive
 * this machine's Pi sessions: prompts, aborts, history and the session list.
 *
 * The desktop remains the single authority. The relay never stores session data;
 * every client command is executed here and every event is streamed back out.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  RelayAbortMessage,
  RelayDeleteSessionMessage,
  RelayHistoryRequestMessage,
  RelayModelInfo,
  RelayModelsRequestMessage,
  RelayPromptMessage,
  RelayRenameSessionMessage,
  RelaySessionsRequestMessage,
  RelaySessionSummary,
  RelaySetModelMessage,
  RelayUiResponseMessage,
} from "../shared/relay-protocol";
import { getSharedModelRuntime } from "./model-runtime";
import {
  getRpcSession,
  getRunningRpcSessionIds,
  startRpcSession,
  subscribeRunningSessions,
  type AgentEvent,
  type AgentSessionWrapper,
} from "./rpc-manager";
import { invalidateSessionContent } from "./session-content-cache";
import { entryToUiMessage, listAllSessions, readSessionTailEntries, resolveSessionPath } from "./session-reader";

const RELAY_CONFIG_FILE = "pi-desktop-relay.json";
const HISTORY_LIMIT = 120;
/** Lines read from the end before filtering; some entries are not renderable messages. */
const HISTORY_TAIL_LINES = 500;
/** History is a snapshot, not an archive: keep the payload well under the relay's
 * single-frame limit so switching to a large session cannot drop the connection. */
const HISTORY_MAX_BYTES = 1_000_000;
const SESSION_LIST_LIMIT = 50;
/** Coalesce streaming updates: forwarding every token of a full message is O(n²). */
const STREAM_THROTTLE_MS = 80;

export interface RelayConfig {
  /** Public WebSocket URL of the relay, e.g. wss://pi.hxlin.fun/ws (https:// is normalized). */
  url: string;
  /** Pre-shared secret the relay expects on register. */
  pairingSecret: string;
  deviceName: string;
  /** Session used when a client omits one. Optional. */
  sessionId?: string;
  /** Workspace for a brand-new session. Optional. */
  cwd?: string;
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve relay configuration from the environment first, then
 * ~/.pi/agent/pi-desktop-relay.json. Returns null when the bridge is unconfigured,
 * which is the default: no relay traffic unless the user opts in.
 */
export function readRelayConfig(): RelayConfig | null {
  let file: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(getAgentDir(), RELAY_CONFIG_FILE), "utf8"));
    if (parsed && typeof parsed === "object") file = parsed as Record<string, unknown>;
  } catch {
    // Missing or unreadable file: environment variables can still configure it.
  }

  const url = process.env.PI_RELAY_URL?.trim() || stringField(file, "url");
  const pairingSecret = process.env.PI_RELAY_PAIRING_SECRET?.trim() || stringField(file, "pairingSecret");
  const deviceName = process.env.PI_RELAY_DEVICE_NAME?.trim() || stringField(file, "deviceName") || "desktop";
  const sessionId = process.env.PI_RELAY_SESSION_ID?.trim() || stringField(file, "sessionId") || undefined;
  const cwd = process.env.PI_RELAY_CWD?.trim() || stringField(file, "cwd") || undefined;
  if (!url || !pairingSecret) return null;
  return { url: normalizeRelayUrl(url), pairingSecret, deviceName, sessionId, cwd };
}

/** Accept https:// and http:// URLs as a convenience; the WebSocket API needs ws(s)://. */
export function normalizeRelayUrl(url: string): string {
  return url.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

function withRole(url: string, role: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}role=${encodeURIComponent(role)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keep the newest messages that fit both the count and byte budgets. */
export function boundedHistory(messages: unknown[]): unknown[] {
  const window = messages.slice(-HISTORY_LIMIT);
  const kept: unknown[] = [];
  let bytes = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(window[index]));
    } catch {
      size = 0;
    }
    if (kept.length > 0 && bytes + size > HISTORY_MAX_BYTES) break;
    bytes += size;
    kept.unshift(window[index]);
  }
  return kept;
}

export class RelayBridge {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectDelayMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly eventUnsubscribes = new Map<string, () => void>();
  private readonly pendingStream = new Map<string, AgentEvent>();
  private readonly streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopWatchingRunning: (() => void) | null = null;

  constructor(
    private readonly config: RelayConfig,
    private readonly log: (message: string) => void,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const unsubscribe of this.eventUnsubscribes.values()) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    this.eventUnsubscribes.clear();
    try {
      this.stopWatchingRunning?.();
    } catch {
      /* ignore */
    }
    this.stopWatchingRunning = null;
    for (const timer of this.streamTimers.values()) clearTimeout(timer);
    this.streamTimers.clear();
    this.pendingStream.clear();
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(withRole(this.config.url, "desktop"));
    } catch (error) {
      this.log(`relay connect failed: ${errorText(error)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectDelayMs = 1000;
      this.send({
        type: "register",
        deviceId: "desktop",
        deviceName: this.config.deviceName,
        pairingSecret: this.config.pairingSecret,
      });
    });
    socket.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data === "string") this.onMessage(data);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.log("relay socket closed");
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(value: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(value));
    } catch (error) {
      this.log(`relay send failed: ${errorText(error)}`);
    }
  }

  private onMessage(raw: string): void {
    let message: { type?: string };
    try {
      message = JSON.parse(raw) as { type?: string };
    } catch {
      return;
    }
    switch (message.type) {
      case "registered": {
        const registered = message as { ok?: boolean; error?: string };
        this.log(
          registered.ok ? `relay registered as ${this.config.deviceName}` : `relay rejected: ${registered.error}`,
        );
        return;
      }
      case "prompt":
        void this.handlePrompt(message as RelayPromptMessage);
        return;
      case "abort":
        void this.handleAbort(message as RelayAbortMessage);
        return;
      case "history":
        void this.handleHistory(message as RelayHistoryRequestMessage);
        return;
      case "sessions":
        void this.handleSessions(message as RelaySessionsRequestMessage);
        return;
      case "rename_session":
        void this.handleRenameSession(message as RelayRenameSessionMessage);
        return;
      case "delete_session":
        void this.handleDeleteSession(message as RelayDeleteSessionMessage);
        return;
      case "ui_response":
        void this.handleUiResponse(message as RelayUiResponseMessage);
        return;
      case "models":
        void this.handleModels(message as RelayModelsRequestMessage);
        return;
      case "set_model":
        void this.handleSetModel(message as RelaySetModelMessage);
        return;
      default:
        return;
    }
  }

  private async openSession(sessionId: string | undefined): Promise<AgentSessionWrapper> {
    const wanted = sessionId && sessionId !== "default" ? sessionId : (this.config.sessionId ?? "");
    if (!wanted) {
      const created = await startRpcSession(`__relay__${randomUUID()}`, "", this.config.cwd ?? homedir());
      this.watchSession(created.session);
      return created.session;
    }
    const existing = getRpcSession(wanted);
    if (existing?.isAlive()) {
      this.watchSession(existing);
      return existing;
    }
    const file = await resolveSessionPath(wanted);
    const cwd = file
      ? (SessionManager.open(file).getHeader()?.cwd ?? this.config.cwd ?? homedir())
      : (this.config.cwd ?? homedir());
    const started = await startRpcSession(wanted, file ?? "", cwd);
    this.watchSession(started.session);
    return started.session;
  }

  /** Follow the host's running set so completion events reach the relay for every session. */
  watchRunningSessions(): void {
    if (this.stopWatchingRunning) return;
    this.stopWatchingRunning = subscribeRunningSessions((ids) => {
      for (const id of ids) {
        const session = getRpcSession(id);
        if (session) this.watchSession(session);
      }
      // The phone shows which conversations are busy, so it does not have to guess from streaming.
      this.send({ type: "running", sessionIds: ids });
    });
  }

  /** Forward this session's AgentEvents to the relay exactly once per wrapper. */
  private watchSession(session: AgentSessionWrapper): void {
    const id = session.sessionId;
    if (this.eventUnsubscribes.has(id)) return;
    const unsubscribe = session.onEvent((event: AgentEvent) => this.forwardEvent(id, event));
    this.eventUnsubscribes.set(id, unsubscribe);
    session.onDestroy?.(() => {
      const stored = this.eventUnsubscribes.get(id);
      if (stored) {
        this.eventUnsubscribes.delete(id);
        try {
          stored();
        } catch {
          /* ignore */
        }
      }
    });
  }

  /**
   * Streaming updates arrive per token with the full partial message. Coalesce them
   * to at most one frame per STREAM_THROTTLE_MS; every other event flushes pending
   * text first so ordering is preserved.
   */
  private forwardEvent(sessionId: string, event: AgentEvent): void {
    if (event.type === "message_update") {
      this.pendingStream.set(sessionId, event);
      if (!this.streamTimers.has(sessionId)) {
        this.streamTimers.set(
          sessionId,
          setTimeout(() => this.flushStream(sessionId), STREAM_THROTTLE_MS),
        );
      }
      return;
    }
    this.flushStream(sessionId);
    this.send({ type: "event", sessionId, event });
  }

  private flushStream(sessionId: string): void {
    const timer = this.streamTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.streamTimers.delete(sessionId);
    }
    const pending = this.pendingStream.get(sessionId);
    if (!pending) return;
    this.pendingStream.delete(sessionId);
    this.send({ type: "event", sessionId, event: pending });
  }

  private async handlePrompt(message: RelayPromptMessage): Promise<void> {
    try {
      const session = await this.openSession(message.sessionId);
      const images = sanitizeRelayImages(message.images);
      await session.send({
        type: "prompt",
        message: message.text ?? "",
        ...(images.length > 0 ? { images } : {}),
      });
      this.send({ type: "result", requestId: message.requestId, ok: true, sessionId: session.sessionId });
    } catch (error) {
      this.log(`relay prompt failed: ${errorText(error)}`);
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleAbort(message: RelayAbortMessage): Promise<void> {
    try {
      const session = getRpcSession(message.sessionId);
      if (session?.isAlive()) await session.send({ type: "abort" });
      this.send({ type: "result", requestId: message.requestId, ok: true });
    } catch (error) {
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleHistory(message: RelayHistoryRequestMessage): Promise<void> {
    try {
      const file = message.sessionId ? await resolveSessionPath(message.sessionId) : null;
      // Only the tail is sent, so only the tail is read: parsing a 15 MB transcript to keep its last
      // 120 messages cost seconds per request and was the slow part of opening a conversation.
      const all = file
        ? readSessionTailEntries(file, HISTORY_TAIL_LINES)
            .map(entryToUiMessage)
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [];
      this.send({
        type: "history",
        sessionId: message.sessionId,
        requestId: message.requestId,
        messages: boundedHistory(all),
      });
    } catch (error) {
      this.log(`relay history failed: ${errorText(error)}`);
      this.send({ type: "history", sessionId: message.sessionId, requestId: message.requestId, messages: [] });
    }
  }

  private async handleUiResponse(message: RelayUiResponseMessage): Promise<void> {
    const session = getRpcSession(message.sessionId);
    if (!session?.isAlive()) {
      this.send({ type: "result", requestId: message.requestId, ok: false, error: "session is not running" });
      return;
    }
    try {
      const response: Record<string, unknown> = { type: "extension_ui_response", id: message.id };
      if (message.cancelled) response.cancelled = true;
      else if (message.confirmed !== undefined) response.confirmed = message.confirmed;
      else if (message.value !== undefined) response.value = message.value;
      await session.send(response);
      this.send({ type: "result", requestId: message.requestId, ok: true });
    } catch (error) {
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleModels(message: RelayModelsRequestMessage): Promise<void> {
    try {
      let current: RelayModelInfo | undefined;
      const session = message.sessionId ? getRpcSession(message.sessionId) : undefined;
      if (session?.isAlive()) {
        const state = (await session.send({ type: "get_state" })) as {
          model?: { provider?: string; id?: string };
        } | null;
        if (state?.model?.provider && state.model.id) {
          current = { provider: state.model.provider, id: state.model.id };
        }
      }
      const runtime = await getSharedModelRuntime();
      // Only models whose provider is actually configured: listing the whole
      // catalog let a client pick one that fails with "No API key".
      const models: RelayModelInfo[] = (await runtime.getAvailable()).map((model) => ({
        provider: model.provider,
        id: model.id,
        name: (model as { name?: string }).name ?? model.id,
      }));
      this.send({
        type: "models",
        sessionId: message.sessionId,
        requestId: message.requestId,
        ...(current ? { current } : {}),
        models,
      });
    } catch (error) {
      this.log(`relay models failed: ${errorText(error)}`);
      this.send({ type: "models", sessionId: message.sessionId, requestId: message.requestId, models: [] });
    }
  }

  private async handleSetModel(message: RelaySetModelMessage): Promise<void> {
    const session = getRpcSession(message.sessionId);
    if (!session?.isAlive()) {
      this.send({ type: "result", requestId: message.requestId, ok: false, error: "session is not running" });
      return;
    }
    try {
      await session.send({ type: "set_model", provider: message.provider, modelId: message.modelId });
      this.send({ type: "result", requestId: message.requestId, ok: true });
    } catch (error) {
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleRenameSession(message: RelayRenameSessionMessage): Promise<void> {
    try {
      const title = (message.title ?? "").trim();
      if (!message.sessionId || !title) throw new Error("sessionId and title are required");
      const live = getRpcSession(message.sessionId);
      if (live?.isAlive()) {
        await live.send({ type: "set_session_name", name: title });
      } else {
        const file = await resolveSessionPath(message.sessionId);
        if (!file) throw new Error("session not found");
        SessionManager.open(file).appendSessionInfo(title);
        // The list is served from a content cache; without this the old name sticks.
        invalidateSessionContent(file);
      }
      this.send({ type: "result", requestId: message.requestId, ok: true });
    } catch (error) {
      this.log(`relay rename failed: ${errorText(error)}`);
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleDeleteSession(message: RelayDeleteSessionMessage): Promise<void> {
    try {
      if (!message.sessionId) throw new Error("sessionId is required");
      const file = await resolveSessionPath(message.sessionId);
      if (!file) throw new Error("session not found");
      const live = getRpcSession(message.sessionId);
      if (live?.isAlive()) {
        // Stop the agent before unlinking the file it is still writing to.
        if (live.isRunning()) throw new Error("session is still running; stop it first");
        await live.abortAndDispose();
      }
      unlinkSync(file);
      invalidateSessionContent(file);
      this.send({ type: "result", requestId: message.requestId, ok: true });
    } catch (error) {
      this.log(`relay delete failed: ${errorText(error)}`);
      this.send({ type: "result", requestId: message.requestId, ok: false, error: errorText(error) });
    }
  }

  private async handleSessions(message: RelaySessionsRequestMessage): Promise<void> {
    try {
      const sessions: RelaySessionSummary[] = (await listAllSessions())
        .slice()
        .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0))
        .slice(0, SESSION_LIST_LIMIT)
        .map((session) => ({
          id: session.id,
          title: session.name || session.firstMessage || session.id,
          cwd: session.cwd,
          project: session.projectRoot ?? session.cwd,
          updatedAt: session.modified,
        }));
      this.send({ type: "sessions", requestId: message.requestId, sessions });
      // The running set only arrives on change otherwise, so a client that connects mid-turn would
      // never learn which conversations are busy.
      this.send({ type: "running", sessionIds: getRunningRpcSessionIds() });
    } catch (error) {
      this.log(`relay sessions failed: ${errorText(error)}`);
      this.send({ type: "sessions", requestId: message.requestId, sessions: [] });
    }
  }
}

let activeBridge: RelayBridge | null = null;

/** At most four images, each already downscaled by the phone; anything else is dropped. */
const RELAY_IMAGE_LIMIT = 4;
const RELAY_IMAGE_MAX_BASE64 = 6_000_000;

function sanitizeRelayImages(images: unknown): Array<{ type: "image"; data: string; mimeType: string }> {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image): image is { data?: unknown; mimeType?: unknown } => typeof image === "object" && image !== null)
    .map((image) => ({
      type: "image" as const,
      data: typeof image.data === "string" ? image.data : "",
      mimeType: typeof image.mimeType === "string" && image.mimeType ? image.mimeType : "image/png",
    }))
    .filter((image) => image.data.length > 0 && image.data.length <= RELAY_IMAGE_MAX_BASE64)
    .slice(0, RELAY_IMAGE_LIMIT);
}

/** Start the bridge when configured; safe to call once at Host startup. */
export function startRelayBridge(log: (message: string) => void): void {
  if (activeBridge) return;
  const config = readRelayConfig();
  if (!config) return;
  activeBridge = new RelayBridge(config, log);
  activeBridge.start();
  log(`relay bridge started → ${config.url}`);
  // Watch every running session, not just the ones the phone started: a turn begun on the desktop
  // must still produce an `agent_end` the relay can notify about.
  activeBridge.watchRunningSessions();
}

export function stopRelayBridge(): void {
  activeBridge?.stop();
  activeBridge = null;
}
