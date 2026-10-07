#!/usr/bin/env node
/**
 * Build the hot-update runtime overlay:
 *
 *   out/runtime/host/agent-host.mjs      self-contained agent host
 *   out/runtime/host/plugin-worker.mjs   self-contained worker (spawned next to the host)
 *   out/runtime/renderer/**              the UI bundle
 *
 * `scripts/hot-runtime.mjs` installs this into the app's userData dir, where the
 * running app picks it up (host restart + UI reload) without a repackage.
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const piVersion = pkg.dependencies?.["@earendil-works/pi-coding-agent"];
if (!piVersion) throw new Error("package.json is missing @earendil-works/pi-coding-agent");

// CJS dependencies inside the pi SDK expect `require`, `__dirname` and `__filename`
// even when the surrounding bundle is ESM.
const banner = [
  "import { createRequire as __cr } from 'node:module';",
  "import { fileURLToPath as __fp } from 'node:url';",
  "import { dirname as __dn } from 'node:path';",
  "const require = __cr(import.meta.url);",
  "const __filename = __fp(import.meta.url);",
  "const __dirname = __dn(__filename);",
].join(" ");

const runtimeDir = path.join(root, "out", "runtime");
const hostDir = path.join(runtimeDir, "host");
rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(hostDir, { recursive: true });

// codemode resolves its QuickJS wasm and its worker from the package tree at call time, so the
// self-contained host cannot inline these two. They stay external and are copied next to the
// bundle, which is the resolution root for the host's own `createRequire(import.meta.url)`.
const onDiskPackages = ["@earendil-works/pi-codemode", "quickjs-wasi"];

await build({
  absWorkingDir: root,
  entryPoints: {
    "agent-host": "src/agent-host/index.ts",
    "plugin-worker": "src/agent-host/plugin-worker.ts",
  },
  outdir: hostDir,
  bundle: true, // self-contained: no node_modules on the host's resolution path
  external: onDiskPackages,
  format: "esm",
  platform: "node",
  target: "node22",
  banner: { js: banner },
  define: { "process.env.PI_DESKTOP_EXPECTED_PI_VERSION": JSON.stringify(piVersion) },
  sourcemap: false,
  logLevel: "warning",
  outExtension: { ".js": ".mjs" },
});

const rendererSrc = path.join(root, "out", "renderer");
if (existsSync(rendererSrc)) {
  cpSync(rendererSrc, path.join(runtimeDir, "renderer"), { recursive: true });
}

const hostNodeModules = path.join(hostDir, "node_modules");
for (const name of onDiskPackages) {
  const from = path.join(root, "node_modules", name);
  if (!existsSync(from)) throw new Error(`[build-runtime] ${name} is missing from node_modules`);
  const to = path.join(hostNodeModules, name);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

// The running app decides whether to trust this overlay by comparing the manifest's app version with
// its own: a repackage bumps the version and retires the overlay instead of letting it shadow the
// fresh bundle. File timestamps cannot be used, because Electron reports an asar entry's mtime as
// the process start time.
writeFileSync(
  path.join(runtimeDir, "runtime-manifest.json"),
  `${JSON.stringify({ appVersion: pkg.version, piVersion, builtAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);

console.log("[build-runtime] out/runtime ready");
