/**
 * Reduce relay-forwarded AgentEvents into a small chat model.
 *
 * The desktop session is the source of truth: history arrives as an array of UI
 * messages, live turns arrive as raw AgentEvents. Both funnel into DisplayItem so
 * a phone can render them with one code path.
 */

/**
 * Stable identity for a rendered item.
 *
 * Index keys are wrong for a list that can gain an item in the middle (a tool result arriving for an
 * earlier call), because React then reuses a component instance for a different message and its
 * expanded/collapsed state sticks to the wrong row. The key is assigned when the item is created and
 * survives every later patch of that item.
 */
let itemSequence = 0;

function nextItemKey(): string {
  itemSequence += 1;
  return `item-${itemSequence}`;
}

export type DisplayItem =
  | { kind: "user"; key: string; text: string; images?: string[] }
  | { kind: "assistant"; key: string; text: string; thinking: string; streaming: boolean; error?: string }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      status: "running" | "done" | "error";
      input?: unknown;
      output?: string;
    }
  | { kind: "custom"; key: string; customType: string; text: string; details?: unknown };

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;
type AssistantItem = Extract<DisplayItem, { kind: "assistant" }>;
type UserItem = Extract<DisplayItem, { kind: "user" }>;

type LooseMessage = {
  role?: string;
  content?: unknown;
  customType?: string;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
};

type ContentBlock = { type?: string; text?: string; thinking?: string };

function blocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

function textOf(content: unknown): string {
  return blocks(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

function thinkingOf(content: unknown): string {
  return blocks(content)
    .filter((block) => block.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking as string)
    .join("\n");
}

/** A user message echoed locally before the desktop confirms it. */
export function userItem(text: string, images: string[] = []): UserItem {
  return { kind: "user", key: nextItemKey(), text, ...(images.length > 0 ? { images } : {}) };
}

/** `data:` URLs for the image blocks of a message, so history shows the photos too. */
function imagesOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => (block as { type?: string }).type === "image")
    .map((block) => {
      const image = block as { data?: unknown; mimeType?: unknown };
      if (typeof image.data !== "string" || image.data.length === 0) return "";
      const mime = typeof image.mimeType === "string" && image.mimeType ? image.mimeType : "image/png";
      return `data:${mime};base64,${image.data}`;
    })
    .filter((url) => url.length > 0);
}

export function fromMessage(raw: unknown): DisplayItem | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as LooseMessage;
  switch (message.role) {
    case "user": {
      const text = textOf(message.content);
      const images = imagesOf(message.content);
      if (!text && images.length === 0) return null;
      return userItem(text, images);
    }
    case "assistant": {
      return {
        kind: "assistant",
        key: nextItemKey(),
        text: textOf(message.content),
        thinking: thinkingOf(message.content),
        streaming: false,
        ...(message.errorMessage ? { error: message.errorMessage } : {}),
      };
    }
    case "toolResult": {
      return {
        kind: "tool",
        key: nextItemKey(),
        id: String(message.toolCallId ?? ""),
        name: String(message.toolName ?? "tool"),
        status: message.isError ? "error" : "done",
        output: textOf(message.content),
      };
    }
    case "custom": {
      return {
        kind: "custom",
        key: nextItemKey(),
        customType: String(message.customType ?? "custom"),
        text: textOf(message.content),
        ...(message.details !== undefined ? { details: message.details } : {}),
      };
    }
    default:
      return null;
  }
}

export function fromMessages(messages: unknown[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const message of messages) {
    const item = fromMessage(message);
    if (item) items.push(item);
  }
  return items;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function upsertTool(items: DisplayItem[], id: string, patch: Partial<ToolItem>): DisplayItem[] {
  const index = items.findIndex((item) => item.kind === "tool" && item.id === id);
  if (index === -1) {
    return [
      ...items,
      { kind: "tool", key: nextItemKey(), id, name: patch.name ?? "tool", status: patch.status ?? "running", ...patch },
    ];
  }
  const next = items.slice();
  next[index] = { ...(items[index] as ToolItem), ...patch };
  return next;
}

function upsertAssistant(items: DisplayItem[], patch: Partial<AssistantItem>, finalize: boolean): DisplayItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && last.streaming) {
    const next = items.slice();
    next[next.length - 1] = { ...last, ...patch, streaming: !finalize };
    return next;
  }
  return [...items, { kind: "assistant", key: nextItemKey(), text: "", thinking: "", streaming: !finalize, ...patch }];
}

export function applyEvent(items: DisplayItem[], raw: unknown): DisplayItem[] {
  if (!raw || typeof raw !== "object") return items;
  const event = raw as {
    type?: string;
    message?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    args?: unknown;
    partialResult?: unknown;
    result?: unknown;
    isError?: unknown;
  };
  const type = event.type ?? "";

  if (type === "message_start" || type === "message_update" || type === "message_end") {
    const message = event.message as LooseMessage | undefined;
    if (!message) return items;
    if (message.role === "assistant") {
      const item = fromMessage(message) as AssistantItem | null;
      if (!item) return items;
      return upsertAssistant(
        items,
        { text: item.text, thinking: item.thinking, ...(item.error ? { error: item.error } : {}) },
        type === "message_end",
      );
    }
    if (message.role === "toolResult") {
      const item = fromMessage(message) as ToolItem | null;
      return item ? upsertTool(items, item.id, item) : items;
    }
    if (message.role === "user") {
      const item = fromMessage(message) as UserItem | null;
      if (!item) return items;
      const lastUser = [...items].reverse().find((entry): entry is UserItem => entry.kind === "user");
      if (lastUser?.text === item.text) return items;
      return [...items, item];
    }
    const custom = fromMessage(message);
    return custom ? [...items, custom] : items;
  }

  if (type === "tool_execution_start") {
    return upsertTool(items, String(event.toolCallId ?? ""), {
      name: String(event.toolName ?? "tool"),
      status: "running",
      input: event.args,
    });
  }
  if (type === "tool_execution_update") {
    return upsertTool(items, String(event.toolCallId ?? ""), {
      name: String(event.toolName ?? "tool"),
      status: "running",
      output: stringify(event.partialResult),
    });
  }
  if (type === "tool_execution_end") {
    return upsertTool(items, String(event.toolCallId ?? ""), {
      name: String(event.toolName ?? "tool"),
      status: event.isError ? "error" : "done",
      output: stringify(event.result),
    });
  }
  return items;
}
