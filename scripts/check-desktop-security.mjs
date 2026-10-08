#!/usr/bin/env node
/**
 * Desktop security invariants.
 *
 * Each check is a statement about code that exists — an identifier, a call, an
 * assignment, an object property, a parsed YAML/JSON path — rather than a
 * substring of a file. Comments and reformatting cannot satisfy a check, and
 * moving code between modules only means updating the file list.
 */
import path from "path";
import { fileURLToPath } from "url";
import { configFacts, sourceFacts } from "./lib/source-facts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (file) => sourceFacts(root, file);
const cfg = (file) => configFacts(root, file);

const main = src("src/main/main.ts");
const windowFactory = src("src/main/window.ts");
const protocol = src("src/main/protocol.ts");
const html = src("src/renderer/index.html");
const preload = src("src/preload/preload.ts");
const globals = src("src/renderer/global.d.ts");
const diagnostics = src("src/main/diagnostics.ts");
const diagnosticsRedaction = src("src/main/diagnostics-redaction.ts");
const fileViewer = src("src/renderer/components/FileViewer.tsx");
const credentialVault = src("src/main/credential-vault.ts");
const feishuChannelApi = src("src/agent-host/channels/adapters/feishu/api.ts");
const channelManager = src("src/agent-host/channels/channel-manager.ts");
const channelMediaStore = src("src/agent-host/channels/media-store.ts");
const channelOutboundFiles = src("src/agent-host/channels/outbound-files.ts");
const channelPiBridge = src("src/agent-host/channels/pi-session-bridge.ts");
// The session layer is several modules; the invariants below are about the layer.
const rpcManager = src([
  "src/agent-host/rpc-manager.ts",
  "src/agent-host/session-wrapper.ts",
  "src/agent-host/session-registry.ts",
  "src/agent-host/running-status.ts",
]);
const channelContract = src("src/contract/api.ts");
const desktopContract = src("src/contract/desktop.ts");
const desktopIpc = src("src/main/ipc.ts");
const updateAdapter = src("src/main/update-adapter.ts");
const updateManager = src("src/main/update-manager.ts");
const electronBuilderConfig = cfg("electron-builder.yml");
const desktopBuildWorkflow = cfg(".github/workflows/build-desktop.yml");
const toolchainContractCheck = src("scripts/check-toolchain-contract.mjs");
const upstreamToolchainCatalogCheck = src("scripts/verify-toolchain-catalog-upstream.mjs");
const bundledToolsBuild = src("scripts/prepare-bundled-tools.mjs");
const packagedToolchainVerifier = src("scripts/verify-packaged-toolchains.mjs");
const toolchainSearch = src("src/agent-host/toolchain-search.ts");
const toolchainInstaller = src("src/main/toolchains/installer.ts");
const toolchainManager = src("src/main/toolchains/manager.ts");
const electronRuntimeFetch = src("src/main/toolchains/electron-runtime-fetch.ts");
const legacyNpmCommand = src("src/main/toolchains/legacy-npm-command.ts");
const toolchainStateStore = src("src/main/toolchains/state-store.ts");
const verifyScript = src("scripts/verify.mjs");
const toolchainBash = src("src/agent-host/toolchain-bash.ts");
const toolchainActionTypes = src("src/shared/toolchains/types.ts");
const packageJson = src("package.json");

const RELEASE_TARGETS = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"];

