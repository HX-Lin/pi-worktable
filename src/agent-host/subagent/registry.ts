/**
 * Live registry of subagent runs.
 *
 * The subagent tool runs its agents inside a tool call, so without this the only
 * sign of work is the tool card in the conversation that asked for it. The
 * registry lets any session show what is running right now — which agent, on
 * which model, for how long, and the last progress line.
 */

export type SubagentRunStatus = "running" | "done" | "failed" | "cancelled";

export interface SubagentRunView {
  id: string;
  agent: string;
  task: string;
  model?: string;
  cwd: string;
  /** Session that asked for the run, when known. */
  sessionId?: string;
  status: SubagentRunStatus;
  startedAt: number;
  finishedAt?: number;
  /** Last streamed progress line, trimmed. */
  lastLine?: string;
  error?: string;
  tokens?: number;
}

interface RunRecord extends SubagentRunView {
  /** Insertion order, used to keep parallel runs stable in the list. */
  seq: number;
}

/** Finished runs stay visible for a while so a quick job is not missed. */
const KEEP_FINISHED_MS = 5 * 60 * 1000;
const MAX_RECORDS = 50;

const runs = new Map<string, RunRecord>();
let counter = 0;

export interface SubagentRunHandle {
  id: string;
  update: (line: string) => void;
  finish: (outcome: { ok: boolean; error?: string; tokens?: number }) => void;
  cancel: () => void;
}

function prune(now = Date.now()): void {
  for (const [id, record] of runs) {
    if (record.status !== "running" && record.finishedAt && now - record.finishedAt > KEEP_FINISHED_MS) {
      runs.delete(id);
    }
  }
  while (runs.size > MAX_RECORDS) {
    const oldest = [...runs.values()].sort((a, b) => a.seq - b.seq)[0];
    if (!oldest) break;
    runs.delete(oldest.id);
  }
}

export function startSubagentRun(input: {
  agent: string;
  task: string;
  model?: string;
  cwd: string;
  sessionId?: string;
}): SubagentRunHandle {
  const id = `subagent-${String(++counter)}`;
  runs.set(id, {
    id,
    seq: counter,
    agent: input.agent,
    task: input.task,
    model: input.model,
    cwd: input.cwd,
    sessionId: input.sessionId,
    status: "running",
    startedAt: Date.now(),
  });
  prune();

  return {
    id,
    update(line: string) {
      const record = runs.get(id);
      if (!record) return;
      record.lastLine = line.trim().slice(0, 400);
    },
    finish({ ok, error, tokens }) {
      const record = runs.get(id);
      if (!record) return;
      record.status = ok ? "done" : "failed";
      record.finishedAt = Date.now();
      record.error = error;
      record.tokens = tokens;
    },
    cancel() {
      const record = runs.get(id);
      if (!record) return;
      record.status = "cancelled";
      record.finishedAt = Date.now();
    },
  };
}

export function listSubagentRuns(): SubagentRunView[] {
  prune();
  return [...runs.values()]
    .sort((a, b) => {
      // Running first (newest first), then recently finished.
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.startedAt - a.startedAt;
    })
    .map(({ seq: _seq, ...view }) => view);
}

/** Test seam. */
export function resetSubagentRunsForTests(): void {
  runs.clear();
  counter = 0;
}
