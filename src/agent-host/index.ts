/**
 * Agent Host — utilityProcess entry.
 * Runs pi-coding-agent in-process; serves Api/Streams over MessagePort.
 */
import { createRpcServer } from "../contract/rpc";
import { registerHandlers } from "./handlers";
import { startSessionWatcher } from "./session-watcher";
import { toolchainRuntime } from "./toolchain-runtime";
import type { ToolchainSnapshot } from "../shared/toolchains/types";
import { installToolchainGitRunner } from "./toolchain-git";
import { readPiRuntimeVersion } from "./runtime-version";
import { startRelayBridge, stopRelayBridge } from "./relay-bridge";
import { startRpcSession } from "./rpc-manager";
import { resolveSessionPath } from "./session-reader";
import { CONTINUE_AFTER_RESTART_PROMPT, takeInterruptedSnapshot } from "./resume-interrupted";
import { migrateLegacyAgentFiles } from "./agent-file-migration";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const piRuntimeVersion = readPiRuntimeVersion();

// Rename this app's own config files before anything reads them.
migrateLegacyAgentFiles();

const server = createRpcServer();
const restoreGitRunner = installToolchainGitRunner();
const stopHandlers = registerHandlers(server);
const stopWatcher = startSessionWatcher(server);

function log(message: string): void {
  try {
    process.parentPort?.postMessage({ type: "log", message });
  } catch {
    console.log(`[agent-host] ${message}`);
  }
}

/**
 * Continue the turns a restart cut short.
 *
 * The previous host kept its running set in the user-data root, and the set empties itself when the
 * last turn ends — so an idle quit leaves nothing behind, while quitting mid-turn or dying keeps the
 * marker. Each session gets one continuation prompt, and the snapshot is cleared first so a resume
 * can never loop.
 */
async function resumeInterruptedSessions(): Promise<void> {
  const ids = takeInterruptedSnapshot(process.env.PI_DESKTOP_USER_DATA);
  for (const id of ids) {
    try {
      const file = await resolveSessionPath(id);
      if (!file) continue;
      const cwd = SessionManager.open(file).getHeader()?.cwd ?? process.cwd();
      const started = await startRpcSession(id, file, cwd);
      await started.session.send({ type: "prompt", message: CONTINUE_AFTER_RESTART_PROMPT });
      log(`resumed interrupted session ${id}`);
    } catch (error) {
      log(`resume failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Electron utilityProcess parent messaging
const parentPort = process.parentPort;
if (parentPort) {
  parentPort.on("message", (event) => {
    const msg = event.data as { type?: string; snapshot?: ToolchainSnapshot };
    if (msg?.type === "ping") {
      parentPort.postMessage({ type: "pong", ts: Date.now() });
      return;
    }
    if (msg?.type === "attach-port") {
      const port = event.ports?.[0];
      if (port) {
        try {
          server.attachPort(port as never);
          log("renderer port attached");
        } catch (err) {
          log(`attach-port failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        log("attach-port: no port in event");
      }
      return;
    }
    if (msg?.type === "toolchain:init" || msg?.type === "toolchain:changed") {
      try {
        if (!msg.snapshot) throw new Error("missing snapshot");
        toolchainRuntime.apply(msg.snapshot as ToolchainSnapshot);
        parentPort.postMessage({ type: "toolchain:ack", revision: msg.snapshot.revision });
        log(`toolchain ${msg.type === "toolchain:init" ? "initialized" : "updated"} revision=${msg.snapshot.revision}`);
      } catch (error) {
        log(`toolchain snapshot rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (msg?.type === "shutdown") {
      // The running-set snapshot is the marker of unfinished work, and the set empties itself when the
      // last turn ends — so an idle quit already removed the file. Quitting mid-turn keeps it, which
      // is what lets the next launch continue a conversation the quit interrupted.
      stopRelayBridge();
      stopWatcher();
      restoreGitRunner();
      void stopHandlers().finally(() => process.exit(0));
    }
  });

  parentPort.postMessage({ type: "ready", ts: Date.now(), piVersion: piRuntimeVersion });
  startRelayBridge(log);
  log("agent-host ready");
  void resumeInterruptedSessions();
} else {
  // Fallback for non-electron (smoke / unit)
  console.log("[agent-host] no parentPort — standalone mode");
}

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  // Do not keep serving requests from a potentially corrupted Host. The main
  // process supervisor will restart this utility process within its budget.
  setImmediate(() => process.exit(1));
});
process.on("unhandledRejection", (err) => {
  log(`unhandledRejection: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  setImmediate(() => process.exit(1));
});

// Keep alive
setInterval(() => {}, 1 << 30);
