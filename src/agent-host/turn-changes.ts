import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createPatch } from "diff";
import { gitRaw } from "../shared/worktree.ts";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_PATCH_BYTES = 128 * 1024;

export interface TurnChange {
  path: string;
  added: number;
  removed: number;
  patch: string | null;
}

export interface TurnChangesResult {
  files: TurnChange[];
  omitted: number;
}

interface FileSnapshot {
  content: string | null;
  fingerprint: string;
}

export interface TurnStartSnapshot {
  cwd: string;
  head: string;
  prefix: string;
  paths: string[];
  dirty: Map<string, FileSnapshot>;
}

async function changedPaths(cwd: string, head: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    gitRaw(cwd, ["diff", "--no-renames", "--name-only", "--relative", "-z", head, "--", "."]),
    gitRaw(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]),
  ]);
  return [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))].sort();
}

function fileSnapshot(cwd: string, path: string): FileSnapshot {
  const fullPath = resolve(cwd, path);
  const within = relative(cwd, fullPath);
  if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return { content: null, fingerprint: "unsafe" };
  }
  try {
    const stat = lstatSync(fullPath);
    if (!stat.isFile()) return { content: null, fingerprint: `non-file:${stat.mode}` };
    const fingerprint = `${stat.size}:${stat.mtimeMs}`;
    if (stat.size > MAX_FILE_BYTES) return { content: null, fingerprint };
    const buffer = readFileSync(fullPath);
    if (buffer.includes(0)) return { content: null, fingerprint };
    try {
      return { content: new TextDecoder("utf-8", { fatal: true }).decode(buffer), fingerprint };
    } catch {
      return { content: null, fingerprint };
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { content: "", fingerprint: "missing" }
      : { content: null, fingerprint: "unavailable" };
  }
}

export async function captureTurnStart(cwd: string): Promise<TurnStartSnapshot | null> {
  if (!existsSync(cwd)) return null;
  try {
    const [head, prefix] = await Promise.all([
      gitRaw(cwd, ["rev-parse", "HEAD"]),
      gitRaw(cwd, ["rev-parse", "--show-prefix"]),
    ]);
    const paths = await changedPaths(cwd, head.trim());
    const dirty = new Map<string, FileSnapshot>();
    for (const path of paths.slice(0, MAX_FILES)) {
      dirty.set(path, fileSnapshot(cwd, path));
    }
    return { cwd, head: head.trim(), prefix: prefix.replace(/\n$/, ""), paths, dirty };
  } catch {
    return null; // Non-Git projects do not have a working-tree diff.
  }
}

export async function collectTurnChanges(start: TurnStartSnapshot): Promise<TurnChangesResult> {
  const allPaths = [...new Set([...start.paths, ...(await changedPaths(start.cwd, start.head))])].sort();
  const paths = [...start.dirty.keys(), ...allPaths.filter((path) => !start.dirty.has(path))].slice(0, MAX_FILES);
  const changes: TurnChange[] = [];
  let patchBytes = 0;
  for (const path of paths) {
    const after = fileSnapshot(start.cwd, path);
    let before = start.dirty.get(path);
    if (!before) {
      try {
        const content = await gitRaw(start.cwd, ["show", `${start.head}:${start.prefix}${path}`]);
        before = {
          content: Buffer.byteLength(content) <= MAX_FILE_BYTES && !content.includes("\uFFFD") ? content : null,
          fingerprint: "head",
        };
      } catch {
        before = { content: "", fingerprint: "missing" };
      }
    }
    if (before.content === after.content && before.fingerprint === after.fingerprint) continue;
    if (before.content !== null && after.content !== null && before.content === after.content) {
      if (before.fingerprint === "missing" || after.fingerprint === "missing") {
        changes.push({ path, added: 0, removed: 0, patch: null });
      }
      continue;
    }
    if (before.content === null || after.content === null) {
      changes.push({ path, added: 0, removed: 0, patch: null });
      continue;
    }
    const patch = createPatch(path, before.content, after.content, "before", "after", { context: 3 });
    const body = patch.split("\n").filter((line) => line.startsWith("+") || line.startsWith("-"));
    const added = body.filter((line) => line.startsWith("+")).length - 1;
    const removed = body.filter((line) => line.startsWith("-")).length - 1;
    const size = Buffer.byteLength(patch);
    const visiblePatch = patchBytes + size <= MAX_TOTAL_PATCH_BYTES ? patch : null;
    if (visiblePatch) patchBytes += size;
    changes.push({ path, added, removed, patch: visiblePatch });
  }
  return { files: changes.sort((a, b) => a.path.localeCompare(b.path)), omitted: allPaths.length - paths.length };
}
