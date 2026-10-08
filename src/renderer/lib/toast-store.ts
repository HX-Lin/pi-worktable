import { useSyncExternalStore } from "react";

export type ToastLevel = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  level: ToastLevel;
  text: string;
  /** Optional second line: the error detail, a path, a hint. */
  detail?: string;
  createdAt: number;
}

export interface ToastInput {
  level: ToastLevel;
  text: string;
  detail?: string;
  /** Milliseconds before it disappears on its own; 0 keeps it until dismissed. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 6000;
const MAX_VISIBLE = 4;

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let counter = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Notifications that used to be scattered inline alerts or console noise. Kept
 * outside React so any layer (hooks included) can raise one.
 */
export function pushToast(input: ToastInput): string {
  const id = `toast-${String(++counter)}`;
  const toast: Toast = { id, level: input.level, text: input.text, detail: input.detail, createdAt: Date.now() };
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  emit();

  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl > 0) {
    timers.set(
      id,
      setTimeout(() => {
        dismissToast(id);
      }, ttl),
    );
  }
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function dismissAllToasts(): void {
  for (const id of [...timers.keys()]) dismissToast(id);
  if (toasts.length > 0) {
    toasts = [];
    emit();
  }
}

export function getToasts(): Toast[] {
  return toasts;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getToasts, getToasts);
}

/** Test seam: reset module state between cases. */
export function resetToastsForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  emit();
}
