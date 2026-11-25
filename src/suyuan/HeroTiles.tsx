// suyuan fork: the Chief's hero on a phone once the person pinned bots: the Chief and those bots side by side as the
// desk's tiles (hero-pins.ts), the Chief first with its crown. A long press on a tile opens its menu (tile-menu.ts).
import { useEffect, useState } from "react";

import { botRowProps, type MenuState } from "@/components/Sidebar";
import { SidebarTileGrid } from "@/components/SidebarTiles";
import { useSidebarDensity } from "@/lib/sidebar-preferences";
import { useStore, type Bot } from "@/state/store";

import { onRenameAsked } from "./hero-pins";
import "./phone-tiles.css";

export function HeroTiles({ chief, pins, onMenu }: { chief: Bot; pins: readonly Bot[]; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const density = useSidebarDensity();
  const [rename, setRename] = useState<{ botId: string; nonce: number } | null>(null);
  useEffect(() => onRenameAsked((botId) => setRename((current) => ({ botId, nonce: (current?.nonce ?? 0) + 1 }))), []);
  const row = (bot: Bot) => botRowProps(state, dispatch, bot, { density, query: "", onMenu, renameRequest: rename?.botId === bot.id ? rename.nonce : 0 });
  // data-sidebar-hero, as upstream's hero carries it: the phone's list closes on a tap of the bot already open too
  // (Sidebar.tsx's onClick).
  return <div data-suyuan-hero-tiles="" data-sidebar-hero={chief.id}><SidebarTileGrid primary={chief} pinned={[...pins]} row={row} /></div>;
}
