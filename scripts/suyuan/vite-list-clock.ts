import type { Plugin } from "vite";

// suyuan fork: the bot list's times say the day (src/suyuan/list-clock.ts). Sidebar.tsx stays upstream's file: as the app
// compiles it, for the build and the dev server, its calls of the clock become the list's clock. Its lines stay where they
// are (the import goes last, ES imports are hoisted), so its source map still holds. Upstream's tests keep upstream's
// clock; src/suyuan/phone-list.suyuan.test.ts checks this one.
const SIDEBAR = /[\\/]src[\\/]components[\\/]Sidebar\.tsx$/;
const CALL = /\bformatTime\(/g;

export function listClockSource(code: string): string | null {
  if (!code.includes("formatTime(")) return null;
  return `${code.replace(CALL, "suyuanListTime(")}\nimport { formatTime as suyuanListTime } from "@/suyuan/list-clock";\n`;
}

export function sidebarListClock(): Plugin {
  return {
    name: "suyuan-sidebar-list-clock",
    enforce: "pre",
    apply: () => !process.env.VITEST,
    transform(code, id) {
      if (!SIDEBAR.test(id.split("?")[0]!)) return null;
      const changed = listClockSource(code);
      if (changed === null) this.error("Sidebar.tsx no longer calls formatTime: point the list's clock (src/suyuan/list-clock.ts) at what it calls now");
      return { code: changed, map: null };
    },
  };
}
