import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const output = path.join(root, ".artifacts", "test-modules", `tasks-store-${process.pid}.mjs`);
await build({
  absWorkingDir: root,
  entryPoints: ["src/agent-host/tasks/store.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "silent",
});
const { addTask, hasTaskBoard, readTasks, removeTask, tasksFilePath, updateTask, writeTasks } = await import(
  `${pathToFileURL(output).href}?v=${Date.now()}`
);
process.once("exit", () => rmSync(output, { force: true }));

function withProject(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-tasks-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the board lives in the project's pi config directory", () => {
  withProject((dir) => {
    assert.equal(hasTaskBoard(dir), false);
    assert.equal(tasksFilePath(dir), path.join(dir, ".pi", "tasks.json"));
    assert.deepEqual(readTasks(dir), []);
  });
});

test("adding, updating and removing a task round-trips through the file", () => {
  withProject((dir) => {
    const task = addTask(dir, { title: "  Ship the board  ", notes: "with tests" });
    assert.equal(task.title, "Ship the board");
    assert.equal(task.status, "todo");
    assert.equal(hasTaskBoard(dir), true);

    const stored = JSON.parse(readFileSync(tasksFilePath(dir), "utf8"));
    assert.equal(stored.version, 1);
    assert.equal(stored.tasks.length, 1);

    const updated = updateTask(dir, { id: task.id, status: "done" });
    assert.equal(updated.status, "done");
    assert.equal(readTasks(dir)[0].status, "done");

    assert.equal(removeTask(dir, task.id), true);
    assert.equal(removeTask(dir, task.id), false);
    assert.deepEqual(readTasks(dir), []);
  });
});

test("an unknown id is reported, not created", () => {
  withProject((dir) => {
    assert.equal(updateTask(dir, { id: "nope", status: "done" }), null);
    assert.equal(removeTask(dir, "nope"), false);
  });
});

test("clearing notes removes the key rather than storing an empty string", () => {
  withProject((dir) => {
    const task = addTask(dir, { title: "t", notes: "note" });
    const cleared = updateTask(dir, { id: task.id, notes: "" });
    assert.equal("notes" in cleared, false);
  });
});

test("a corrupt or foreign board file degrades to an empty list", () => {
  withProject((dir) => {
    writeTasks(dir, [{ id: "keep", title: "Keep", status: "doing", createdAt: "x", updatedAt: "x" }]);
    assert.equal(readTasks(dir).length, 1);

    // A file written by hand with junk entries keeps the valid ones.
    writeTasks(dir, [{ id: "a", title: "A", status: "nonsense", createdAt: "x", updatedAt: "x" }, { title: "no id" }]);
    const tasks = readTasks(dir);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "todo");
  });
});
