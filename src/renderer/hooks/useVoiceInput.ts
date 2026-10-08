import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api-client";

export interface VoiceSettings {
  provider: string;
  model: string;
  language: string;
}

const STORAGE_KEY = "pi-worktable-voice";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { provider: "openai", model: "whisper-1", language: "" };

export function loadVoiceSettings(): VoiceSettings {
  if (typeof window === "undefined") return DEFAULT_VOICE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      provider:
        typeof parsed.provider === "string" && parsed.provider ? parsed.provider : DEFAULT_VOICE_SETTINGS.provider,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_VOICE_SETTINGS.model,
      language: typeof parsed.language === "string" ? parsed.language : "",
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore storage failures */
  }
}

/** Prefer a container that Whisper endpoints accept without transcoding. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface VoiceInput {
  /** False when the platform has no recorder or the user denied the microphone. */
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

/**
 * Record from the microphone and transcribe the clip in the host.
 *
 * The audio never leaves the machine except to the configured provider, and the
 * API key stays in the host process.
 */
export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setAvailable(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined",
    );
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => releaseStream, [releaseStream]);

  const transcribe = useCallback(async (blob: Blob, mimeType: string) => {
    setTranscribing(true);
    setError(null);
    try {
      const settings = loadVoiceSettings();
      const { text } = await call("voice.transcribe", {
        audioBase64: await toBase64(blob),
        mimeType,
        provider: settings.provider,
        model: settings.model,
        ...(settings.language ? { language: settings.language } : {}),
      });
      if (text.trim()) onTranscriptRef.current(text.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const wasCancelled = cancelledRef.current;
        chunksRef.current = [];
        releaseStream();
        setRecording(false);
        if (!wasCancelled && blob.size > 0) void transcribe(blob, type);
      };

      recorder.start();
      setRecording(true);
    } catch (e) {
      releaseStream();
      setRecording(false);
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission was denied"
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [releaseStream, transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  return { available, recording, transcribing, error, start, stop, cancel };
}
