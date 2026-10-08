import assert from "node:assert/strict";
import test from "node:test";
import { setGitCommandRunner } from "./worktree.ts";
import {
  assertSafeRef,
  checkoutBranch,
  commitChanges,
  getDiff,
  listBranches,
  pullBranch,
  pushBranch,
  stagePaths,
  unstagePaths,
} from "./git-repository.ts";

/** Records the argv each operation runs, and returns canned stdout. */
function withGit(handler) {
  const calls = [];
  const restore = setGitCommandRunner({
    async run(cwd, args) {
      calls.push(args.join(" "));
      return { stdout: handler(args) ?? "" };
    },
  });
  return { calls, restore };
}

test("every operation passes its arguments as argv, never through a shell", async () => {
  const { calls, restore } = withGit(() => "");
  try {
    await stagePaths("/repo", ["a b.txt", "c.txt"]);
    await unstagePaths("/repo", ["c.txt"]);
    await commitChanges("/repo", "fix: a message with $HOME and `backticks`");
    await pushBranch("/repo");
    await pullBranch("/repo");
    await checkoutBranch("/repo", "feature/x");
  } finally {
    restore();
  }
  assert.deepEqual(calls, [
    "add -- a b.txt c.txt",
    "restore --staged -- c.txt",
    "commit -m fix: a message with $HOME and `backticks`",
    "push",
    "pull --ff-only",
    "checkout feature/x",
  ]);
});

test("diff reports its files and cuts an oversized patch", async () => {
  const { restore } = withGit((args) => (args.includes("--name-only") ? "a.ts\nb.ts\n" : "x".repeat(500_000)));
  try {
    const result = await getDiff("/repo", true);
    assert.deepEqual(result.files, ["a.ts", "b.ts"]);
    assert.equal(result.truncated, true);
    assert.ok(result.patch.length < 500_000);
  } finally {
    restore();
  }
});

test("an unstaged diff has no --cached", async () => {
  const { calls, restore } = withGit(() => "");
  try {
    await getDiff("/repo", false);
  } finally {
    restore();
  }
  assert.equal(
    calls.some((call) => call.includes("--cached")),
    false,
  );
});

test("branches report the current one, and a detached HEAD is null", async () => {
  const attached = withGit((args) => (args[0] === "branch" ? "main\nfeature/x\n" : "main\n"));
  try {
    assert.deepEqual(await listBranches("/repo"), { current: "main", branches: ["main", "feature/x"] });
  } finally {
    attached.restore();
  }

  const detached = withGit((args) => (args[0] === "branch" ? "main\n" : "HEAD\n"));
  try {
    assert.equal((await listBranches("/repo")).current, null);
  } finally {
    detached.restore();
  }
});

test("branch names that could be read as options or escape the ref namespace are rejected", async () => {
  for (const bad of ["-f", "--force", "a..b", "refs/heads/", "with space", "trailing/"]) {
    assert.throws(() => assertSafeRef(bad, "branch name"), /Invalid branch name/, bad);
  }
  assert.equal(assertSafeRef("feature/x-1.2", "branch name"), "feature/x-1.2");

  const { restore } = withGit(() => "");
  try {
    await assert.rejects(async () => checkoutBranch("/repo", "--force"), /Invalid branch name/);
  } finally {
    restore();
  }
});

test("an empty commit message and an empty path list are refused", async () => {
  await assert.rejects(async () => commitChanges("/repo", "   "), /commit message/);
  await assert.rejects(async () => stagePaths("/repo", []), /No paths/);
  await assert.rejects(async () => unstagePaths("/repo", []), /No paths/);
});
