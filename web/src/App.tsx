import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RelayModelInfo, RelaySessionSummary } from "@shared/relay-protocol";
import { loginWithFeishu, setNavigationTitle } from "./feishu";
import { applyEvent, fromMessages, userItem, type DisplayItem } from "./items";
import { MAX_IMAGES_PER_MESSAGE, prepareImages, type PreparedImage } from "./images";
import { NoteCard, ToolCard, TurnChangesCard } from "./cards";
import { Markdown } from "./Markdown";
import { RelayClient, type RelayClientHandlers } from "./relay-client";
import { isUnread, loadSeen, markSeen, saveSeen, type SeenMap } from "./seen";

type Phase = "loading" | "ready" | "error";
type ConnectionStatus = "connecting" | "open" | "closed";

interface SessionGroup {
  project: string;
  label: string;
  sessions: RelaySessionSummary[];
}

interface ExtensionUiPrompt {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  expiresAt?: number;
  sessionId: string;
}

function projectLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Last rendered transcript per session, so reopening one paints before the network answers. */
const HISTORY_CACHE_KEY = "pi-h5-history-cache";
const HISTORY_CACHE_ITEMS = 60;

function loadCachedHistory(sessionId: string): DisplayItem[] | null {
  try {
    const raw = window.localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: string; items?: unknown };
    if (parsed.sessionId !== sessionId || !Array.isArray(parsed.items)) return null;
    return parsed.items as DisplayItem[];
  } catch {
    return null;
  }
}

function saveCachedHistory(sessionId: string, items: DisplayItem[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_CACHE_KEY,
      JSON.stringify({ sessionId, items: items.slice(-HISTORY_CACHE_ITEMS) }),
    );
  } catch {
    // Quota or private mode: the cache is only a convenience.
  }
}

const NARROW_QUERY = "(min-width: 760px)";

