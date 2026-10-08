import type { SessionInfo } from "@shared/types";
// 值导入用相对路径：测试直接跑 node --test，@shared 别名只在打包器里存在。
import { buildEntriesFromFiles, filterFileEntries, type FileIndexEntry } from "../../shared/file-fuzzy.ts";
import { getSessionDisplayTitle } from "./session-list.ts";

/** Everything the palette can jump to. Ordered by usefulness, not by kind. */
export type GlobalSearchItemKind = "session" | "transcript" | "file" | "project" | "action";

export interface GlobalSearchItem {
  kind: GlobalSearchItemKind;
  /** Stable identity for React keys and for tracking the selected row. */
  key: string;
  /** Primary line. */
  title: string;
  /** Secondary line: project, relative path, or a hint. */
  detail: string;
  /** Sessions only: what to open. */
  session?: SessionInfo;
  /** Files only: path relative to the searched root. */
  path?: string;
  /** Projects only: project root. */
  root?: string;
  /** Actions only: which command this is. */
  action?: GlobalSearchAction;
}

export interface GlobalSearchSection {
  kind: GlobalSearchItemKind;
  items: GlobalSearchItem[];
}

export type GlobalSearchAction =
  | { id: "new-session"; detail: string }
  | { id: "settings-general"; detail: string }
  | { id: "settings-models"; detail: string }
  | { id: "settings-agents"; detail: string }
  | { id: "settings-mcp"; detail: string }
  | { id: "panel-files"; detail: string }
  | { id: "panel-git"; detail: string }
  | { id: "panel-tasks"; detail: string }
  | { id: "panel-memory"; detail: string }
  | { id: "toggle-theme"; detail: string }
  | { id: "context-map"; detail: string };

export const SECTION_LABELS: Record<GlobalSearchItemKind, string> = {
  session: "Sessions",
  transcript: "In conversations",
  file: "Files",
  project: "Projects",
  action: "Commands",
};

export const SECTION_LIMITS: Record<GlobalSearchItemKind, number> = {
  session: 8,
  transcript: 6,
  file: 8,
  project: 5,
  action: 7,
};

function includesAllTerms(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLocaleLowerCase();
  return terms.every((term) => lower.includes(term));
}

export function splitTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Same fields the sidebar searches, so results agree with what you see there. */
function sessionSearchText(session: SessionInfo): string {
  return [session.name, session.firstMessage, session.id, session.cwd, session.worktreeBranch]
    .filter(Boolean)
    .join("\n");
}

/**
 * Sessions newest-first, so the palette matches what the sidebar shows. Unlike
 * the sidebar's filter this matches terms independently — "fix parser" finds
 * "fix the parser bug", which is what you expect from a command palette.
 */
export function rankSessions(sessions: SessionInfo[], query: string, limit = SECTION_LIMITS.session): SessionInfo[] {
  const terms = splitTerms(query);
  const matched = terms.length === 0 ? sessions : sessions.filter((s) => includesAllTerms(sessionSearchText(s), terms));
  const sorted = [...matched].sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  return sorted.slice(0, limit);
}

export function sessionItem(session: SessionInfo): GlobalSearchItem {
  return {
    kind: "session",
    key: `session:${session.id}`,
    title: getSessionDisplayTitle(session),
    detail: session.cwd,
    session,
  };
}

export interface TranscriptHit {
  sessionId: string;
  sessionName: string;
  cwd: string;
  entryId?: string;
  role: "user" | "assistant" | "other";
  snippet: string;
  modified: string;
}

/**
 * One row per matching message, each pointing at the conversation it came from.
 * The palette cannot scroll to the exact entry (sessions load a window), so the
 * snippet is what tells you whether it is the right hit.
 */
export function transcriptItems(hits: TranscriptHit[], sessions: SessionInfo[]): GlobalSearchItem[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const items: GlobalSearchItem[] = [];
  for (const hit of hits) {
    // Keep one row per conversation: several matches in one session get noisy.
    if (seen.has(hit.sessionId)) continue;
    seen.add(hit.sessionId);
    const session = byId.get(hit.sessionId);
    items.push({
      kind: "transcript",
      key: `transcript:${hit.sessionId}:${hit.entryId ?? ""}`,
      title: hit.snippet,
      detail: hit.sessionName,
      session,
    });
  }
  return items;
}

export function rankProjects(
  projects: Array<{ root: string; label?: string }>,
  query: string,
  limit = SECTION_LIMITS.project,
): GlobalSearchItem[] {
  const terms = splitTerms(query);
  return projects
    .filter((p) => includesAllTerms(`${p.label ?? ""} ${p.root}`, terms))
    .slice(0, limit)
    .map((p) => ({
      kind: "project" as const,
      key: `project:${p.root}`,
      title: p.label?.trim() || p.root,
      detail: p.root,
      root: p.root,
    }));
}

export function fileItems(files: string[], query: string, limit = SECTION_LIMITS.file): GlobalSearchItem[] {
  const entries: FileIndexEntry[] = buildEntriesFromFiles(files);
  return filterFileEntries(entries, query, limit).map((entry) => ({
    kind: "file" as const,
    key: `file:${entry.path}`,
    title: entry.path,
    detail: entry.isDir ? "directory" : "file",
    path: entry.path,
  }));
}

export function actionItems(
  actions: GlobalSearchAction[],
  labels: Record<string, string>,
  query: string,
): GlobalSearchItem[] {
  const terms = splitTerms(query);
  return actions
    .filter((action) => includesAllTerms(`${labels[action.id] ?? action.id} ${action.detail}`, terms))
    .map((action) => ({
      kind: "action" as const,
      key: `action:${action.id}`,
      title: labels[action.id] ?? action.id,
      detail: action.detail,
      action,
    }));
}

export function buildSections(parts: {
  sessions: SessionInfo[];
  transcriptHits?: TranscriptHit[];
  files: string[];
  projects: Array<{ root: string; label?: string }>;
  actions: GlobalSearchAction[];
  actionLabels: Record<string, string>;
  query: string;
  fileRoot: string | null;
}): GlobalSearchSection[] {
  const { query, actionLabels } = parts;
  const hasQuery = query.trim().length > 0;
  const sections: GlobalSearchSection[] = [
    { kind: "session", items: rankSessions(parts.sessions, query).map(sessionItem) },
    { kind: "transcript", items: transcriptItems(parts.transcriptHits ?? [], parts.sessions) },
    { kind: "file", items: parts.fileRoot ? fileItems(parts.files, query) : [] },
    { kind: "project", items: rankProjects(parts.projects, query) },
    { kind: "action", items: hasQuery ? actionItems(parts.actions, actionLabels, query) : [] },
  ];
  return sections.filter((section) => section.items.length > 0);
}

/** Flattened order is also the keyboard order. */
export function flattenSections(sections: GlobalSearchSection[]): GlobalSearchItem[] {
  return sections.flatMap((section) => section.items);
}

/** Keep the selection on a real row after the result set shrinks. */
export function clampSelection(index: number, itemCount: number): number {
  if (itemCount === 0) return -1;
  return Math.max(0, Math.min(index, itemCount - 1));
}

export function moveSelection(index: number, itemCount: number, delta: number): number {
  if (itemCount === 0) return -1;
  const next = index < 0 ? (delta > 0 ? 0 : itemCount - 1) : index + delta;
  return ((next % itemCount) + itemCount) % itemCount;
}