const checks = [
  [windowFactory.hasProperty("sandbox", "true"), "BrowserWindow sandbox must remain enabled"],
  [windowFactory.hasProperty("contextIsolation", "true"), "context isolation must remain enabled"],
  [windowFactory.hasProperty("nodeIntegration", "false"), "renderer Node integration must remain disabled"],
  [main.uses("crashReporter.start"), "local crash reporting must be started"],
  [
    main.uses("createElectronRuntimeFetch") &&
      main.calls("net.request") &&
      !main.uses("net.fetch") &&
      electronRuntimeFetch.calls("request.followRedirect") &&
      electronRuntimeFetch.uses("assertRuntimeRedirectUrl") &&
      main.hasProperty("fetchImpl") &&
      toolchainInstaller.hasProperty("fetchImpl", "options.fetchImpl"),
    "managed downloads must use Electron networking with synchronous redirect checks so system proxy and trust settings remain effective",
  ],
  [main.uses("setOverlayIcon"), "Windows taskbar overlay badges must remain implemented"],
  [
    diagnostics.calls("app.getPath") &&
      diagnostics.hasString("crashDumps") &&
      diagnostics.uses("collectCrashMetadata") &&
      diagnostics.uses("MAX_LOG_BYTES") &&
      !diagnostics.uses("fs.cpSync") &&
      diagnosticsRedaction.uses("redactDiagnosticText") &&
      diagnosticsRedaction.hasString("<redacted-token>") &&
      diagnosticsRedaction.uses("buildToolchainDiagnosticSummary"),
    "diagnostic export must redact bounded logs, summarize toolchains, and exclude raw crash process memory",
  ],
  [
    protocol.hasString("object-src 'none'; ") && protocol.hasString("form-action 'none'"),
    "renderer CSP must block plugins and forms",
  ],
  [protocol.matches(/script-src(?![^;]*unsafe-inline)/), "renderer script-src must not allow unsafe-inline"],
  [fileViewer.matches(/sandbox="allow-scripts"/), "HTML previews must remain sandboxed"],
  [
    desktopBuildWorkflow.hasValueMatching(/check:toolchain-catalog:upstream/) &&
      upstreamToolchainCatalogCheck.hasStringContaining("SHASUMS256.txt") &&
      upstreamToolchainCatalogCheck.uses("asset.digest") &&
      upstreamToolchainCatalogCheck.uses("asset.size"),
    "tag releases must verify managed runtime checksums and sizes against official upstream metadata",
  ],
  [
    rpcManager.uses("createDesktopSearchToolDefinitions") &&
      toolchainSearch.hasProperty("allowUpstreamDownload", "false") &&
      !toolchainSearch.uses("ensureTool") &&
      !toolchainSearch.hasString("releases/latest") &&
      bundledToolsBuild.calls("downloadRuntimeArtifact") &&
      bundledToolsBuild.calls("verifyDownloadedArtifact"),
    "Desktop grep/find must use injected rg/fd descriptors and fixed build-time assets without upstream dynamic downloads",
  ],
  [
    main.uses("app.isPackaged") &&
      main.calls("process.argv.includes") &&
      main.hasString("--validate-packaged-startup") &&
      main.hasString("packaged-startup-check.json") &&
      main.uses("getToolchainAckRevision") &&
      main.uses("candidate.provider") &&
      main.hasString("bundled") &&
      main.uses("candidate.health") &&
      main.hasString("healthy"),
    "the production startup probe must be packaged-only and require Renderer, Host revision ack, and healthy bundled search tools",
  ],
  [
    packagedToolchainVerifier.matches(/darwin-arm64\|darwin-x64\|win32-x64\|linux-x64/) &&
      packagedToolchainVerifier.calls("assertExact") &&
      packagedToolchainVerifier.hasString("core-catalog.json") &&
      packagedToolchainVerifier.calls("verifyManifestFile") &&
      packagedToolchainVerifier.calls("verifyLinuxSandbox") &&
      packagedToolchainVerifier.matches(/stat\.uid\s*!==\s*0/) &&
      packagedToolchainVerifier.calls("spawnSync") &&
      packagedToolchainVerifier.hasString("ripgrep") &&
      packagedToolchainVerifier.uses("runPackagedStartup") &&
      packagedToolchainVerifier.calls("verifyLinuxAppImageDesktopEntry") &&
      packagedToolchainVerifier.hasProperty("APPIMAGE_EXTRACT_AND_RUN", '"1"') &&
      packagedToolchainVerifier.uses("hostAckRevision"),
    "the packaged E2E must enforce the release matrix, exact resources, hashes, functional rg/fd, and production startup ack",
  ],
  [
    RELEASE_TARGETS.every((target) => desktopBuildWorkflow.hasValueMatching(new RegExp(target))) &&
      desktopBuildWorkflow.hasValueMatching(/check:packaged-toolchains/) &&
      desktopBuildWorkflow.hasValueMatching(/release-linux/) &&
      desktopBuildWorkflow.hasValueMatching(/xvfb-run --auto-servernum/) &&
      desktopBuildWorkflow.hasValueMatching(/chown root:root[^\n]*chrome-sandbox/) &&
      desktopBuildWorkflow.hasValueMatching(/chmod 4755[^\n]*chrome-sandbox/) &&
      electronBuilderConfig.valueAt("linux.executableName") === "pi-worktable" &&
      electronBuilderConfig.hasValue("--appimage-desktop-launch") &&
      !electronBuilderConfig.matches(/--no-sandbox/) &&
      desktopBuildWorkflow.hasValueMatching(/Pi-Worktable-\$\{version\}-x86_64\.AppImage/),
    "CI and tag releases must run packaged toolchain E2E for every supported target, including Linux under Xvfb",
  ],
  [
    toolchainInstaller.uses("previousRoot") &&
      toolchainInstaller.calls("fs.renameSync") &&
      toolchainInstaller.uses("this.stateStore.update") &&
      toolchainInstaller.before("this.stateStore.update", "fs.rmSync"),
    "managed activation must preserve the previous same-version runtime until the new state is durable",
  ],
  [
    toolchainInstaller.usesAll(
      "recoverInterruptedOperations",
      "cleanupPartialDownloads",
      "recoverPreviousRuntimeDirectories",
    ) &&
      toolchainInstaller.hasString("TOOLCHAIN_CANCELLED") &&
      toolchainManager.uses("cancelComponentInstall") &&
      toolchainManager.calls("isRuntimeInUse"),
    "managed installs must support cancellation, crash-residue recovery, and in-use removal protection",
  ],
  [
    main.uses("readLegacyNpmCommand") &&
      legacyNpmCommand.usesAll("MAX_SETTINGS_BYTES", "validateLegacyNpmCommand") &&
      !legacyNpmCommand.uses("writeFile") &&
      toolchainManager.hasString("plugin-install") &&
      toolchainManager.hasString("legacy-npm-command"),
    "legacy npmCommand migration must remain bounded, read-only, probed, and scoped to plugin compatibility",
  ],
  [
    toolchainStateStore.usesAll("hasFutureSchema", "compatibilityReadOnly", "primaryHasFutureSchema") &&
      toolchainStateStore.hasStringContaining("written by a newer Pi Desktop"),
    "future toolchain state must remain read-only so application rollback cannot overwrite managed runtime ownership",
  ],
  [!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html.text), "renderer HTML must not contain inline scripts"],
  [preload.importsFrom("../contract/desktop"), "preload must use the shared desktop bridge contract"],
  [globals.importsFrom("../contract/desktop"), "renderer globals must use the shared desktop bridge contract"],
  [credentialVault.uses("safeStorage.encryptString"), "channel credentials must use Electron safeStorage"],
  [credentialVault.uses("safeStorage.isEncryptionAvailable"), "channel credential persistence must fail closed"],
  [!feishuChannelApi.matches(/createServer|\.listen\s*\(/), "Feishu WebSocket mode must not open a local listener"],
  [
    feishuChannelApi.matches(/im\.v1\.messageResource\.get/) &&
      feishuChannelApi.uses("FEISHU_MEDIA_MAX_BYTES") &&
      feishuChannelApi.uses("readLimitedStream"),
    "Feishu inbound media must use the message resource API with a local byte limit",
  ],
  [
    channelManager.before("evaluateInboundPolicy", "adapter.downloadInbound"),
    "channel access policy must run before provider media download",
  ],
  [
    channelMediaStore.usesAll("CHANNEL_MEDIA_MAX_BYTES", "CHANNEL_MEDIA_MAX_ATTACHMENTS") &&
      channelMediaStore.calls("info.isSymbolicLink") &&
      channelMediaStore.hasProperty("mode", "0o600"),
    "channel media staging must retain byte/count/symlink/private-file controls",
  ],
  [
    channelOutboundFiles.uses("realpath") &&
      channelOutboundFiles.uses("MARKDOWN_LINK") &&
      channelOutboundFiles.matches(/isInside\(\s*canonical/) &&
      channelPiBridge.matches(/collectOutboundFiles\(\{\s*finalText/),
    "linked-file delivery must remain inside the actual bound session workspace",
  ],
  [
    channelPiBridge.calls("channelPromptText") && !channelPiBridge.hasString("[外部消息来源："),
    "channel user prompts must contain the user's text without transport metadata wrappers",
  ],
  [
    rpcManager.hasProperty("expandPromptTemplates", "false") && rpcManager.uses("stripLegacyChannelPrompts"),
    "channel prompts must avoid local expansion and remove legacy transport metadata from model history",
  ],
  [!channelContract.uses("botToken") && !channelContract.uses("appSecret"), "channel RPC must not expose raw secrets"],
  [
    desktopContract.uses("setChannelCredential") && !desktopContract.uses("getChannelCredential"),
    "renderer channel credential bridge must remain write-only",
  ],
  [
    toolchainActionTypes.uses("ToolchainActionRequest") &&
      toolchainContractCheck.matches(/url\|uri\|sha\|hash\|path\|executable\|argv\|command/) &&
      verifyScript.hasString("toolchain contract safety"),
    "renderer toolchain actions must retain the URL/hash/path/executable/argv/command safety gate",
  ],
  [
    desktopContract.usesAll("getToolchainState", "rescanToolchains", "performToolchainAction", "onToolchainState") &&
      preload.hasString("desktop:toolchains:get-state") &&
      preload.hasString("desktop:toolchains:rescan") &&
      preload.hasString("desktop:toolchains:action") &&
      preload.hasString("toolchains:state") &&
      desktopIpc.hasString("desktop:toolchains:get-state") &&
      desktopIpc.hasString("desktop:toolchains:rescan") &&
      desktopIpc.hasString("desktop:toolchains:action") &&
      desktopIpc.uses("isToolchainActionRequest") &&
      // Three privileged toolchain channels, each of which must assert its sender.
      desktopIpc.countCalls("assertTrustedToolchainSender") >= 3 &&
      desktopIpc.matches(/event\.senderFrame\s*!==\s*win\.webContents\.mainFrame/) &&
      desktopIpc.calls("toolchainActionConfirmation") &&
      desktopIpc.uses("dialog.showMessageBox") &&
      desktopIpc.uses("validateOptionalToolchainCwd"),
    "toolchain bridge must validate senders/actions/workspaces and keep download/destructive consent in Main",
  ],
  [
    main.hasString("toolchain.resolve") &&
      main.matches(/typeof body\.trusted !== "boolean"/) &&
      !desktopContract.uses("trustedProject") &&
      !desktopContract.uses("projectTrusted"),
    "project-local tool trust must come from the app-owned Host and never from the Renderer bridge",
  ],
  [
    desktopContract.usesAll("getUpdateState", "checkForUpdates", "downloadUpdate", "installUpdate") &&
      !desktopContract.matches(/setFeedURL|feedUrl|feedURL/),
    "renderer updater contract must expose fixed actions without a configurable feed",
  ],
  [
    preload.hasString("desktop:update:check") &&
      preload.hasString("desktop:update:download") &&
      preload.hasString("desktop:update:install") &&
      preload.hasString("update:state"),
    "preload updater bridge must use fixed IPC channels",
  ],
  [
    desktopIpc.hasString("desktop:update:set-automatic-checks") &&
      desktopIpc.matches(/typeof enabled !== "boolean"/) &&
      !desktopIpc.matches(/setFeedURL|feedUrl|feedURL/),
    "updater IPC must validate its only mutable preference and reject feed configuration",
  ],
  [
    updateAdapter.assigns("updater.autoDownload", "false") &&
      updateAdapter.assigns("updater.autoInstallOnAppQuit", "true") &&
      updateAdapter.assigns("updater.allowPrerelease", "false") &&
      updateAdapter.assigns("updater.allowDowngrade", "false") &&
      updateAdapter.assigns("updater.disableWebInstaller", "true") &&
      updateAdapter.assigns("updater.logger", "null") &&
      updateAdapter.hasString("darwin") &&
      updateAdapter.hasString("win32") &&
      !updateAdapter.uses("WINDOWS_UPDATES_RELEASE_READY") &&
      !updateAdapter.uses("process.env"),
    "production updater must support macOS and Windows while remaining stable-only, consent-first, and using redacted application logging",
  ],
  [
    !electronBuilderConfig.matches(/^\s*publisherName\s*:/im) &&
      desktopBuildWorkflow.hasValueMatching(/publisherName field in an unsigned Windows release/) &&
      desktopBuildWorkflow.hasValueMatching(/publisherName/),
    "unsigned Windows updates must omit publisher verification in both build configuration and packaged release checks",
  ],
  [
    updateManager.hasString("darwin") &&
      updateManager.hasString("win32") &&
      updateManager.uses("options.isPackaged") &&
      updateManager.uses("explicitlyEnabledForDevelopment") &&
      updateManager.uses("redactUpdateError") &&
      updateManager.uses("setRunningSessionCount"),
    "updater manager must retain platform/package gating, redaction, and active-session protection",
  ],
  [
    main.uses("createProductionUpdateAdapter") &&
      main.calls("win.webContents.send") &&
      main.hasString("update:state") &&
      main.matches(/setRunningSessionCount\(ids\.length\)/) &&
      main.calls("updateManager.startAutomaticChecks"),
    "main process must own updater initialization, state publication, and session-aware scheduling",
  ],
  [
    desktopIpc.calls("assertTrustedToolchainSender") &&
      desktopIpc.uses("event.senderFrame") &&
      desktopIpc.uses("win.webContents.mainFrame"),
    "privileged desktop IPC must validate the main-window sender and frame",
  ],
  [
    !main.hasString("remote-debugging-port") &&
      !main.hasString("ignore-certificate-errors") &&
      !windowFactory.hasProperty("webSecurity", "false"),
    "production code must not expose remote debugging or global certificate bypass, or weaken the main Renderer",
  ],
  [
    toolchainBash.matches(/await beforeExec\?\..{0,2}\(command\)/),
    "Bash execution must run its pre-execution hook before spawning the shell",
  ],
  [
    !/"(?:playwright|puppeteer)"\s*:/.test(packageJson.text),
    "the app must not bundle a second browser automation stack",
  ],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`OK: ${checks.length} desktop security invariants hold`);
