import type {
  RelayErrorMessage,
  RelayEventMessage,
  RelayHistoryResultMessage,
  RelayMessage,
  RelayModelsResultMessage,
  RelayPresenceMessage,
  RelayResultMessage,
  RelaySessionsResultMessage,
} from "@shared/relay-protocol";

export interface RelayClientHandlers {
  onStatus(status: "connecting" | "open" | "closed"): void;
  onEvent(message: RelayEventMessage): void;
  onHistory(message: RelayHistoryResultMessage): void;
  onSessions(message: RelaySessionsResultMessage): void;
  onModels(message: RelayModelsResultMessage): void;
  onResult(message: RelayResultMessage): void;
  onPresence(message: RelayPresenceMessage): void;
  onRunning(message: { sessionIds: string[] }): void;
  onError(message: RelayErrorMessage): void;
}

/** Same-origin WebSocket URL for the relay, carrying the Feishu session token. */
export function relayUrl(token: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}

export class RelayClient {
  private socket: WebSocket | null = null;
  private closedByUser = false;
  private retryMs = 1000;
  private retryTimer: number | null = null;
  /** Reconnect attempts since the page opened, shown in the connection panel. */
  reconnects = 0;

  constructor(
    private readonly token: string,
    private readonly handlers: RelayClientHandlers,
  ) {}

  /** The relay endpoint without the session token, so the panel can show where it points. */
  endpoint(): string {
    return relayUrl(this.token).replace(/\?.*$/u, "");
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    if (this.closedByUser) return;
    this.handlers.onStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(relayUrl(this.token));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retryMs = 1000;
      this.handlers.onStatus("open");
      this.send({ type: "sessions", requestId: "sessions" });
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.dispatch(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onStatus("closed");
      this.scheduleRetry();
    });
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    });
  }

  private scheduleRetry(): void {
    if (this.closedByUser || this.retryTimer !== null) return;
    this.reconnects += 1;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private dispatch(raw: string): void {
    let message: { type?: string };
    try {
      message = JSON.parse(raw) as { type?: string };
    } catch {
      return;
    }
    switch (message.type) {
      case "event":
        this.handlers.onEvent(message as RelayEventMessage);
        return;
      case "history":
        this.handlers.onHistory(message as RelayHistoryResultMessage);
        return;
      case "sessions":
        this.handlers.onSessions(message as RelaySessionsResultMessage);
        return;
      case "models":
        this.handlers.onModels(message as RelayModelsResultMessage);
        return;
      case "result":
        this.handlers.onResult(message as RelayResultMessage);
        return;
      case "presence":
        this.handlers.onPresence(message as RelayPresenceMessage);
        return;
      case "running":
        this.handlers.onRunning(message as { sessionIds: string[] });
        return;
      case "error":
        this.handlers.onError(message as RelayErrorMessage);
        return;
      default:
        return;
    }
  }

  send(message: RelayMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* ignore */
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  }
}
