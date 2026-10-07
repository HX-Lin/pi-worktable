/**
 * One-time rename of this app's own files in the Pi agent directory.
 *
 * The Pi Worktable rebrand renamed `pi-desktop-*.json` to `pi-worktable-*.json`.
 * Session entries keep their original `pi-desktop-*` markers (they are written
 * into transcripts and read back for history), but these three files are ours
 * alone, so they are renamed in place on the first start after the update.
 */
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const RENAMED_FILES = [
  ["pi-desktop-relay.json", "pi-worktable-relay.json"],
  ["pi-desktop-jev.json", "pi-worktable-jev.json"],
  ["pi-desktop-plugin-filters.json", "pi-worktable-plugin-filters.json"],
] as const;

/** Rename any file still under its pre-rebrand name. Idempotent and silent. */
export function migrateLegacyAgentFiles(): void {
  const agentDir = getAgentDir();
  for (const [legacyName, name] of RENAMED_FILES) {
    try {
      const legacy = join(agentDir, legacyName);
      const target = join(agentDir, name);
      if (existsSync(target) || !existsSync(legacy)) continue;
      renameSync(legacy, target);
    } catch (error) {
      // A failed rename must never stop the host; the affected file simply
      // starts from defaults.
      console.error(`[pi-worktable] could not rename ${legacyName}:`, error instanceof Error ? error.message : error);
    }
  }
}
