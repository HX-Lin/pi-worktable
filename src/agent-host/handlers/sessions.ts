import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { clearSessionEventBinding } from "./session-events";
import { readFileSync, statSync, unlinkSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RpcError, type HistoryWindow, type SessionDetail, type SessionRuntimeState } from "../../contract/types";
import { type SessionTreeNode } from "../../shared/types";
import { getRpcSession, getRunningRpcSessionIds } from "../rpc-manager";
import {
  buildSessionContext,
  buildSessionInfoFromManager,
  getSessionIndexMetrics,
  invalidateSessionPathCache,
  listAllSessions,
  resolveSessionPath,
} from "../session-reader";
import { countBranchConversationMessages } from "../../shared/auto-compact";
import { projectSessionTreeForResponse } from "../project-tree";
import {
  logSessionPerformance,
  resolveSessionTraceId,
  roundSessionMilliseconds,
  sessionPerformanceBytesEnabled,
} from "../session-performance";
import {
  StaleHistoryCursorError,
  buildHistoryRevision,
  buildSessionHistoryPage,
  decodeHistoryCursor,
  readSessionEntryContent,
} from "../session-history";
import { getSessionContentSnapshot, invalidateSessionContent } from "../session-content-cache";
import { sessionIndex } from "../session-index";
import { emitIndexedSessionChange } from "./helpers";

/**
 * sessions handlers.
 */
