// suyuan fork: the composer's voice-call button stays hidden until Settings turns it on. Kept per device, like the other look settings.
import { useSyncExternalStore } from "react";

export const VOICE_BUTTON_KEY = "omb-suyuan-voice-button";

const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readVoiceButton(): boolean {
  try {
    return storage()?.getItem(VOICE_BUTTON_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === VOICE_BUTTON_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setVoiceButton(on: boolean): void {
  try {
    storage()?.setItem(VOICE_BUTTON_KEY, on ? "1" : "0");
  } catch {
  }
  for (const listener of listeners) listener();
}

export function useVoiceButton(): boolean {
  return useSyncExternalStore(subscribe, readVoiceButton, () => false);
}