/** Live width class: rotating the phone or resizing a split view must re-lay out the shell. */
function useIsWide(): boolean {
  const [isWide, setIsWide] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isWide;
}

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [sessions, setSessions] = useState<RelaySessionSummary[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState(() => {
    try {
      return window.localStorage.getItem("pi-h5-draft") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const isWide = useIsWide();
  // Wide: the sidebar is docked and open. Narrow: it overlays and starts closed.
  const [sidebarOpen, setSidebarOpen] = useState(isWide);

  useEffect(() => {
    setSidebarOpen(isWide);
  }, [isWide]);
  const [atBottom, setAtBottom] = useState(true);
  const [prompts, setPrompts] = useState<ExtensionUiPrompt[]>([]);
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<RelayModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<RelayModelInfo | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  // Unread marks: see web/src/seen.ts for why they compare `updatedAt` instead of time.
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen());
  const seenBaseline = useRef(false);
  /** Approval cards can be folded away to read the conversation; a new one always unfolds them. */
  const [promptsCollapsed, setPromptsCollapsed] = useState(false);
  /** Connection details, so a stuck socket can be diagnosed without reading logs. */
  const [statusOpen, setStatusOpen] = useState(false);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  /** Which session row shows its rename/delete panel, and in which mode. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<"actions" | "rename" | "delete">("actions");
  const [nameDraft, setNameDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Photos picked but not sent yet; they ride along with the next prompt. */
  const [attachments, setAttachments] = useState<PreparedImage[]>([]);
  /** Sessions with a turn in flight, as the desktop reports them. */
  const [runningIds, setRunningIds] = useState<string[]>([]);
  /** Composer text survives a webview reload, which mobile clients do aggressively. */
  const draftKey = "pi-h5-draft";

  const clientRef = useRef<RelayClient | null>(null);
  const sessionRef = useRef("");
  const historyRequestRef = useRef("");
  const messagesRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(() => {
    clientRef.current?.send({ type: "sessions", requestId: "sessions" });
  }, []);

  const markSessionsSeen = useCallback((entries: Array<{ id: string; updatedAt?: string }>) => {
    setSeen((prev) => {
      const next = markSeen(prev, entries);
      if (next !== prev) saveSeen(next);
      return next;
    });
  }, []);

  // The session list only changes when it is asked for, so keep it fresh enough for the marks.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshSessions();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSessions();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refreshSessions]);

  // A finished turn is the moment another session's list entry changes.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) refreshSessions();
    wasBusy.current = busy;
  }, [busy, refreshSessions]);

  useEffect(() => {
    const title = sessions.find((entry) => entry.id === sessionId)?.title;
    setNavigationTitle(title ? `${title} · Pi Agent` : "Pi Agent");
  }, [sessions, sessionId]);

  useEffect(() => {
    if (prompts.length > 0) setPromptsCollapsed(false);
  }, [prompts.length]);

  useEffect(() => {
    try {
      if (input) window.localStorage.setItem(draftKey, input);
      else window.localStorage.removeItem(draftKey);
    } catch {
      /* private mode */
    }
  }, [input, draftKey]);

  useEffect(() => {
    if (sessions.length === 0) return;
    if (!seenBaseline.current) {
      // First list after launch: everything counts as already seen, so no dot appears on open.
      seenBaseline.current = true;
      markSessionsSeen(sessions);
      return;
    }
    // Keep the conversation on screen marked as seen while the user is actually looking at it.
    if (document.visibilityState !== "visible" || !atBottom) return;
    const current = sessions.find((entry) => entry.id === sessionRef.current);
    if (current) markSessionsSeen([current]);
  }, [sessions, atBottom, markSessionsSeen]);

  useEffect(() => {
    let cancelled = false;
    const handlers: RelayClientHandlers = {
      onStatus: (value) => {
        setStatus(value);
        setLastMessageAt(Date.now());
        // Reconnect continuity: re-subscribe and re-sync history so events that
        // happened while the socket was down are not lost.
        if (value === "open" && sessionRef.current) {
          const client = clientRef.current;
          client?.send({ type: "subscribe", sessionId: sessionRef.current });
          const requestId = `history-${Date.now()}`;
          historyRequestRef.current = requestId;
          client?.send({ type: "history", sessionId: sessionRef.current, requestId });
          client?.send({ type: "models", sessionId: sessionRef.current, requestId: `models-${Date.now()}` });
        }
      },
      onPresence: (message) => setDesktopOnline(message.desktopOnline),
      onRunning: (message) => setRunningIds(message.sessionIds ?? []),
      onSessions: (message) => {
        setLastMessageAt(Date.now());
        setSessions(message.sessions);
      },
      onModels: (message) => {
        setModels(message.models);
        if (message.current) setCurrentModel(message.current);
      },
      onHistory: (message) => {
        if (message.requestId !== historyRequestRef.current) return;
        setLastMessageAt(Date.now());
        const items = fromMessages(message.messages);
        setItems(items);
        saveCachedHistory(message.sessionId, items);
      },
      onEvent: (message) => {
        if (message.sessionId !== sessionRef.current) return;
        setLastMessageAt(Date.now());
        const raw = message.event as { type?: string } | null;
        // A Jev gate approval (or any extension dialog) becomes a tappable card
        // instead of a chat item.
        if (raw?.type === "extension_ui_request") {
          const request = message.event as Partial<ExtensionUiPrompt> & { id?: string; method?: string };
          if (
            request.id &&
            (request.method === "select" ||
              request.method === "confirm" ||
              request.method === "input" ||
              request.method === "editor")
          ) {
            const prompt: ExtensionUiPrompt = {
              id: request.id,
              method: request.method,
              title: request.title ?? "需要确认",
              ...(request.message ? { message: request.message } : {}),
              ...(request.options ? { options: request.options } : {}),
              ...(request.placeholder ? { placeholder: request.placeholder } : {}),
              ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
              sessionId: message.sessionId,
            };
            setPrompts((previous) =>
              previous.some((item) => item.id === prompt.id) ? previous : [...previous, prompt],
            );
          }
          return;
        }
        setItems((previous) => applyEvent(previous, message.event));
        if (raw?.type === "agent_end") setBusy(false);
      },
      onResult: (message) => {
        if (!message.ok) {
          setError(message.error ?? "请求失败");
          return;
        }
        // A prompt sent from the "new session" state makes the desktop create the session.
        if (message.sessionId && !sessionRef.current) {
          sessionRef.current = message.sessionId;
          setSessionId(message.sessionId);
          clientRef.current?.send({ type: "subscribe", sessionId: message.sessionId });
          refreshSessions();
          return;
        }
        if (message.requestId?.startsWith("rename-") || message.requestId?.startsWith("delete-")) refreshSessions();
      },
      onError: (message) => setError(message.message),
    };

    void (async () => {
      try {
        // Three ways in, in order: a build-time dev token, a `?token=` link (works in any browser,
        // which is the fallback when the Feishu webview misbehaves), and the Feishu login flow.
        const linkToken = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
        const devToken = (import.meta.env.VITE_RELAY_TOKEN || "").trim();
        const token =
          devToken || linkToken || (await loginWithFeishu((message) => setSteps((previous) => [...previous, message])));
        if (cancelled) return;
        const client = new RelayClient(token, handlers);
        clientRef.current = client;
        client.connect();
        setPhase("ready");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [refreshSessions]);

  const selectSession = useCallback(
    (id: string) => {
      sessionRef.current = id;
      setSessionId(id);
      // Paint the last known transcript immediately; the fresh history replaces it when it arrives.
      setItems(loadCachedHistory(id) ?? []);
      setPrompts([]);
      setBusy(false);
      setError("");
      setAtBottom(true);
      setCurrentModel(null);
      if (!isWide) setSidebarOpen(false);
      const client = clientRef.current;
      if (!client) return;
      client.send({ type: "subscribe", sessionId: id });
      const requestId = `history-${Date.now()}`;
      historyRequestRef.current = requestId;
      client.send({ type: "history", sessionId: id, requestId });
      client.send({ type: "models", sessionId: id, requestId: `models-${Date.now()}` });
    },
    [isWide],
  );

  useEffect(() => {
    if (sessionRef.current || sessions.length === 0) return;
    // A link from a Feishu notification names the conversation it is about.
    const wanted = new URLSearchParams(window.location.search).get("session");
    const target = wanted && sessions.some((session) => session.id === wanted) ? wanted : sessions[0].id;
    selectSession(target);
  }, [sessions, selectSession]);

  // Keep the view pinned to the newest content unless the user scrolled up.
  useEffect(() => {
    const element = messagesRef.current;
    if (element && atBottom) element.scrollTop = element.scrollHeight;
  }, [items, busy, atBottom]);

  const handleScroll = useCallback(() => {
    const element = messagesRef.current;
    if (!element) return;
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setAtBottom(true);
  }, []);

  const groups = useMemo<SessionGroup[]>(() => {
    const query = search.trim().toLowerCase();
    const visible = query
      ? sessions.filter((session) =>
          `${session.title ?? ""} ${session.project ?? ""} ${session.cwd ?? ""}`.toLowerCase().includes(query),
        )
      : sessions;
    const byProject = new Map<string, RelaySessionSummary[]>();
    for (const session of visible) {
      const key = session.project || session.cwd || "未分组";
      const list = byProject.get(key);
      if (list) list.push(session);
      else byProject.set(key, [session]);
    }
    return [...byProject.entries()].map(([project, list]) => ({
      project,
      label: projectLabel(project),
      sessions: list,
    }));
  }, [sessions, search]);

  const currentSession = sessions.find((session) => session.id === sessionId);
  const currentTitle = currentSession?.title || "Pi Agent";
  const currentProject = currentSession ? projectLabel(currentSession.project || currentSession.cwd || "") : "";

  const startNewSession = useCallback(() => {
    sessionRef.current = "";
    setSessionId("");
    setItems([]);
    setPrompts([]);
    setBusy(false);
    setError("");
    setAtBottom(true);
    setCurrentModel(null);
    setMenuFor(null);
    if (!isWide) setSidebarOpen(false);
    composerRef.current?.focus();
  }, [isWide]);

  const renameSession = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    clientRef.current?.send({
      type: "rename_session",
      sessionId: id,
      title: trimmed,
      requestId: `rename-${Date.now()}`,
    });
    setMenuFor(null);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      clientRef.current?.send({ type: "delete_session", sessionId: id, requestId: `delete-${Date.now()}` });
      setMenuFor(null);
      // The conversation on screen is gone, so fall back to the new-session state.
      if (sessionRef.current === id) startNewSession();
    },
    [startNewSession],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    setItems((previous) => [
      ...previous,
      userItem(
        text,
        attachments.map((image) => image.dataUrl),
      ),
    ]);
    setInput("");
    setBusy(true);
    setError("");
    setAtBottom(true);
    // An empty session id tells the desktop to start a fresh session for this prompt.
    clientRef.current?.send({
      type: "prompt",
      sessionId: sessionRef.current,
      text,
      ...(attachments.length > 0
        ? { images: attachments.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType })) }
        : {}),
      requestId: `prompt-${Date.now()}`,
    });
    setAttachments([]);
  }, [input, attachments]);

  const pickImages = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const prepared = await prepareImages([...files]);
      if (prepared.length === 0) {
        setError("只能发送图片");
        return;
      }
      setError(files.length > MAX_IMAGES_PER_MESSAGE ? `一次最多 ${MAX_IMAGES_PER_MESSAGE} 张图片` : "");
      setAttachments((previous) => [...previous, ...prepared].slice(0, MAX_IMAGES_PER_MESSAGE));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const abort = useCallback(() => {
    if (!sessionRef.current) return;
    clientRef.current?.send({ type: "abort", sessionId: sessionRef.current });
    setBusy(false);
  }, []);

  const answerPrompt = useCallback(
    (prompt: ExtensionUiPrompt, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      clientRef.current?.send({
        type: "ui_response",
        sessionId: prompt.sessionId,
        id: prompt.id,
        ...response,
        requestId: `ui-${Date.now()}`,
      });
      setPrompts((previous) => previous.filter((item) => item.id !== prompt.id));
    },
    [],
  );

  // Drop prompts whose request already timed out on the host.
  useEffect(() => {
    if (prompts.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setPrompts((previous) => previous.filter((prompt) => !prompt.expiresAt || prompt.expiresAt > now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [prompts.length]);

  const chooseModel = useCallback((model: RelayModelInfo) => {
    if (!sessionRef.current) return;
    clientRef.current?.send({
      type: "set_model",
      sessionId: sessionRef.current,
      provider: model.provider,
      modelId: model.id,
      requestId: `setmodel-${Date.now()}`,
    });
    setCurrentModel({ provider: model.provider, id: model.id });
    setModelPickerOpen(false);
    setModelSearch("");
  }, []);

  const modelLabel = useCallback(
    (model: RelayModelInfo): string => {
      const match = models.find((entry) => entry.provider === model.provider && entry.id === model.id);
      return match?.name ?? model.name ?? `${model.provider}/${model.id}`;
    },
    [models],
  );

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const list = query
      ? models.filter((model) => `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase().includes(query))
      : models;
    return [...list].sort(
      (a, b) => a.provider.localeCompare(b.provider) || (a.name ?? a.id).localeCompare(b.name ?? b.id),
    );
  }, [models, modelSearch]);

  if (phase === "loading") {
    return (
      <div className="centered">
        <p>正在连接…</p>
        {steps.length > 0 && (
          <ul className="steps">
            {steps.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="centered">
        <p className="error-text">{error}</p>
        {steps.length > 0 && (
          <ul className="steps">
            {steps.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        <p className="hint">请在飞书客户端中打开此页面，或检查 relay 配置。</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <button className="icon-btn" onClick={() => setSidebarOpen((value) => !value)} aria-label="切换侧边栏">
          ☰
        </button>
        <div className="header-titles">
          <strong className="header-title">{currentTitle}</strong>
          {currentProject && <span className="header-sub">{currentProject}</span>}
        </div>
        <span
          className={`dot ${desktopOnline ? "online" : "offline"}`}
          title={desktopOnline ? "桌面在线" : "桌面离线"}
        />
        <button type="button" className="conn" onClick={() => setStatusOpen(true)} title="连接状态">
          {status === "open" ? (desktopOnline ? "已连接" : "等待桌面") : "重连中…"}
        </button>
      </header>

      <div className="body">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索会话或项目…"
              spellCheck={false}
            />
          </div>
          <button type="button" className="sidebar-new" onClick={startNewSession}>
            ＋ 新会话
          </button>
          {groups.length === 0 && <div className="sidebar-empty">{search ? "没有匹配的会话" : "（暂无会话）"}</div>}
          {groups.map((group) => (
            <div key={group.project} className="project">
              <div className="project-name" title={group.project}>
                {group.label}
              </div>
              {group.sessions.map((session) => {
                const unread = isUnread(session.id, session.updatedAt, seen);
                if (menuFor === session.id) {
                  return (
                    <div key={session.id} className="session-actions">
                      {menuMode === "rename" ? (
                        <>
                          <input
                            className="session-rename"
                            value={nameDraft}
                            autoFocus
                            placeholder="会话名称"
                            spellCheck={false}
                            onChange={(event) => setNameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") renameSession(session.id, nameDraft);
                              if (event.key === "Escape") setMenuFor(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => renameSession(session.id, nameDraft)}
                            disabled={!nameDraft.trim()}
                          >
                            保存
                          </button>
                          <button type="button" onClick={() => setMenuFor(null)}>
                            取消
                          </button>
                        </>
                      ) : menuMode === "delete" ? (
                        <>
                          <span className="session-actions-label">删除这个会话？</span>
                          <button type="button" className="danger" onClick={() => deleteSession(session.id)}>
                            删除
                          </button>
                          <button type="button" onClick={() => setMenuFor(null)}>
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="session-actions-label" title={session.title}>
                            {session.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDraft(session.title ?? "");
                              setMenuMode("rename");
                            }}
                          >
                            重命名
                          </button>
                          <button type="button" onClick={() => setMenuMode("delete")}>
                            删除
                          </button>
                          <button type="button" onClick={() => setMenuFor(null)}>
                            取消
                          </button>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={session.id} className="session-row">
                    <button
                      className={`session ${session.id === sessionId ? "active" : ""} ${unread ? "unread" : ""}`}
                      onClick={() => selectSession(session.id)}
                    >
                      <span className="session-title">{session.title}</span>
                      {runningIds.includes(session.id) && <span className="session-busy" title="正在运行" />}
                      {unread && <span className="unread-dot" />}
                      <span className="session-time">{formatTime(session.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="session-more"
                      title="会话操作"
                      onClick={() => {
                        setMenuFor(session.id);
                        setMenuMode("actions");
                        setNameDraft(session.title ?? "");
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </aside>
        {sidebarOpen && !isWide && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

        <main className="messages" ref={messagesRef} onScroll={handleScroll}>
          {items.length === 0 && <div className="empty">发送一条消息开始对话。</div>}
          {items.map((item) => (
            <MessageItem key={item.key} item={item} />
          ))}
          {busy && <div className="typing">Agent 正在处理…</div>}
        </main>

        {!atBottom && (
          <button className="jump" onClick={scrollToBottom}>
            ↓ 到最新
          </button>
        )}
      </div>

      {error && <div className="error-bar">{error}</div>}

      {prompts.length > 0 && (
        <div className={`prompts ${promptsCollapsed ? "collapsed" : ""}`}>
          <button type="button" className="prompts-head" onClick={() => setPromptsCollapsed((value) => !value)}>
            <span>待确认（{prompts.length}）</span>
            <span className="prompts-caret">{promptsCollapsed ? "展开" : "收起"}</span>
          </button>
          {!promptsCollapsed &&
            prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onAnswer={answerPrompt} />)}
        </div>
      )}

      <footer className="composer">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((image, index) => (
              <span key={`${image.dataUrl.slice(-24)}-${index}`} className="attachment">
                <img src={image.dataUrl} alt="" />
                <button
                  type="button"
                  className="attachment-remove"
                  title="移除"
                  onClick={() => setAttachments((previous) => previous.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              void pickImages(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="attach"
            title="发送图片"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            🖼
          </button>
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="输入指令…（Enter 发送，Shift+Enter 换行）"
            rows={2}
          />
          {busy ? (
            <button type="button" className="stop" onClick={abort}>
              停止
            </button>
          ) : (
            <button type="button" onClick={send} disabled={!input.trim() && attachments.length === 0}>
              发送
            </button>
          )}
        </div>
        {/* The model chip lives with the input instead of in a bar of its own: on a phone the
            vertical space above the keyboard is the scarcest thing on screen. */}
        <div className="composer-meta">
          <button type="button" className="model-chip" onClick={() => setModelPickerOpen(true)}>
            <span className="model-dot" />
            <span className="model-chip-name">{currentModel ? modelLabel(currentModel) : "选择模型"}</span>
            <span className="model-caret">▾</span>
          </button>
        </div>
      </footer>

      {statusOpen && (
        <div className="picker-scrim" onClick={() => setStatusOpen(false)}>
          <div className="picker" onClick={(event) => event.stopPropagation()}>
            <div className="picker-head">
              <strong>连接状态</strong>
              <button type="button" onClick={() => setStatusOpen(false)}>
                ✕
              </button>
            </div>
            <dl className="status-list">
              <div>
                <dt>连接</dt>
                <dd>{status === "open" ? "已连接" : status === "connecting" ? "连接中" : "已断开"}</dd>
              </div>
              <div>
                <dt>桌面</dt>
                <dd>{desktopOnline ? "在线" : "离线（桌面应用未打开）"}</dd>
              </div>
              <div>
                <dt>端点</dt>
                <dd className="mono">{clientRef.current?.endpoint() ?? "—"}</dd>
              </div>
              <div>
                <dt>当前会话</dt>
                <dd className="mono">{currentTitle}</dd>
              </div>
              <div>
                <dt>上次消息</dt>
                <dd>{lastMessageAt ? new Date(lastMessageAt).toLocaleTimeString() : "—"}</dd>
              </div>
              <div>
                <dt>重连次数</dt>
                <dd>{clientRef.current?.reconnects ?? 0}</dd>
              </div>
            </dl>
            <div className="picker-foot">
              <span className="hint-inline">卡住时重新加载本页会重新建立连接。</span>
              <button type="button" className="ghost" onClick={() => window.location.reload()}>
                重新加载
              </button>
            </div>
          </div>
        </div>
      )}

      {modelPickerOpen && (
        <div className="picker-scrim" onClick={() => setModelPickerOpen(false)}>
          <div className="picker" onClick={(event) => event.stopPropagation()}>
            <div className="picker-head">
              <strong>切换模型</strong>
              <button type="button" onClick={() => setModelPickerOpen(false)}>
                ✕
              </button>
            </div>
            <input
              className="picker-search"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="搜索模型或提供商…"
              spellCheck={false}
            />
            <div className="picker-list">
              {filteredModels.length === 0 && <div className="muted">没有匹配的模型</div>}
              {filteredModels.map((model) => {
                const active = currentModel?.provider === model.provider && currentModel?.id === model.id;
                return (
                  <button
                    type="button"
                    key={`${model.provider}/${model.id}`}
                    className={`picker-item ${active ? "active" : ""}`}
                    onClick={() => chooseModel(model)}
                  >
                    <span className="picker-model">{model.name ?? model.id}</span>
                    <span className="picker-provider">{model.provider}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MessageItem = memo(function MessageItem({ item }: { item: DisplayItem }) {
  if (item.kind === "user") {
    return (
      <div className="bubble user">
        {item.images && item.images.length > 0 && (
          <div className="bubble-images">
            {item.images.map((src, index) => (
              <img key={`${src.slice(-24)}-${index}`} src={src} alt="" loading="lazy" />
            ))}
          </div>
        )}
        {item.text}
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="bubble assistant">
        {item.thinking && (
          <details className="thinking">
            <summary>思考过程</summary>
            <pre>{item.thinking}</pre>
          </details>
        )}
        {item.text ? (
          // While streaming, render plain text: re-parsing Markdown on every token
          // is the main cost that made the web app feel slower than the desktop.
          item.streaming ? (
            <div className="stream-text">{item.text}</div>
          ) : (
            <Markdown text={item.text} />
          )
        ) : item.streaming ? (
          <span className="cursor">…</span>
        ) : null}
        {item.error && <div className="tool-error">{item.error}</div>}
      </div>
    );
  }
  if (item.kind === "tool") return <ToolCard item={item} />;
  if (item.customType === "pi-desktop-turn-changes") return <TurnChangesCard item={item} />;
  return <NoteCard item={item} />;
});

function PromptCard({
  prompt,
  onAnswer,
}: {
  prompt: ExtensionUiPrompt;
  onAnswer: (prompt: ExtensionUiPrompt, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [text, setText] = useState("");
  const isText = prompt.method === "input" || prompt.method === "editor";
  return (
    <div className="prompt">
      <div className="prompt-title">{prompt.title}</div>
      {prompt.message && <pre className="prompt-message">{prompt.message}</pre>}
      {isText && (
        <input
          className="prompt-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={prompt.placeholder ?? "输入…"}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAnswer(prompt, { value: text });
          }}
        />
      )}
      <div className="prompt-actions">
        {prompt.method === "confirm" && (
          <>
            <button className="approve" onClick={() => onAnswer(prompt, { confirmed: true })}>
              允许
            </button>
            <button className="deny" onClick={() => onAnswer(prompt, { confirmed: false })}>
              拒绝
            </button>
          </>
        )}
        {prompt.method === "select" &&
          (prompt.options ?? []).map((option) => (
            <button key={option} onClick={() => onAnswer(prompt, { value: option })}>
              {option}
            </button>
          ))}
        {isText && (
          <button className="approve" onClick={() => onAnswer(prompt, { value: text })}>
            提交
          </button>
        )}
        <button className="cancel" onClick={() => onAnswer(prompt, { cancelled: true })}>
          取消
        </button>
      </div>
    </div>
  );
}
