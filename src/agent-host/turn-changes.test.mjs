import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureTurnStart, collectTurnChanges } from "./turn-changes.ts";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-turn-changes-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  writeFileSync(join(cwd, "dirty.txt"), "original\n");
  writeFileSync(join(cwd, "clean.txt"), "start\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "initial");
  return cwd;
}

test("records only this turn's edits, including edits to already dirty files and new files", async () => {
  const cwd = repo();
  try {
    writeFileSync(join(cwd, "dirty.txt"), "earlier edit\n");
    const start = await captureTurnStart(cwd);
    assert.ok(start);
    writeFileSync(join(cwd, "dirty.txt"), "earlier edit\nturn edit\n");
    writeFileSync(join(cwd, "clean.txt"), "new content\n");
    writeFileSync(join(cwd, "new.txt"), "new file\n");
    const { files, omitted } = await collectTurnChanges(start);
    assert.equal(omitted, 0);
    assert.deepEqual(
      files.map((file) => file.path),
      ["clean.txt", "dirty.txt", "new.txt"],
    );
    assert.match(files[1].patch, /\+turn edit/);
    assert.doesNotMatch(files[1].patch, /-original/);
    assert.equal(files[1].added, 1);
    assert.equal(files[1].removed, 0);
    assert.match(files[2].patch, /\+new file/);
    assert.deepEqual(await collectTurnChanges(await captureTurnStart(cwd)), { files: [], omitted: 0 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("committed and deleted files are still attributed to the completed turn", async () => {
  const cwd = repo();
  try {
    const start = await captureTurnStart(cwd);
    assert.ok(start);
    writeFileSync(join(cwd, "clean.txt"), "committed\n");
    rmSync(join(cwd, "dirty.txt"));
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", "agent edits");
    const { files } = await collectTurnChanges(start);
    assert.deepEqual(
      files.map((file) => file.path),
      ["clean.txt", "dirty.txt"],
    );
    assert.match(files[0].patch, /\+committed/);
    assert.match(files[1].patch, /-original/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("binary changes stay in the file list without storing their bytes", async () => {
  const cwd = repo();
  try {
    const start = await captureTurnStart(cwd);
    assert.ok(start);
    writeFileSync(join(cwd, "binary.dat"), Buffer.from([0, 1, 2]));
    assert.deepEqual(await collectTurnChanges(start), {
      files: [{ path: "binary.dat", added: 0, removed: 0, patch: null }],
      omitted: 0,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the bounded file list reports paths it could not inspect", async () => {
  const cwd = repo();
  try {
    const start = await captureTurnStart(cwd);
    assert.ok(start);
    for (let index = 0; index < 51; index++) {
      writeFileSync(join(cwd, `new-${String(index).padStart(2, "0")}.txt`), "content\n");
    }
    const { files, omitted } = await collectTurnChanges(start);
    assert.equal(files.length, 50);
    assert.equal(omitted, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("subdirectory changes stay scoped to the active working directory", async () => {
  const root = repo();
  try {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "inner.txt"), "before\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "subdir");
    const start = await captureTurnStart(join(root, "sub"));
    assert.ok(start);
    writeFileSync(join(root, "sub", "inner.txt"), "after\n");
    writeFileSync(join(root, "clean.txt"), "outside\n");
    const { files } = await collectTurnChanges(start);
    assert.deepEqual(
      files.map((file) => file.path),
      ["inner.txt"],
    );
    assert.match(files[0].patch, /\+after/);
    assert.equal(readFileSync(join(root, "clean.txt"), "utf8"), "outside\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
