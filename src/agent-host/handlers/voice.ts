import { DEFAULT_TRANSCRIPTION_MODEL, DEFAULT_TRANSCRIPTION_PROVIDER, transcribeAudio } from "../voice/transcribe";
import type { ApiHandlerSet } from "../../contract/rpc";
import type { HandlerContext } from "./types";

/** Voice input. The credential stays in the host; the renderer only sends audio. */
export function voiceHandlers(_ctx: HandlerContext) {
  return {
    "voice.config": () => ({
      provider: DEFAULT_TRANSCRIPTION_PROVIDER,
      model: DEFAULT_TRANSCRIPTION_MODEL,
    }),

    "voice.transcribe": (params) => {
      const { audioBase64, mimeType, provider, model, language } = params as {
        audioBase64: string;
        mimeType: string;
        provider?: string;
        model?: string;
        language?: string;
      };
      return transcribeAudio({ audioBase64, mimeType, provider, model, language });
    },
  } satisfies Partial<ApiHandlerSet>;
}
