import assert from "node:assert/strict";
import test from "node:test";

import { THEME_KEY, readStoredTheme, writeStoredTheme } from "./theme-storage.ts";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function withStorage(storage, run) {
  const original = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    run();
  } finally {
    globalThis.localStorage = original;
  }
}

test("reads the current key", () => {
  withStorage(createStorage({ [THEME_KEY]: "niri" }), () => {
    assert.equal(readStoredTheme(), "niri");
  });
});

test("adopts a legacy key once, so the choice survives the rename", () => {
  const storage = createStorage({ theme: "niri" });
  withStorage(storage, () => {
    assert.equal(readStoredTheme(), "niri");
    assert.equal(storage.getItem(THEME_KEY), "niri");
  });
});

test("prefers the current key over a legacy one", () => {
  withStorage(createStorage({ [THEME_KEY]: "light", theme: "niri" }), () => {
    assert.equal(readStoredTheme(), "light");
  });
});

test("returns null when nothing is stored", () => {
  withStorage(createStorage(), () => {
    assert.equal(readStoredTheme(), null);
  });
});

test("survives storage that throws", () => {
  const hostile = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  withStorage(hostile, () => {
    assert.equal(readStoredTheme(), null);
    assert.doesNotThrow(() => writeStoredTheme("dark"));
  });
});
