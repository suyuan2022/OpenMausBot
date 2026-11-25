// suyuan fork: on a phone the bots the person pinned stand beside the Chief at the top of the home, as tiles like the
// desk's, instead of under a "Pinned" heading of their own. partitionSidebarBots hands them over here, the Chief's hero
// (SidebarPhoneHero.tsx) draws them, and a rename asked from a tile's menu reaches the tile through renameAsked.

let phoneHome = false;
const besideChief = new WeakMap<object, readonly object[]>();

/** useSuyuan calls this on every render of the app shell, with the sidebar's own phone layout query. */
export function notePhoneHome(phone: boolean): void {
  phoneHome = phone;
}

/**
 * The pinned bots that keep their own heading. On a phone, with the Chief at the top and no search typed, none do: they
 * are kept for the Chief's hero. Pins the person made universal keep upstream's roster.
 */
export function pinsBesideChief<T extends object>(pinned: T[], chief: T | null, options: { searching: boolean; universalPins: boolean }): T[] {
  if (!chief) return pinned;
  if (!phoneHome || options.searching || options.universalPins || pinned.length === 0) {
    besideChief.delete(chief);
    return pinned;
  }
  besideChief.set(chief, pinned);
  return [];
}

/** The pinned bots the Chief's hero shows beside it, in the list's order. */
export function heroPins<T extends object>(chief: T): readonly T[] {
  return (besideChief.get(chief) as readonly T[] | undefined) ?? [];
}

const RENAME_EVENT = "suyuan:rename-bot";

/** The bot menu's Rename, said to the hero's tiles too: the sidebar keeps its rename request to its own rows. */
export function announceRename(botId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RENAME_EVENT, { detail: botId }));
}

export function onRenameAsked(listener: (botId: string) => void): () => void {
  const heard = (event: Event) => {
    const botId = (event as CustomEvent<unknown>).detail;
    if (typeof botId === "string") listener(botId);
  };
  window.addEventListener(RENAME_EVENT, heard);
  return () => window.removeEventListener(RENAME_EVENT, heard);
}
