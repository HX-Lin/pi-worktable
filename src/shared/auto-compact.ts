/**
 * Auto-compaction helpers.
 *
 * pi compacts on token thresholds on its own; the desktop app additionally
 * triggers a context compaction once the window passes
 * {@link AUTO_COMPACT_CONTEXT_PERCENT}, and surfaces a manual control near the
 * composer before that point. Session history is never deleted.
 *
 * A **turn** is one message the user sent, not a raw message: a single turn
 * routinely produces dozens of assistant steps and tool results, so counting
 * messages made one exchange look like a hundred. The counting helpers here
 * feed the figures the UI shows.
 */

/**
 * Context fill level that triggers an automatic *context* compaction.
 *
 * This is deliberately not the memory threshold: pi's own summarization frees
 * room for the model and leaves every message on disk, while deleting the
 * digested history is reserved for "压缩为记忆" at the user's turn threshold.
 */
export const AUTO_COMPACT_CONTEXT_PERCENT = 75;

/** Retry after a compaction that could not shrink the context once it grows this much. */
export const AUTO_COMPACT_RETRY_PERCENT_GROWTH = 5;

/**
 * Detail key that marks a compaction entry as a memory compaction.
 *
 * pi compacts the context on its own whenever the token budget runs out, and
 * that is a different operation: it only frees room for the model and must not
 * delete session history or count towards the memory threshold. Marking the
 * entries produced by "压缩为记忆" is what keeps the two apart.
 */
export const MEMORY_COMPACTION_DETAIL_KEY = "piDesktopMemoryCompaction";

/** True when a session entry is a compaction produced by "压缩为记忆". */
export function isMemoryCompactionEntry(entry: unknown): boolean {
  if ((entry as { type?: unknown } | null)?.type !== "compaction") return false;
  const details = (entry as { details?: unknown }).details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as Record<string, unknown>)[MEMORY_COMPACTION_DETAIL_KEY] === true
  );
}

/** Minimal shape needed to count conversation messages in a UI list. */
interface ConversationMessageLike {
  role?: unknown;
}

/** Count user/assistant conversation messages in a UI message list. */
export function countConversationMessages(messages: readonly ConversationMessageLike[]): number {
  let count = 0;
  for (const message of messages) {
    if (message?.role === "user" || message?.role === "assistant") count += 1;
  }
  return count;
}

/**
 * Index of the first entry that still belongs to the active context.
 *
 * Everything before the latest compaction entry has been folded into memory, so
 * it must not keep inflating the counters.
 */
function activeContextStartIndex(entries: readonly unknown[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if ((entries[index] as { type?: unknown } | null)?.type === "compaction") return index + 1;
  }
  return 0;
}

/**
 * Count conversation (user/assistant) messages on a session branch.
 *
 * Tool results and bookkeeping entries are excluded so the number reflects what
 * a user perceives as messages in the chat.
 */
export function countBranchConversationMessages(entries: readonly unknown[]): number {
  let count = 0;
  for (let index = activeContextStartIndex(entries); index < entries.length; index += 1) {
    const record = entries[index] as { type?: unknown; message?: { role?: unknown } } | null;
    if (!record || record.type !== "message") continue;
    const role = record.message?.role;
    if (role === "user" || role === "assistant") count += 1;
  }
  return count;
}
