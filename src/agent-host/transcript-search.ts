import { readFileSync, statSync } from "node:fs";

import type { SessionInfo } from "../shared/types";

export interface TranscriptHit {
  sessionId: string;
  /** Session display name, falling back to its first message. */
  sessionName: string;
  cwd: string;
  /** Entry the text belongs to, when the transcript records one. */
  entryId?: string;
  role: "user" | "assistant" | "other";
  snippet: string;
  modified: string;
}

export interface TranscriptSearchOptions {
  query: string;
  sessions: SessionInfo[];
  limit?: number;
  /** Stop after this many bytes overall, so a big history stays snappy. */
  maxBytes?: number;
  maxFileBytes?: number;
}

export const TRANSCRIPT_SEARCH_LIMIT = 12;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SNIPPET_RADIUS = 90;

/** Text a transcript line contributes, or "" when it carries none. */
export function lineText(
  line: string,
): { text: string; role: "user" | "assistant" | "other"; entryId?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const entry = parsed as { type?: string; id?: string; message?: { role?: string; content?: unknown } };
  if (entry.type !== "message" || !entry.message) return null;
  const role = entry.message.role === "user" || entry.message.role === "assistant" ? entry.message.role : "other";
  return {
    text: extractText(entry.message.content),
    role,
    entryId: typeof entry.id === "string" ? entry.id : undefined,
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const typed = block as { type?: string; text?: string };
    if (typed?.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.join("\n");
}

export function buildSnippet(text: string, query: string): string | null {
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at === -1) return null;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function sessionLabel(session: SessionInfo): string {
  const name = session.name?.trim();
  if (name) return name;
  const first = session.firstMessage?.trim();
  if (first) return first.split("\n")[0].slice(0, 80);
  return session.id;
}

/**
 * Substring search across session transcripts. Kept deliberately simple: it reads
 * the same JSONL files pi writes, newest sessions first, with hard byte caps, so
 * the palette can call it on every keystroke without a scan of the whole history.
 */
export function searchTranscripts(options: TranscriptSearchOptions): TranscriptHit[] {
  const query = options.query.trim();
  if (query.length < 2) return [];
  const limit = options.limit ?? TRANSCRIPT_SEARCH_LIMIT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const ordered = [...options.sessions].sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  const hits: TranscriptHit[] = [];
  let scanned = 0;

  for (const session of ordered) {
    if (hits.length >= limit || scanned >= maxBytes) break;
    let raw: string;
    try {
      const size = statSync(session.path).size;
      if (size > maxFileBytes) continue;
      raw = readFileSync(session.path, "utf8");
    } catch {
      continue;
    }
    scanned += raw.length;
    for (const line of raw.split("\n")) {
      if (hits.length >= limit) break;
      const parsed = lineText(line);
      if (!parsed) continue;
      const snippet = buildSnippet(parsed.text, query);
      if (!snippet) continue;
      hits.push({
        sessionId: session.id,
        sessionName: sessionLabel(session),
        cwd: session.cwd,
        entryId: parsed.entryId,
        role: parsed.role,
        snippet,
        modified: session.modified,
      });
    }
  }

  return hits;
}
