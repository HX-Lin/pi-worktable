import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { RpcError } from "../../contract/types";
import { listGitFiles } from "../../shared/worktree";
import { buildEntriesFromFiles, filterFileEntries } from "../../shared/file-fuzzy";
import {
  DOCX_PREVIEW_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getDocumentMime,
  getImageMime,
} from "../../shared/file-types";
import { IGNORED_NAMES, assertPathAllowed, getLanguage } from "./helpers";

/**
 * files handlers.
 */
export function fileHandlers(ctx: HandlerContext) {
  const { fileWatch } = ctx;

  return {
    "files.list": async (params) => {
      const { path: dirPath } = params as { path: string };
      await assertPathAllowed(dirPath);
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        throw new RpcError({ code: "NOT_FOUND", message: "Directory not found" });
      }
      const names = readdirSync(dirPath);
      const entries: Array<{
        name: string;
        isDir: boolean;
        size?: number;
        mtime?: number;
        path: string;
        type: "file" | "directory";
      }> = [];
      for (const name of names) {
        if (IGNORED_NAMES.has(name)) continue;
        const full = path.join(dirPath, name);
        try {
          const st = statSync(full);
          const isDir = st.isDirectory();
          entries.push({
            name,
            path: full,
            isDir,
            type: isDir ? "directory" : "file",
            size: st.size,
            mtime: st.mtimeMs,
          });
        } catch {
          /* skip unreadable */
        }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { entries: entries as never };
    },

    "files.read": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      if (!st.isFile()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Not a file" });
      }
      const imageMime = getImageMime(filePath);
      const audioMime = getAudioMime(filePath);
      const documentMime = getDocumentMime(filePath);
      const binaryMime = imageMime || audioMime || documentMime;

      // ISSUE-004: binary as base64+mime; never UTF-8 corrupt
      if (binaryMime) {
        const limit = imageMime ? IMAGE_PREVIEW_MAX_BYTES : documentMime ? DOCX_PREVIEW_MAX_BYTES : 50 * 1024 * 1024;
        if (st.size > limit) {
          return {
            content: "",
            encoding: "too_large" as const,
            mime: binaryMime,
            language: getLanguage(filePath),
            size: st.size,
            truncated: true,
          };
        }
        return {
          content: readFileSync(filePath).toString("base64"),
          encoding: "base64" as const,
          mime: binaryMime,
          language: getLanguage(filePath),
          size: st.size,
          truncated: false,
        };
      }

      // Text: only read up to limit
      const fd = await import("fs").then((fs) => fs.openSync(filePath, "r"));
      try {
        const max = Math.min(st.size, TEXT_PREVIEW_MAX_BYTES);
        const buf = Buffer.alloc(max);
        const n = (await import("fs")).readSync(fd, buf, 0, max, 0);
        return {
          content: buf.slice(0, n).toString("utf8"),
          encoding: "utf8" as const,
          language: getLanguage(filePath),
          size: st.size,
          truncated: st.size > TEXT_PREVIEW_MAX_BYTES,
        };
      } finally {
        (await import("fs")).closeSync(fd);
      }
    },

    "files.download": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      if (!st.isFile()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Not a file" });
      }
      return {
        base64: readFileSync(filePath).toString("base64"),
        size: st.size,
        mime:
          getImageMime(filePath) || getAudioMime(filePath) || getDocumentMime(filePath) || "application/octet-stream",
      };
    },

    "files.write": async (params) => {
      const {
        path: filePath,
        content,
        sourceSessionId,
      } = params as {
        path: string;
        content: string;
        sourceSessionId?: string;
      };
      if (typeof content !== "string") {
        throw new RpcError({ code: "BAD_REQUEST", message: "content required" });
      }
      if (content.length > 10 * 1024 * 1024) {
        throw new RpcError({ code: "BAD_REQUEST", message: "File too large to write" });
      }
      await assertPathAllowed(filePath, sourceSessionId);
      if (!existsSync(filePath)) throw new RpcError({ code: "NOT_FOUND", message: "File not found" });
      const st = statSync(filePath);
      if (!st.isFile()) throw new RpcError({ code: "BAD_REQUEST", message: "Not a file" });
      // Atomic-ish write: write to a temp file then rename, like the config
      // store, to avoid a half-written file on failure.
      const tmp = `${filePath}.${process.pid}.pi-write.tmp`;
      try {
        writeFileSync(tmp, content, "utf8");
        renameSync(tmp, filePath);
      } catch (error) {
        try {
          if (existsSync(tmp)) unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw error;
      }
      return { ok: true as const };
    },

    "files.meta": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      const imageMime = getImageMime(filePath);
      const audioMime = getAudioMime(filePath);
      const documentMime = getDocumentMime(filePath);
      return {
        size: st.size,
        mtime: st.mtimeMs,
        language: getLanguage(filePath),
        kind: documentPreviewKind(filePath) ?? (imageMime ? "image" : "file"),
        mime: imageMime ?? audioMime ?? documentMime ?? "text/plain",
      };
    },

    "files.preview": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      const imgMime = getImageMime(filePath);
      if (imgMime) {
        if (st.size > IMAGE_PREVIEW_MAX_BYTES) {
          return { kind: "too_large", mime: imgMime, size: st.size };
        }
        return {
          kind: "image",
          mime: imgMime,
          base64: readFileSync(filePath).toString("base64"),
        };
      }
      const docKind = documentPreviewKind(filePath);
      if (docKind === "docx") {
        if (st.size > DOCX_PREVIEW_MAX_BYTES) {
          return { kind: "too_large", mime: getDocumentMime(filePath) ?? undefined, size: st.size };
        }
        return {
          kind: "docx",
          mime: getDocumentMime(filePath) ?? undefined,
          base64: readFileSync(filePath).toString("base64"),
        };
      }
      if (st.size > TEXT_PREVIEW_MAX_BYTES) {
        return {
          kind: "text",
          content: readFileSync(filePath, "utf8").slice(0, TEXT_PREVIEW_MAX_BYTES),
          language: getLanguage(filePath),
          truncated: true,
        };
      }
      return {
        kind: "text",
        content: readFileSync(filePath, "utf8"),
        language: getLanguage(filePath),
      };
    },

    "files.index": async (params) => {
      // ISSUE-005: return relative POSIX paths + { files, truncated, matches }
      const { root, query } = params as { root: string; query?: string };
      await assertPathAllowed(root);
      let relFiles: string[] = [];
      let hardTruncated = false;

      try {
        const all = await listGitFiles(root);
        if (all.length > 50_000) {
          hardTruncated = true;
          relFiles = all.slice(0, 50_000);
        } else {
          relFiles = all;
        }
      } catch {
        const abs: string[] = [];
        const walk = (dir: string, depth: number) => {
          if (depth > 8 || abs.length >= 5000) {
            if (abs.length >= 5000) hardTruncated = true;
            return;
          }
          let names: string[];
          try {
            names = readdirSync(dir);
          } catch {
            return;
          }
          for (const name of names) {
            if (IGNORED_NAMES.has(name) || name.startsWith(".")) continue;
            const full = path.join(dir, name);
            try {
              const st = statSync(full);
              if (st.isDirectory()) walk(full, depth + 1);
              else abs.push(full);
            } catch {
              /* skip */
            }
            if (abs.length >= 5000) {
              hardTruncated = true;
              return;
            }
          }
        };
        walk(root, 0);
        const rootNorm = root.replace(/\\/g, "/").replace(/\/$/, "");
        relFiles = abs.map((f) => {
          const n = f.replace(/\\/g, "/");
          return n.startsWith(rootNorm + "/") ? n.slice(rootNorm.length + 1) : n;
        });
      }

      const CLIENT_CAP = 5000;
      const filesForClient = relFiles.slice(0, CLIENT_CAP);
      const truncated = hardTruncated || relFiles.length > CLIENT_CAP;
      const entries = buildEntriesFromFiles(filesForClient);

      if (query?.trim()) {
        const matches = filterFileEntries(entries, query.trim()).slice(0, 50);
        return {
          files: filesForClient,
          truncated,
          matches: matches.map((m) => ({
            path: m.path,
            isDir: m.isDir,
            score: "score" in m ? Number((m as { score?: number }).score ?? 0) : 0,
          })),
        };
      }

      return {
        files: filesForClient,
        truncated,
        matches: entries.slice(0, 100).map((m) => ({
          path: m.path,
          isDir: m.isDir,
          score: 0,
        })),
      };
    },

    "files.watchStart": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await fileWatch.start(filePath, sourceSessionId);
      return { ok: true as const };
    },

    "files.watchStop": async (params) => {
      const { path: filePath } = params as { path: string };
      fileWatch.stop(filePath);
      return { ok: true as const };
    },
  } satisfies Partial<ApiHandlerSet>;
}
