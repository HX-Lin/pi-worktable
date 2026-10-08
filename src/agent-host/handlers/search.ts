import type { ApiHandlerSet } from "../../contract/rpc";
import { searchTranscripts } from "../transcript-search";
import { listAllSessions } from "../session-reader";

/**
 * Full-text search over session transcripts for the command palette. Shares the
 * session index with the sidebar, so it sees exactly the conversations the app
 * lists.
 */
export function searchHandlers() {
  return {
    "search.transcripts": async (params) => {
      const { query, limit } = params as { query: string; limit?: number };
      const sessions = await listAllSessions();
      return { hits: searchTranscripts({ query, sessions, limit }) };
    },
  } satisfies Partial<ApiHandlerSet>;
}
