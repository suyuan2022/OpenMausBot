// suyuan fork: the chat dock's Skill Burger card (src/components/skill-burger/SkillBurgerSlot.tsx) stays hidden until Settings turns it on. Kept per device, like the other look settings.
import { useSyncExternalStore } from "react";

export const SKILL_BURGER_KEY = "omb-suyuan-skill-burger";

const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readSkillBurger(): boolean {
  try {
    return storage()?.getItem(SKILL_BURGER_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SKILL_BURGER_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setSkillBurger(on: boolean): void {
  try {
    storage()?.setItem(SKILL_BURGER_KEY, on ? "1" : "0");
  } catch {
  }
  for (const listener of listeners) listener();
}

export function useSkillBurger(): boolean {
  return useSyncExternalStore(subscribe, readSkillBurger, readSkillBurger);
}