export function sessionHandlers(ctx: HandlerContext) {
  const { server } = ctx;

  return {
    "sessions.list": async () => {
      const traceId = resolveSessionTraceId();
      const startedAt = performance.now();
      try {
        const sessions = await listAllSessions();
        const indexMetrics = getSessionIndexMetrics();
        logSessionPerformance("sessions.list", {
          traceId,
          ok: true,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          sessionsReturned: sessions.length,
          filesDiscovered: indexMetrics.filesDiscovered,
          filesParsed: indexMetrics.filesParsed,
          filesReused: indexMetrics.filesReused,
          invalidFiles: indexMetrics.invalidFiles,
          indexRefreshMs: indexMetrics.totalMs,
        });
        return { sessions, runningSessionIds: getRunningRpcSessionIds() };
      } catch (error) {
        logSessionPerformance("sessions.list", {
          traceId,
          ok: false,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          error: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    },

    "sessions.get": async (params) => {
      const {
        id,
        includeState,
        traceId: requestedTraceId,
        historyWindow,
      } = params as {
        id: string;
        includeState?: boolean;
        traceId?: string;
        historyWindow?: HistoryWindow;
      };
      const traceId = resolveSessionTraceId(requestedTraceId);
      const startedAt = performance.now();
      let stateMs = 0;
      try {
        const agentStatePromise: Promise<SessionDetail["agentState"]> = (async () => {
          if (!includeState) return undefined;
          const stateStartedAt = performance.now();
          const existing = getRpcSession(id);
          const result = existing?.isAlive()
            ? { running: true, state: (await existing.send({ type: "get_state" })) as SessionRuntimeState }
            : { running: false };
          stateMs = performance.now() - stateStartedAt;
          return result;
        })();

        const resolveStartedAt = performance.now();
        const filePath = await resolveSessionPath(id);
        const resolvePathMs = performance.now() - resolveStartedAt;
        if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });

        const openStartedAt = performance.now();
        // A session with a running turn is being appended to; its live entries are consistent and
        // fresher than a file read, and reading the file mid-turn is exactly when it is unstable.
        const liveSnapshot = getRpcSession(id)?.liveSnapshot() ?? null;
        const { manager: sm, entries } = liveSnapshot
          ? {
              manager: liveSnapshot.manager,
              entries: liveSnapshot.entries as unknown as ReturnType<typeof getSessionContentSnapshot>["entries"],
            }
          : getSessionContentSnapshot(filePath);
        const openMs = performance.now() - openStartedAt;

        const contextStartedAt = performance.now();
        const leafId = sm.getLeafId();
        const tree = projectSessionTreeForResponse(sm.getTree() as never) as SessionTreeNode[];
        const historyRevision = buildHistoryRevision(filePath, id);
        const context = buildSessionHistoryPage({ entries, leafId, historyWindow, historyRevision });
        const contextMs = performance.now() - contextStartedAt;

        const infoStartedAt = performance.now();
        const [info, agentState] = await Promise.all([
          buildSessionInfoFromManager(filePath, sm, entries),
          agentStatePromise,
        ]);
        // The live Host session is only queried while a session is open; for
        // every other session derive the conversation count from the session
        // file so the UI always has a real number to show.
        const branchEntries = sm.getBranch();
        const countedEntries = branchEntries.length > 0 ? branchEntries : entries;
        const fileMessageCount = countBranchConversationMessages(countedEntries);
        const resolvedAgentState: SessionDetail["agentState"] = agentState
          ? {
              running: agentState.running,
              state: {
                ...(agentState.state ?? {}),
                messageCount: agentState.state?.messageCount ?? fileMessageCount,
              },
            }
          : undefined;
        const infoMs = performance.now() - infoStartedAt;

        const detail: SessionDetail = {
          sessionId: id,
          filePath,
          info,
          leafId,
          tree,
          context,
          ...(resolvedAgentState !== undefined ? { agentState: resolvedAgentState } : {}),
        };
        const responseBytes = sessionPerformanceBytesEnabled()
          ? Buffer.byteLength(JSON.stringify(detail), "utf8")
          : undefined;
        logSessionPerformance("sessions.get", {
          traceId,
          ok: true,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          resolvePathMs: roundSessionMilliseconds(resolvePathMs),
          openMs: roundSessionMilliseconds(openMs),
          contextMs: roundSessionMilliseconds(contextMs),
          infoMs: roundSessionMilliseconds(infoMs),
          stateMs: roundSessionMilliseconds(stateMs),
          entryCount: entries.length,
          messageCount: context.messages.length,
          fileBytes: statSync(filePath).size,
          ...(responseBytes === undefined ? {} : { responseBytes }),
        });
        return detail;
      } catch (error) {
        logSessionPerformance("sessions.get", {
          traceId,
          ok: false,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          error: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    },

    "sessions.context": async (params) => {
      const { id, leafId, historyWindow } = params as { id: string; leafId?: string; historyWindow?: HistoryWindow };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const { entries } = getSessionContentSnapshot(filePath);
      const context = buildSessionHistoryPage({
        entries,
        leafId,
        historyWindow,
        historyRevision: buildHistoryRevision(filePath, id),
      });
      return { context };
    },

    "sessions.contextPage": async (params) => {
      const { id, cursor, maxTurns, maxBytes } = params as {
        id: string;
        cursor: string;
        maxTurns?: number;
        maxBytes?: number;
      };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const { entries } = getSessionContentSnapshot(filePath);
      try {
        const context = buildSessionHistoryPage({
          entries,
          historyWindow: { maxTurns, maxBytes },
          historyRevision: buildHistoryRevision(filePath, id),
          cursor: decodeHistoryCursor(cursor),
        });
        return { context };
      } catch (error) {
        if (error instanceof StaleHistoryCursorError) {
          throw new RpcError({ code: "STALE_CURSOR", message: error.message });
        }
        if (error instanceof Error && error.message === "Invalid session history cursor") {
          throw new RpcError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    },

    "sessions.entryContent": async (params) => {
      const { id, entryId, blockIndex = 0 } = params as { id: string; entryId: string; blockIndex?: number };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const { entries } = getSessionContentSnapshot(filePath);
      const content = readSessionEntryContent(entries, entryId, blockIndex);
      if (content === null) {
        throw new RpcError({ code: "NOT_FOUND", message: "Session entry content not found" });
      }
      return {
        content,
        deferredContent: {
          entryId,
          blockIndex,
          originalBytes: Buffer.byteLength(JSON.stringify(content), "utf8"),
          contentType: content.type,
        },
      };
    },

    "sessions.export": async (params) => {
      const { id, format = "md" } = params as { id: string; format?: "md" | "json" };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const raw = readFileSync(filePath, "utf8");
      if (format === "json") {
        return { content: raw, suggestedName: `session-${id}.json` };
      }
      // Simple markdown export of session file content
      const sm = SessionManager.open(filePath);
      const context = buildSessionContext(sm.getEntries() as never);
      const lines: string[] = [`# Session ${id}`, ""];
      for (const msg of context.messages as Array<{ role: string; content: unknown }>) {
        lines.push(`## ${msg.role}`, "");
        if (typeof msg.content === "string") lines.push(msg.content);
        else if (Array.isArray(msg.content)) {
          for (const block of msg.content as Array<{ type?: string; text?: string }>) {
            if (block.type === "text" && block.text) lines.push(block.text);
          }
        }
        lines.push("");
      }
      return { content: lines.join("\n"), suggestedName: `session-${id}.md` };
    },

    "sessions.delete": async (params) => {
      const { id, force } = params as { id: string; force?: boolean };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const existing = getRpcSession(id);
      if (existing?.isAlive()) {
        if (existing.isRunning() && !force) {
          throw new RpcError({
            code: "CONFLICT",
            message: "Session is still running. Stop it before deleting.",
          });
        }
        // ISSUE-001: fully stop agent before unlinking session file
        await existing.abortAndDispose();
        clearSessionEventBinding(existing.sessionId || id);
      }
      try {
        unlinkSync(filePath);
      } catch (e) {
        throw new RpcError({
          code: "INTERNAL",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      invalidateSessionContent(filePath);
      const deletedSession = sessionIndex.removePath(filePath);
      invalidateSessionPathCache(id);
      server.emit("sessions.changed", id, {
        cwd: deletedSession?.cwd ?? null,
        sessionId: id,
        deleted: true,
      });
      return { ok: true as const };
    },

    "sessions.rename": async (params) => {
      const { id, name } = params as { id: string; name: string };
      if (!name?.trim()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "name is required" });
      }
      const existing = getRpcSession(id);
      if (existing?.isAlive()) {
        await existing.send({ type: "set_session_name", name: name.trim() });
      } else {
        const filePath = await resolveSessionPath(id);
        if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
        const sm = SessionManager.open(filePath);
        // ISSUE-014: SDK uses appendSessionInfo, not setSessionName
        sm.appendSessionInfo(name.trim());
        invalidateSessionContent(filePath);
      }
      await emitIndexedSessionChange(server, id, null);
      return { ok: true as const };
    },
  } satisfies Partial<ApiHandlerSet>;
}
