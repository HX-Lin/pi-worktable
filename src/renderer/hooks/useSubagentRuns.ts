import { useEffect, useState } from "react";

import { call } from "@/lib/api-client";

export interface SubagentRun {
  id: string;
  agent: string;
  task: string;
  model?: string;
  cwd: string;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  lastLine?: string;
  error?: string;
  tokens?: number;
}

/**
 * Subagent runs live inside tool calls, so the only way to see them from the UI
 * is to ask the host — polled, and only while something is watching.
 */
export function useSubagentRuns(enabled: boolean, intervalMs = 1500) {
  const [runs, setRuns] = useState<SubagentRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const result = await call("subagents.list");
        if (!cancelled) {
          setRuns(result.runs ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return { runs, error };
}
