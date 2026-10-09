import type { MutableRefObject } from "react";

import { useI18n } from "@/i18n";

/** Where a slash command came from; the palette groups by this. */
export type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export interface SlashPaletteCommand {
  source: SlashCommandSource;
  name: string;
  description?: string;
}

export interface SlashCommandGroup<T extends SlashPaletteCommand = SlashPaletteCommand> {
  source: SlashCommandSource;
  items: { command: T; index: number }[];
}

/** Palette ordering: built-ins first, then the file-backed sources. */
export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

const SOURCE_LABEL: Record<SlashCommandSource, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  prompt: "Prompts",
  skill: "Skills",
};

interface Props<T extends SlashPaletteCommand> {
  loading: boolean;
  /** e.g. "12 commands"; shown next to the title. */
  countLabel: string;
  groups: SlashCommandGroup<T>[];
  isEmpty: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** So arrow-key navigation can scroll the active item into view. */
  itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onPick: (command: T) => void;
}

/**
 * The `/` palette above the composer: built-in commands plus everything the
 * host reports from extensions, prompts and skills.
 */
export function SlashCommandPalette<T extends SlashPaletteCommand>({
  loading,
  countLabel,
  groups,
  isEmpty,
  activeIndex,
  onActiveIndexChange,
  itemRefs,
  onPick,
}: Props<T>) {
  const { t } = useI18n();

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
        maxHeight: "min(56vh, 460px)",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>
          {loading ? t("slashLoading", "Loading commands...") : t("slashTitle", "Slash commands") + ` · ${countLabel}`}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div style={{ maxHeight: "calc(min(56vh, 460px) - 34px)", overflowY: "auto", padding: 10 }}>
        {!loading && isEmpty ? (
          <div style={{ padding: "2px 2px 4px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("slashEmpty", "No extension, prompt, or skill commands found")}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.source} style={{ marginBottom: 12 }}>
              <div
                style={{
                  position: "sticky",
                  top: -10,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "4px 0 6px",
                  background: "var(--bg)",
                  color: "var(--text-dim)",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                <span>{SOURCE_LABEL[group.source]}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {group.items.map(({ command, index }) => {
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${command.source}:${command.name}`}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(command);
                      }}
                      onMouseEnter={() => onActiveIndexChange(index)}
                      style={{
                        width: "100%",
                        minWidth: 0,
                        minHeight: 58,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        justifyContent: "center",
                        padding: "9px 10px",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: "var(--radius-sm)",
                        background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontFamily: "var(--font-mono)",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        /{command.name}
                      </span>
                      {command.description && (
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            overflow: "hidden",
                            fontSize: 11,
                            lineHeight: 1.35,
                            color: "var(--text-dim)",
                          }}
                        >
                          {command.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
