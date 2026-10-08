/**
 * Per-project memory.
 *
 * Facts worth keeping live in `<project>/.pi/memory.json` and are injected into
 * the system prompt of every session in that project, so the next session does
 * not have to rediscover them.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { readJsonFile, writeJsonFileAtomic } from "../json-file";

export interface MemoryEntry {
  id: string;
  text: string;
  /** Optional grouping label, e.g. "build" or "convention". */
  tag?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

/** Injection caps: memory must never crowd out the actual task. */
export const MAX_INJECTED_ENTRIES = 60;
export const MAX_INJECTED_CHARS = 6000;

const EMPTY: MemoryFile = { version: 1, entries: [] };

export function memoryFilePath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, "memory.json");
}

function isEntry(value: unknown): value is MemoryEntry {
  return (
    Boolean(value) && typeof (value as MemoryEntry).id === "string" && typeof (value as MemoryEntry).text === "string"
  );
}

export function readMemory(cwd: string): MemoryEntry[] {
  const file = readJsonFile<MemoryFile>(memoryFilePath(cwd), EMPTY);
  if (!Array.isArray(file.entries)) return [];
  return file.entries.filter(isEntry);
}

export function writeMemory(cwd: string, entries: MemoryEntry[]): void {
  writeJsonFileAtomic(memoryFilePath(cwd), { version: 1, entries } satisfies MemoryFile);
}

export interface AddMemoryInput {
  text: string;
  tag?: string;
}

/** Add a fact. Identical text is refreshed rather than duplicated. */
export function addMemory(cwd: string, input: AddMemoryInput): MemoryEntry {
  const text = input.text.trim();
  const now = new Date().toISOString();
  const entries = readMemory(cwd);
  const existing = entries.find((entry) => entry.text === text);
  if (existing) {
    const refreshed: MemoryEntry = { ...existing, updatedAt: now, ...(input.tag ? { tag: input.tag } : {}) };
    writeMemory(
      cwd,
      entries.map((entry) => (entry.id === existing.id ? refreshed : entry)),
    );
    return refreshed;
  }

  const entry: MemoryEntry = {
    id: randomUUID(),
    text,
    ...(input.tag?.trim() ? { tag: input.tag.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };
  writeMemory(cwd, [...entries, entry]);
  return entry;
}

export interface UpdateMemoryInput {
  id: string;
  text?: string;
  tag?: string;
}

export function updateMemory(cwd: string, input: UpdateMemoryInput): MemoryEntry | null {
  const entries = readMemory(cwd);
  const index = entries.findIndex((entry) => entry.id === input.id);
  if (index === -1) return null;

  const next: MemoryEntry = {
    ...entries[index],
    ...(input.text?.trim() ? { text: input.text.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (input.tag !== undefined) {
    const tag = input.tag.trim();
    if (tag) next.tag = tag;
    else delete next.tag;
  }
  entries[index] = next;
  writeMemory(cwd, entries);
  return next;
}

export function removeMemory(cwd: string, id: string): boolean {
  const entries = readMemory(cwd);
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return false;
  writeMemory(cwd, next);
  return true;
}

/** Resolve a full id or the short prefix the tool prints. */
export function resolveMemoryId(cwd: string, reference: string): string | null {
  const trimmed = reference.trim();
  const entries = readMemory(cwd);
  const exact = entries.find((entry) => entry.id === trimmed);
  if (exact) return exact.id;
  const matches = entries.filter((entry) => entry.id.startsWith(trimmed));
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Render the memory for the system prompt, newest first, within the injection
 * caps. Returns an empty string when there is nothing to say.
 */
export function renderMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";

  const newestFirst = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lines: string[] = [];
  let chars = 0;
  let omitted = 0;

  for (const entry of newestFirst) {
    if (lines.length >= MAX_INJECTED_ENTRIES) {
      omitted = newestFirst.length - lines.length;
      break;
    }
    const line = `- ${entry.tag ? `[${entry.tag}] ` : ""}${entry.text}`;
    if (chars + line.length > MAX_INJECTED_CHARS) {
      omitted = newestFirst.length - lines.length;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }

  const header =
    "## Project memory\n\nFacts this project has already established. Trust them, but update them when they stop being true.";
  const footer = omitted > 0 ? `\n\n(${omitted} older ${omitted === 1 ? "entry" : "entries"} not shown.)` : "";
  return `${header}\n\n${lines.join("\n")}${footer}`;
}
