import { useCallback, useEffect, useState } from "react";

import { call } from "@/lib/api-client";
import type { GoalState } from "@shared/api-types";

const POLL_MS = 2000;

/**
 * Goal mode for the active conversation.
 *
 * The host owns the state (it runs the review loop), so this mirrors it and
 * re-reads while a goal is being worked on — a review can change the state
 * without any renderer action.
 */
export function useGoal(sessionId: string | null) {
  const [state, setState] = useState<GoalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setState(null);
      return;
    }
    try {
      const result = await call("goal.get", { sessionId });
      setState(result.state ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const active = state?.status === "active";
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [state?.status, refresh]);

  const setGoal = useCallback(
    async (text: string, maxRounds: number, autoReview: boolean) => {
      if (!sessionId) return;
      setBusy(true);
      try {
        const result = await call("goal.set", { sessionId, text, maxRounds, autoReview });
        setState(result.state ?? null);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  const clearGoal = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await call("goal.clear", { sessionId });
      setState(result.state ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  return { state, busy, error, setGoal, clearGoal, refresh };
}
