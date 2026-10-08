/**
 * Voice input: transcribe a recorded clip with the configured provider's
 * OpenAI-compatible transcription endpoint.
 *
 * The credential never reaches the renderer — the host resolves it from the same
 * store the model runtime uses, and posts the audio itself.
 */
import { RpcError } from "../../contract/types";
import { getSharedModelRuntime } from "../model-runtime";

export const DEFAULT_TRANSCRIPTION_PROVIDER = "openai";
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

/** Whisper endpoints reject anything larger. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export interface TranscribeParams {
  audioBase64: string;
  mimeType: string;
  provider?: string;
  model?: string;
  language?: string;
}

export interface TranscribeResult {
  text: string;
  provider: string;
  model: string;
}

export async function transcribeAudio(params: TranscribeParams, signal?: AbortSignal): Promise<TranscribeResult> {
  const audio = Buffer.from(params.audioBase64, "base64");
  if (audio.length === 0) throw new RpcError({ code: "BAD_REQUEST", message: "Empty audio" });
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Recording is too large to transcribe" });
  }

  const providerId = params.provider?.trim() || DEFAULT_TRANSCRIPTION_PROVIDER;
  const modelId = params.model?.trim() || DEFAULT_TRANSCRIPTION_MODEL;

  const modelRuntime = await getSharedModelRuntime();
  const auth = await modelRuntime.getAuth(providerId);
  const apiKey = auth?.auth.apiKey;
  if (!apiKey) {
    throw new RpcError({
      code: "FORBIDDEN",
      message: `No API key is configured for "${providerId}". Add one under Models.`,
    });
  }

  // The provider's base URL may come from the credential override or from any of
  // its models; both spell the API root the same way.
  const baseUrl = (
    auth?.auth.baseUrl ??
    modelRuntime.getModels().find((candidate) => candidate.provider === providerId)?.baseUrl ??
    ""
  ).replace(/\/+$/, "");
  if (!baseUrl) {
    throw new RpcError({ code: "BAD_REQUEST", message: `No API endpoint is known for "${providerId}"` });
  }

  const extension = EXTENSION_BY_MIME[params.mimeType.split(";")[0].trim()] ?? "webm";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: params.mimeType }), `audio.${extension}`);
  form.append("model", modelId);
  if (params.language?.trim()) form.append("language", params.language.trim());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...(auth?.auth.headers ?? {}) },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RpcError({
        code: "INTERNAL",
        message: `Transcription failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      });
    }
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string") {
      throw new RpcError({ code: "INTERNAL", message: "Transcription returned no text" });
    }
    return { text: data.text, provider: providerId, model: modelId };
  } catch (error) {
    if (error instanceof RpcError) throw error;
    if (controller.signal.aborted) {
      throw new RpcError({
        code: "BAD_REQUEST",
        message: signal?.aborted ? "Recording cancelled" : "Transcription timed out",
      });
    }
    throw new RpcError({
      code: "INTERNAL",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
