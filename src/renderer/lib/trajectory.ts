/**
 * Turn a session transcript into a timeline.
 *
 * Only what the transcript actually records is used: each message has a
 * timestamp, and a tool call is matched with its result — so tool durations are
 * real, while a thinking/answer block shares its message's timestamp and is
 * reported as one span rather than invented per-block timing.
 */
import type { AgentMessage, AssistantContentBlock } from "../../shared/types.ts";

export type TrajectoryKind = "user" | "answer" | "tool" | "custom" | "error";

export interface TrajectorySpan {
  kind: TrajectoryKind;
  /** Row label: the tool name, or a short description of the message. */
  label: string;
  /** Wall-clock start (ms since epoch). */
  start: number;
  /** Wall-clock end (ms). Equal to start when the next event is unknown. */
  end: number;
  /** One-line preview for the list and the detail pane. */
  preview: string;
  /** Tool spans only. */
  toolName?: string;
  isError?: boolean;
  /** Full text for the detail pane (tool input, message body…). */
  detail?: string;
}

export interface TrajectorySummary {
  spans: TrajectorySpan[];
  /** Wall clock covered by the transcript. */
  totalMs: number;
  /** Time spent inside tool calls (sum of matched call→result windows). */
  toolMs: number;
  toolCount: number;
  errorCount: number;
}

const PREVIEW_CHARS = 140;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function messageText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function blockDetail(block: AssistantContentBlock): string | undefined {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return safeJson(block.input);
  return undefined;
}

function messageDetail(message: AgentMessage): string | undefined {
  if (message.role === "assistant") {
    const parts = message.content.map((block) => blockDetail(block)).filter((text): text is string => Boolean(text));
    return parts.join("\n\n");
  }
  if (message.role === "custom")
    return typeof message.content === "string" ? message.content : messageText(message.content);
  return messageText(message.content);
}

function messageLabel(message: AgentMessage): { kind: TrajectoryKind; label: string } {
  if (message.role === "user") return { kind: "user", label: "user" };
  if (message.role === "custom") return { kind: "custom", label: message.customType };
  if (message.role === "toolResult") return { kind: "tool", label: message.toolName ?? "tool" };
  const hasText = message.content.some((block) => block.type === "text" && block.text.trim().length > 0);
  const hasThinking = message.content.some((block) => block.type === "thinking");
  if (!hasText && hasThinking) return { kind: "answer", label: "thinking" };
  return { kind: "answer", label: message.model || "assistant" };
}

/**
 * Build spans in transcript order. A message's span ends where the next one
 * starts, which is what "time spent on this step" means for a transcript that
 * records no finer boundaries.
 */
export function buildTrajectory(messages: AgentMessage[]): TrajectorySummary {
  const timed = messages
    .map((message, index) => ({ message, index, at: typeof message.timestamp === "number" ? message.timestamp : null }))
    .filter((entry): entry is { message: AgentMessage; index: number; at: number } => entry.at !== null);

  if (timed.length === 0) {
    return { spans: [], totalMs: 0, toolMs: 0, toolCount: 0, errorCount: 0 };
  }

  // Tool results arrive as their own messages; index them by call id so a call
  // can be measured against its result.
  const results = new Map<string, { at: number; isError: boolean; text: string }>();
  for (const { message, at } of timed) {
    if (message.role !== "toolResult") continue;
    results.set(message.toolCallId, {
      at,
      isError: message.isError === true,
      text: messageText(message.content),
    });
  }

  const spans: TrajectorySpan[] = [];
  let toolMs = 0;
  let toolCount = 0;
  let errorCount = 0;

  timed.forEach((entry, position) => {
    const { message, at } = entry;
    if (message.role === "toolResult") return; // folded into its call's span

    const next = timed[position + 1]?.at;
    const end = next ?? at;
    const { kind, label } = messageLabel(message);
    const text = messageDetail(message) ?? "";

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const result = results.get(block.toolCallId);
        const callEnd = result?.at ?? end;
        const duration = Math.max(0, callEnd - at);
        toolMs += duration;
        toolCount += 1;
        if (result?.isError) errorCount += 1;
        spans.push({
          kind: "tool",
          label: block.toolName,
          toolName: block.toolName,
          start: at,
          end: callEnd,
          isError: result?.isError,
          preview: preview(safeJson(block.input)),
          detail: result?.text ? `${safeJson(block.input)}\n\n---\n${result.text}` : safeJson(block.input),
        });
      }
    }

    spans.push({
      kind,
      label,
      start: at,
      end,
      preview: preview(text),
      detail: text,
    });
  });

  spans.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
  const first = timed[0].at;
  const last = timed[timed.length - 1]?.at ?? first;
  return {
    spans,
    totalMs: Math.max(0, last - first),
    toolMs,
    toolCount,
    errorCount,
  };
}

/** Bar geometry as percentages of the wall-clock window. */
export function spanGeometry(
  span: { start: number; end: number },
  window: { start: number; end: number },
): { left: number; width: number } {
  const total = Math.max(1, window.end - window.start);
  const left = ((span.start - window.start) / total) * 100;
  const raw = ((span.end - span.start) / total) * 100;
  return { left: Math.max(0, Math.min(100, left)), width: Math.max(0.4, Math.min(100 - left, raw)) };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(Math.round(seconds % 60))}s`;
}
