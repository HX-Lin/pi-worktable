import type { DisplayItem } from "./items";

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;
type CustomItem = Extract<DisplayItem, { kind: "custom" }>;

const TOOL_LABEL: Record<string, string> = {
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  bash: "执行命令",
  grep: "搜索内容",
  find: "查找文件",
  ls: "列出目录",
};

const TOOL_ICON: Record<string, string> = {
  read: "📄",
  write: "📝",
  edit: "✏️",
  bash: "⌨️",
  grep: "🔎",
  find: "🔎",
  ls: "📁",
};

const STATUS_LABEL: Record<ToolItem["status"], string> = {
  running: "运行中",
  done: "完成",
  error: "失败",
};

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** A short, human-readable line for the tool header (file path, command, pattern…). */
function toolDetail(item: ToolItem): string {
  const input = item.input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["file_path", "path", "command", "pattern", "query", "url", "prompt"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof input === "string") return input;
  return "";
}

export function ToolCard({ item }: { item: ToolItem }) {
  const detail = toolDetail(item);
  const output = item.output?.trim();
  return (
    <details className={`card tool-card ${item.status}`}>
      <summary className="card-head">
        <span className="card-icon">{TOOL_ICON[item.name] ?? "🔧"}</span>
        <span className="card-name">{TOOL_LABEL[item.name] ?? item.name}</span>
        {detail && <span className="card-detail">{detail}</span>}
        <span className={`status-pill ${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </summary>
      <div className="card-body">
        {item.input !== undefined && (
          <div className="block">
            <div className="block-label">输入</div>
            <pre>{pretty(item.input)}</pre>
          </div>
        )}
        {output ? (
          <div className="block">
            <div className="block-label">输出</div>
            <pre>{output}</pre>
          </div>
        ) : (
          item.status === "running" && <div className="muted">执行中…</div>
        )}
      </div>
    </details>
  );
}

interface TurnChangeFile {
  path: string;
  added: number;
  removed: number;
  patch: string | null;
}

function parseTurnChanges(details: unknown): { files: TurnChangeFile[]; omitted: number } | null {
  if (!details || typeof details !== "object") return null;
  const record = details as { files?: unknown; omitted?: unknown };
  if (!Array.isArray(record.files)) return null;
  const files = record.files.filter(
    (file): file is TurnChangeFile =>
      !!file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string",
  );
  return { files, omitted: typeof record.omitted === "number" ? record.omitted : 0 };
}

function DiffBlock({ patch }: { patch: string }) {
  return (
    <pre className="diff">
      {patch.split("\n").map((line, index) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+++") || line.startsWith("---")
            ? "meta"
            : line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : "";
        return (
          <div key={index} className={kind}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function TurnChangesCard({ item }: { item: CustomItem }) {
  const parsed = parseTurnChanges(item.details);
  if (!parsed || (parsed.files.length === 0 && parsed.omitted === 0)) return null;
  const added = parsed.files.reduce((sum, file) => sum + file.added, 0);
  const removed = parsed.files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <details className="card changes-card">
      <summary className="card-head">
        <span className="card-icon">📝</span>
        <span className="card-name">本回合改动</span>
        <span className="card-detail">{parsed.files.length} 个文件</span>
        <span className="diff-stat">
          <span className="add-stat">+{added}</span>
          <span className="del-stat">−{removed}</span>
        </span>
      </summary>
      <div className="card-body">
        {parsed.files.map((file) => (
          <details key={file.path} className="file-change">
            <summary>
              <span className="file-path">{file.path}</span>
              <span className="diff-stat">
                <span className="add-stat">+{file.added}</span>
                <span className="del-stat">−{file.removed}</span>
              </span>
            </summary>
            {file.patch ? <DiffBlock patch={file.patch} /> : <div className="muted">（无可用 diff）</div>}
          </details>
        ))}
        {parsed.omitted > 0 && <div className="muted">另有 {parsed.omitted} 个文件未列出</div>}
      </div>
    </details>
  );
}

/** Compaction markers, Jev decisions and other bookkeeping entries. */
export function NoteCard({ item }: { item: CustomItem }) {
  return <div className="note-card">{item.text || item.customType}</div>;
}
