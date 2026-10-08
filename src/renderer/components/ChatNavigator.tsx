import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/i18n";

export interface ChatNavigatorQuestion {
  /** Index into the rendered message list; also the DOM hook (`data-message-index`). */
  index: number;
  /** First line of the question, for the tooltip. */
  text: string;
}

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  questions: ChatNavigatorQuestion[];
  onJump: (index: number) => void;
  onBottom: () => void;
}

/**
 * Two ways back into a long conversation: a dot per question on the right edge,
 * and a "back to bottom" pill once you have scrolled away. Both read the scroll
 * container directly — no message refs to thread through the renderer.
 */
export function ChatNavigator({ containerRef, questions, onJump, onBottom }: Props) {
  const { t } = useI18n();
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setAwayFromBottom(distance > container.clientHeight * 1.2);

    // The question whose message sits closest above the viewport top.
    const containerTop = container.getBoundingClientRect().top;
    let current = 0;
    for (let i = 0; i < questions.length; i++) {
      const node = container.querySelector<HTMLElement>(`[data-message-index="${String(questions[i].index)}"]`);
      if (!node) continue;
      if (node.getBoundingClientRect().top - containerTop <= 24) current = i;
      else break;
    }
    setActiveIndex(current);
  }, [containerRef, questions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerRef, measure]);

  if (questions.length < 2) return null;

  return (
    <>
      <div
        aria-hidden={false}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 5,
          borderRadius: 999,
          background: "var(--control-chip-bg)",
          border: "1px solid var(--control-chip-border)",
        }}
        role="navigation"
        aria-label={t("questionNav", "Jump to question")}
      >
        {questions.map((question, position) => (
          <button
            key={question.index}
            type="button"
            onClick={() => {
              onJump(question.index);
            }}
            title={`${String(position + 1)}. ${question.text}`}
            aria-label={`${t("question", "Question")} ${String(position + 1)}`}
            aria-current={position === activeIndex}
            style={{
              width: 7,
              height: 7,
              padding: 0,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background:
                position === activeIndex ? "var(--accent)" : "color-mix(in srgb, var(--text) 34%, transparent)",
              transition: "background 0.12s, transform 0.12s",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = "scale(1.6)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = "none";
            }}
          />
        ))}
      </div>

      {awayFromBottom && (
        <button
          type="button"
          onClick={onBottom}
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 11px",
            borderRadius: 999,
            background: "var(--control-chip-bg)",
            border: "1px solid var(--control-chip-border)",
            color: "var(--control-chip-fg)",
            boxShadow: "var(--shadow-md)",
            cursor: "pointer",
            fontSize: 11.5,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          {t("backToBottom", "Back to bottom")}
        </button>
      )}
    </>
  );
}
