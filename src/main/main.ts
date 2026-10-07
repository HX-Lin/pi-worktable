/**
 * Pi Worktable — Electron main process
 * Responsibilities: window lifecycle, menus, tray/badge, deep link,
 * Host supervision, system IPC. No business logic.
 */
import { app, BrowserWindow, crashReporter, nativeTheme, nativeImage, net, Notification } from "electron";
import fs from "node:fs";
import path from "path";
import { HostManager, getUserDataPath, resolveHostEntry } from "./host-manager";
import { appendMainLog } from "./logger";
import { installAppMenu } from "./menu";
import { handleAppProtocol, registerAppProtocol } from "./protocol";
import { acquireSingleInstanceLock } from "./single-instance";
import { loadUiState } from "./window-state";
import { createTray, destroyTray, setTrayRunningCount } from "./tray";
import { createMainWindow } from "./window";
import { startRuntimeWatcher } from "./runtime-watch";
import { installDesktopIpc } from "./ipc";
import { createCredentialRequestHandler, CredentialVault } from "./credential-vault";
import { createProductionUpdateAdapter, isProductionUpdatePlatformEnabled } from "./update-adapter";
import { createUpdateManager, redactUpdateError, type UpdateManager } from "./update-manager";
import { ToolchainManager } from "./toolchains/manager";
import { resolveRuntimeCatalogPath } from "./toolchains/catalog";
import { resolveBundledCorePaths } from "./toolchains/bundled-core";
import { isExecutionIntent, type ToolchainSnapshot } from "../shared/toolchains/types";
import { readLegacyNpmCommand } from "./toolchains/legacy-npm-command";
import { createElectronRuntimeFetch } from "./toolchains/electron-runtime-fetch";

// Must run before app ready
registerAppProtocol();

// On Linux, Chromium picks its OS-crypt backend by desktop environment and
// misses niri (XDG_CURRENT_DESKTOP=niri), silently falling back to basic_text
// so safeStorage reports unavailable even with gnome-keyring running. Force
// the libsecret backend; if the Secret Service truly is absent, safeStorage
// reports unavailable and the credential vault degrades to its own AES key.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}

crashReporter.start({
  productName: "Pi Worktable",
  uploadToServer: false,
  compress: false,
});

/**
 * One-time migration from the pre-rename userData directory.
 *
 * Renaming the product changed `app.getPath("userData")`, so the app-owned
 * state would otherwise start empty. Carry over the small, portable files
 * (window layout, channel pairing, credential vault, interrupted-session
 * snapshot) and leave Chromium caches, the hot-update overlay, and managed
 * toolchains behind — those rebuild themselves.
 */
const LEGACY_PRODUCT_NAME = "Pi Agent Desktop";
const LEGACY_MIGRATION_MARKER = "migrated-from-pi-agent-desktop.json";
const LEGACY_MIGRATION_ENTRIES = [
  "ui-state.json",
  "interrupted-sessions.json",
  "channels.json",
  "channels.secrets.json",
  "channels.secrets.json.key",
  "channels.state.json",
  "channel-media",
  "channel-workspaces",
  // Renderer preferences (theme choice, drafts) live in Chromium's local storage, not in a file we
  // own. The legacy app is stopped when this runs, so copying the store is safe.
  "Local Storage",
];

