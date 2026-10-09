import { useI18n } from "@/i18n";

interface VoiceControls {
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  start: () => void | Promise<void>;
  stop: () => void;
}

interface Props {
  /** Present only while a run is active and the host accepts steering. */
  onSteer?: () => void;
  onFollowUp?: () => void;
  /** False when the current draft cannot be queued (e.g. it has images). */
  canQueue: boolean;
  voice: VoiceControls;
  onSend: () => void;
  canSend: boolean;
  /** True when the draft carries image attachments. */
  hasImages: boolean;
}

/**
 * The right end of the composer: while a run is active it offers steer and
 * follow-up, otherwise dictation and send.
 */
export function ComposerSendCluster({ onSteer, onFollowUp, canQueue, voice, onSend, canSend, hasImages }: Props) {
  const { t } = useI18n();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {onSteer && (
          <button
            onClick={() => onSteer()}
            disabled={!canQueue}
            title={
              hasImages
                ? t("imageQueueUnavailable", "Image attachments cannot be queued while the agent is running")
                : t("steerDescription", "Interrupt the current run and inject this message now")
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 12px",
              background: canQueue ? "var(--amber-soft)" : "none",
              border: "1px solid var(--amber-border)",
              borderRadius: "var(--radius-md)",
              color: canQueue ? "var(--warning)" : "var(--text-dim)",
              cursor: canQueue ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              transition: "background 0.12s",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 1 L9 5 L5 9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            {t("steer", "Steer")}
          </button>
        )}
        {onFollowUp && (
          <button
            onClick={() => onFollowUp()}
            disabled={!canQueue}
            title={
              hasImages
                ? t("imageQueueUnavailable", "Image attachments cannot be queued while the agent is running")
                : t("followUpDescription", "Queue this message after the agent finishes")
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 12px",
              background: canQueue ? "rgba(129,140,248,0.12)" : "none",
              border: "1px solid rgba(129,140,248,0.35)",
              borderRadius: "var(--radius-md)",
              color: canQueue ? "var(--blue)" : "var(--text-dim)",
              cursor: canQueue ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              transition: "background 0.12s",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="1" x2="5" y2="6" />
              <polyline points="2.5 3.5 5 1 7.5 3.5" />
              <line x1="2" y1="9" x2="8" y2="9" />
            </svg>
            {t("followUp", "Follow-up")}
          </button>
        )}
      </div>
      ) : (
      <>
        {voice.available && (
          <button
            type="button"
            onClick={() => (voice.recording ? voice.stop() : void voice.start())}
            disabled={voice.transcribing}
            title={
              voice.recording
                ? t("voiceStop", "Stop recording")
                : voice.transcribing
                  ? t("voiceTranscribing", "Transcribing…")
                  : t("voiceStart", "Dictate")
            }
            aria-label={voice.recording ? t("voiceStop", "Stop recording") : t("voiceStart", "Dictate")}
            style={{
              flexShrink: 0,

              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              background: voice.recording
                ? "color-mix(in srgb, var(--danger) 24%, transparent)"
                : "var(--control-chip-bg)",
              border: `1px solid ${voice.recording ? "var(--danger)" : "var(--control-chip-border)"}`,
              borderRadius: "var(--radius-md)",
              color: voice.recording ? "var(--danger)" : "var(--control-chip-fg)",
              cursor: voice.transcribing ? "wait" : "pointer",
            }}
          >
            {voice.transcribing ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" opacity="0.3" />
                <path d="M21 12a9 9 0 0 0-9-9" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" fill={voice.recording ? "currentColor" : "none"} />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" y1="18" x2="12" y2="21" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={onSend}
          disabled={!canSend}
          style={{
            flexShrink: 0,

            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 18px",
            background: canSend ? "var(--accent)" : "var(--bg-hover)",
            border: "none",
            borderRadius: "var(--radius-md)",
            color: canSend ? "var(--on-accent)" : "var(--text-dim)",
            cursor: canSend ? "pointer" : "not-allowed",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            letterSpacing: "-0.01em",
            boxShadow: canSend ? "0 1px 3px color-mix(in srgb, var(--accent) 30%, transparent)" : "none",
            transition: "background 0.15s, box-shadow 0.15s",
          }}
        >
          {t("send", "Send")}
        </button>
      </>
    </>
  );
}
