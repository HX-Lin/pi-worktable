import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `web-seen-${process.pid}.mjs`);
mkdirSync(path.dirname(output), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["web/src/seen.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});

/** Minimal localStorage so the module can run outside a browser. */
function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  return store;
}

installStorage();
const { isUnread, loadSeen, markSeen, saveSeen } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

test("a session file that changed after the last look is unread", () => {
  const seen = { a: "2026-01-01T00:00:00Z" };
  assert.equal(isUnread("a", "2026-01-01T00:00:00Z", seen), false);
  assert.equal(isUnread("a", "2026-01-01T00:10:00Z", seen), true);
  assert.equal(isUnread("b", "2026-01-01T00:10:00Z", seen), true);
});

test("a session without an update time is never unread", () => {
  assert.equal(isUnread("a", undefined, {}), false);
});

test("markSeen returns the same object when nothing changed", () => {
  const seen = { a: "x" };
  assert.equal(markSeen(seen, [{ id: "a", updatedAt: "x" }]), seen);
  const next = markSeen(seen, [{ id: "a", updatedAt: "y" }]);
  assert.notEqual(next, seen);
  assert.equal(next.a, "y");
});

test("an entry without an update time is stored as an empty marker", () => {
  assert.deepEqual(markSeen({}, [{ id: "a" }]), { a: "" });
});

test("marks survive a save and load round trip", () => {
  installStorage();
  saveSeen({ a: "t1", b: "t2" });
  assert.deepEqual(loadSeen(), { a: "t1", b: "t2" });
});

test("corrupt or missing storage yields no marks instead of throwing", () => {
  const store = installStorage();
  store.set("pi-h5-seen-sessions", "{ not json");
  assert.deepEqual(loadSeen(), {});
  store.delete("pi-h5-seen-sessions");
  assert.deepEqual(loadSeen(), {});
  store.set("pi-h5-seen-sessions", JSON.stringify({ a: 7, b: "ok" }));
  assert.deepEqual(loadSeen(), { b: "ok" });
});