function migrateLegacyUserData(): void {
  try {
    const target = app.getPath("userData");
    if (fs.existsSync(path.join(target, LEGACY_MIGRATION_MARKER))) return;
    const legacy = path.join(path.dirname(target), LEGACY_PRODUCT_NAME);
    if (legacy === target || !fs.existsSync(legacy)) return;
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const copied: string[] = [];
    for (const entry of LEGACY_MIGRATION_ENTRIES) {
      const from = path.join(legacy, entry);
      const to = path.join(target, entry);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true });
      copied.push(entry);
    }
    fs.writeFileSync(
      path.join(target, LEGACY_MIGRATION_MARKER),
      `${JSON.stringify({ from: legacy, copied, migratedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    console.error("[pi-desktop] userData migration failed:", error);
  }
}

migrateLegacyUserData();

const isDev = !app.isPackaged;
const packagedStartupValidation = app.isPackaged && process.argv.includes("--validate-packaged-startup");
const expectedPiVersion = process.env.PI_DESKTOP_EXPECTED_PI_VERSION;
const TOOLCHAIN_FOCUS_RESCAN_TTL_MS = 60_000;

let mainWindow: BrowserWindow | null = null;
let hostManager: HostManager | null = null;
let updateManager: UpdateManager | null = null;
let toolchainManager: ToolchainManager | null = null;
let isQuitting = false;
let unreadBadge = 0;
let pendingDeepLink: string | null = null;
let lastNotifiedUpdateVersion: string | null = null;
let lastToolchainFocusScanAt = 0;
let runningAgentSessionCount = 0;
/**
 * A hot update that could not be applied yet because sessions are mid-turn.
 *
 * Restarting the host kills every agent session it owns, so a runtime update waits for the running
 * set to drain instead of cutting a turn short. The renderer is told, so the wait is not silent.
 */
let pendingHotUpdate = false;
let startupRendererReady = false;
let startupHostReady = false;
let startupToolchainSnapshot: ToolchainSnapshot | null = null;
let startupCheckFinished = false;
let startupCheckTimer: ReturnType<typeof setTimeout> | null = null;

function finishPackagedStartupValidation(error?: string): void {
  if (!packagedStartupValidation || startupCheckFinished) return;
  if (!error) {
    const snapshot = startupToolchainSnapshot;
    if (!startupRendererReady || !startupHostReady || !snapshot?.publicState.coreReady) return;
    if (!expectedPiVersion || hostManager?.getPiVersion() !== expectedPiVersion) {
      error = `Agent Host Pi version mismatch: expected ${expectedPiVersion ?? "unknown"}, got ${hostManager?.getPiVersion() ?? "unknown"}`;
    }
    if ((hostManager?.getToolchainAckRevision() ?? -1) < snapshot.revision) return;
    for (const capability of ["search.rg", "search.fd"] as const) {
      const candidates = snapshot.publicState.capabilities[capability]?.candidates ?? [];
      if (!candidates.some((candidate) => candidate.provider === "bundled" && candidate.health === "healthy")) return;
    }
  }

  startupCheckFinished = true;
  if (startupCheckTimer) clearTimeout(startupCheckTimer);
  try {
    const report = error
      ? { ok: false, error }
      : {
          ok: true,
          appVersion: app.getVersion(),
          piVersion: hostManager?.getPiVersion(),
          platformArch: `${process.platform}-${process.arch}`,
          revision: startupToolchainSnapshot?.revision,
          rendererReady: startupRendererReady,
          hostReady: startupHostReady,
          hostAckRevision: hostManager?.getToolchainAckRevision(),
          bundledSearch: ["search.rg", "search.fd"],
        };
    fs.mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(app.getPath("userData"), "packaged-startup-check.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (writeError) {
    error ??= writeError instanceof Error ? writeError.message : "Could not write packaged startup report";
  }
  isQuitting = true;
  updateManager?.stopAutomaticChecks();
  hostManager?.stop();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(error ? 1 : 0);
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function applyBadgeCount(count: number): void {
  unreadBadge = Math.max(0, Number(count) || 0);
  if (process.platform === "win32") {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (unreadBadge === 0) {
      win.setOverlayIcon(null, "No unread completed sessions");
      return;
    }
    const overlay = nativeImage
      .createFromPath(path.join(app.getAppPath(), "build", "icon.png"))
      .resize({ width: 16, height: 16 });
    win.setOverlayIcon(overlay, `${unreadBadge} unread completed session${unreadBadge === 1 ? "" : "s"}`);
    return;
  }
  app.setBadgeCount(unreadBadge);
}

function parseDeepLink(url: string): { sessionId?: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "pi-worktable:") return null;
    // pi-worktable://session/<id>
    if (u.hostname === "session" || u.pathname.startsWith("/session/")) {
      const id = u.hostname === "session" ? u.pathname.replace(/^\//, "") : u.pathname.replace(/^\/session\//, "");
      return id ? { sessionId: id } : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function handleDeepLink(url: string): void {
  appendMainLog(`deep link: ${url}`);
  const parsed = parseDeepLink(url);
  if (!parsed?.sessionId) return;
  const win = getMainWindow();
  if (win) {
    win.webContents.send("deep-link:session", parsed.sessionId);
    win.show();
    win.focus();
  } else {
    pendingDeepLink = parsed.sessionId;
  }
}

if (
  !acquireSingleInstanceLock(getMainWindow, (argv) => {
    const url = argv.find((a) => a.startsWith("pi-worktable://"));
    if (url) handleDeepLink(url);
  })
) {
  app.quit();
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function createWindow(): BrowserWindow {
  const win = createMainWindow({
    isDev,
    consumePendingDeepLink: () => {
      const sessionId = pendingDeepLink;
      pendingDeepLink = null;
      return sessionId;
    },
    shouldHideOnClose: () => !isQuitting && loadUiState().backgroundMode !== false,
    onClosed: (closedWindow) => {
      if (mainWindow === closedWindow) mainWindow = null;
    },
  });
  mainWindow = win;
  win.on("focus", () => {
    const manager = toolchainManager;
    const now = Date.now();
    if (!manager || now - lastToolchainFocusScanAt < TOOLCHAIN_FOCUS_RESCAN_TTL_MS) return;
    lastToolchainFocusScanAt = now;
    void manager.rescan().catch((error) => {
      appendMainLog(`toolchain focus rescan failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  if (packagedStartupValidation) {
    win.webContents.once("did-finish-load", () => {
      startupRendererReady = true;
      finishPackagedStartupValidation();
    });
    win.webContents.once("did-fail-load", (_event, code, description) => {
      finishPackagedStartupValidation(`Renderer failed to load (${code}): ${description}`);
    });
  }
  if (unreadBadge > 0) applyBadgeCount(unreadBadge);
  return win;
}

function openUpdateSettings(checkForUpdates: boolean): void {
  const win = getMainWindow() ?? createWindow();
  win.show();
  win.focus();
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(checkForUpdates ? "menu:check-for-updates" : "menu:show-update");
    }
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

void app.whenReady().then(async () => {
  appendMainLog(`app ready packaged=${app.isPackaged}`);
  if (packagedStartupValidation) {
    startupCheckTimer = setTimeout(
      () => finishPackagedStartupValidation("Packaged startup validation timed out"),
      45_000,
    );
  }

  const credentialVault = new CredentialVault(getUserDataPath("channels.secrets.json"));
  const ui = loadUiState();
  const updaterTestMode = !app.isPackaged && process.env.PI_DESKTOP_TEST_UPDATER === "1";
  const updaterSupported =
    isProductionUpdatePlatformEnabled(process.platform) ||
    (updaterTestMode && (process.platform === "darwin" || process.platform === "win32"));
  const updaterRequested = app.isPackaged || updaterTestMode;
  let updateAdapter = null;
  if (updaterSupported && updaterRequested) {
    try {
      updateAdapter = await createProductionUpdateAdapter({
        useDevelopmentConfig: updaterTestMode,
      });
    } catch (error) {
      appendMainLog(`updater unavailable: ${redactUpdateError(error)}`);
    }
  }
  updateManager = createUpdateManager({
    adapter: updateAdapter,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    automaticChecksEnabled: ui.automaticUpdateChecks !== false,
    prepareToInstall: () => {
      isQuitting = true;
      destroyTray();
      hostManager?.stop();
    },
    recoverFromInstallFailure: () => {
      isQuitting = false;
      createTray(getMainWindow, () => createWindow());
      const manager = hostManager;
      if (manager) {
        let remainingAttempts = 12;
        const restartHost = () => {
          if (isQuitting) return;
          manager.start();
          if (manager.getStatus() === "stopped" && remainingAttempts-- > 0) {
            const restartTimer = setTimeout(restartHost, 250);
            restartTimer.unref();
          }
        };
        restartHost();
      }
    },
    log: (level, message) => appendMainLog(`updater[${level}] ${message}`),
  });
  const bundledCorePaths = resolveBundledCorePaths({
    isPackaged: app.isPackaged,
    resourcesRoot: process.resourcesPath,
  });
  const toolchainHome = app.getPath("home");
  toolchainManager = new ToolchainManager({
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    homeDir: toolchainHome,
    tempRoot: app.getPath("temp"),
    userDataRoot: app.getPath("userData"),
    resourcesRoot: process.resourcesPath,
    catalogPath: resolveRuntimeCatalogPath({
      isPackaged: app.isPackaged,
      resourcesRoot: process.resourcesPath,
    }),
    coreCatalogPath: bundledCorePaths.catalogPath,
    bundledCoreRoot: bundledCorePaths.coreRoot,
    // Chromium networking follows the user's system proxy/PAC and OS trust
    // configuration. Redirects are synchronously allowlisted before following.
    fetchImpl: createElectronRuntimeFetch((options) => net.request(options)),
    legacyNpmCommand: readLegacyNpmCommand({ homeDir: toolchainHome, env: process.env }),
    isRuntimeInUse: () => runningAgentSessionCount > 0,
  });
  toolchainManager.subscribe((snapshot) => {
    if (packagedStartupValidation) startupToolchainSnapshot = snapshot;
    appendMainLog(
      `toolchain scan revision=${snapshot.revision} candidates=${snapshot.candidates.length} ready=${snapshot.publicState.coreReady}`,
    );
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("toolchains:state", snapshot.publicState);
    }
    hostManager?.setToolchainSnapshot(snapshot);
    finishPackagedStartupValidation();
  });
  updateManager.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("update:state", state);
    }
    if (state.phase === "available") {
      const notificationKey = state.availableVersion ?? "unknown";
      if (lastNotifiedUpdateVersion !== notificationKey) {
        lastNotifiedUpdateVersion = notificationKey;
        const win = getMainWindow();
        const shouldNotify = !win || !win.isVisible() || !win.isFocused();
        if (shouldNotify && Notification.isSupported()) {
          const notification = new Notification({
            title: "Pi Worktable update available",
            body: state.availableVersion
              ? `Version ${state.availableVersion} is ready to download.`
              : "A new version is ready to download.",
          });
          notification.on("click", () => {
            openUpdateSettings(false);
          });
          notification.show();
        }
      }
    }
  });

  // Always register app:// so we can load the built renderer without Vite
  // (npm start after build, or dev fallback when VITE_DEV_SERVER_URL is unset).
  handleAppProtocol();

  installDesktopIpc({
    getHostManager: () => hostManager,
    getMainWindow,
    getUnreadBadge: () => unreadBadge,
    applyBadgeCount,
    getToolchainState: (cwd) =>
      cwd ? toolchainManager!.getPublicStateForProject(cwd) : toolchainManager!.getPublicState(),
    rescanToolchains: async (cwd) => {
      await toolchainManager!.rescan({ cwd });
      return cwd ? toolchainManager!.getPublicStateForProject(cwd) : toolchainManager!.getPublicState();
    },
    performToolchainAction: (request) => toolchainManager!.performAction(request),
    chooseCustomTool: (capability, executable) => toolchainManager!.registerCustomTool(capability, executable),
    setChannelCredential: (payload) =>
      credentialVault.set(`channel:${payload.channel}:${payload.accountId}`, payload.credential),
    updateManager,
  });
  installAppMenu(getMainWindow, () => openUpdateSettings(true));

  createTray(getMainWindow, () => createWindow());

  // Apply persisted theme preference
  if (ui.theme === "light" || ui.theme === "dark" || ui.theme === "system") {
    nativeTheme.themeSource = ui.theme;
  }

  // Resolved per spawn, so a hot update installed while the app runs is used on the next restart.
  hostManager = new HostManager(() => resolveHostEntry());

  // Hot-update overlay: when the writable runtime dir changes, restart the host
  // or reload the UI in place, without quitting the app. A host restart drops
  // every in-flight turn, so it waits for the running sessions to finish.
  const notifyHotUpdate = (pending: boolean) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("host:hot-update", { pending });
    }
  };
  const applyHotUpdate = () => {
    pendingHotUpdate = false;
    hostManager?.restart("hot-update");
  };
  const requestHotUpdate = () => {
    if (!hostManager) return;
    if (runningAgentSessionCount === 0) {
      applyHotUpdate();
      return;
    }
    if (!pendingHotUpdate) {
      pendingHotUpdate = true;
      appendMainLog(`hot update pending: ${runningAgentSessionCount} session(s) still running`);
      notifyHotUpdate(true);
    }
  };
  startRuntimeWatcher({
    restartHost: () => requestHotUpdate(),
    reloadRenderer: () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.reload();
    },
  });
  hostManager.setToolchainSnapshot(toolchainManager.getSnapshot());
  const credentialRequestHandler = createCredentialRequestHandler(credentialVault);
  hostManager.setRequestHandler(async (method, params) => {
    if (method.startsWith("channelSecrets.")) return credentialRequestHandler(method, params);
    if (method === "toolchain.getSnapshot") return toolchainManager!.getSnapshot();
    if (method === "toolchain.resolve") {
      const body = (params ?? {}) as { cwd?: unknown; intent?: unknown; trusted?: unknown };
      if (
        typeof body.cwd !== "string" ||
        !path.isAbsolute(body.cwd) ||
        body.cwd.length > 4_096 ||
        /[\0\r\n]/.test(body.cwd) ||
        !isExecutionIntent(body.intent) ||
        typeof body.trusted !== "boolean"
      ) {
        throw new Error("Invalid Host toolchain resolution request");
      }
      return toolchainManager!.resolveForProject(body.cwd, { intent: body.intent, trusted: body.trusted });
    }
    throw new Error(`Unsupported Host request: ${method}`);
  });
  hostManager.setStatusListener((status, detail) => {
    appendMainLog(`host status=${status} ${detail ?? ""}`);
    if (packagedStartupValidation) {
      startupHostReady = status === "ready";
      if (status === "crashed") finishPackagedStartupValidation(detail ?? "Agent Host crashed");
      else finishPackagedStartupValidation();
    }
    if (status !== "ready") {
      runningAgentSessionCount = 0;
      setTrayRunningCount(0, getMainWindow);
      updateManager?.setRunningSessionCount(0);
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("host:status", { status, detail });
      if (status === "ready" && detail?.includes("restart")) {
        win.webContents.send("host:restarted", { reason: detail });
      }
      if (status === "crashed") {
        win.webContents.send("host:crashed", { detail });
      }
    }
  });

  hostManager.setMessageListener((msg) => {
    if (packagedStartupValidation && msg.type === "toolchain:ack") finishPackagedStartupValidation();
    if (msg.type === "running-sessions") {
      const ids = (msg.sessionIds as string[]) ?? [];
      runningAgentSessionCount = ids.length;
      setTrayRunningCount(ids.length, getMainWindow);
      updateManager?.setRunningSessionCount(ids.length);
      // The wait for a hot update is over: nothing is mid-turn any more.
      if (pendingHotUpdate && ids.length === 0) {
        appendMainLog("hot update pending: sessions idle, restarting the host");
        notifyHotUpdate(false);
        applyHotUpdate();
      }
    } else if (msg.type === "agent-end") {
      const sessionId = String(msg.sessionId ?? "");
      // Notify if no focused window or window is hidden (desktop value-add)
      const win = getMainWindow();
      const shouldNotify = !win || !win.isVisible() || !win.isFocused();
      if (shouldNotify && Notification.isSupported() && sessionId) {
        const n = new Notification({
          title: "Agent finished",
          body: "A session completed in the background",
        });
        n.on("click", () => {
          const w = getMainWindow();
          if (w) {
            w.show();
            w.focus();
            w.webContents.send("deep-link:session", sessionId);
          }
        });
        n.show();
        applyBadgeCount(unreadBadge + 1);
      }
    } else if (msg.type === "host-restarted") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("host:restarted", { reason: String(msg.reason ?? "restart") });
      }
    }
  });

  hostManager.start();

  createWindow();
  void toolchainManager.initialize();
  updateManager.startAutomaticChecks();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      getMainWindow()?.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  updateManager?.stopAutomaticChecks();
  destroyTray();
  hostManager?.stop();
});

app.on("window-all-closed", () => {
  // Keep the app alive in the background while sessions are still running so
  // they can finish (tray restores the window; Quit exits for real). Without
  // running sessions, close = quit as usual.
  if (process.platform !== "darwin" && runningAgentSessionCount <= 0) {
    app.quit();
  }
});

// Deep link registration
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("pi-worktable", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("pi-worktable");
}
