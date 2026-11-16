// suyuan fork: MCP servers the person added so their bots can work the browsers and apps on their own computers
// (config.json "screenMcpServers", here ["lcu"]). Upstream's Surface section knows only OpenMausBot's own browser and
// computer tools, so every turn it told such a bot that all screen work happens in the built-in browser and that any
// other automation path is a substitute: the opposite of the person's own rule (lcu first, the built-in browser only
// for a step they do by hand). A bot followed the rule only by habit from earlier turns, and a new conversation or a
// switch of engine lost it. And a turn that merely had the built-in browser mounted pinned the conversation to it, so
// every later turn was also told it is "pinned to the built-in browser".
//
// For a bot that has one of the listed servers: the Surface section is reworded so the server is a proper way to do
// screen work and comes first for web pages, and a turn no longer pins the conversation to the built-in browser on its
// own. A place the person chose themselves (a pin in the Screen panel, Works on) is left exactly as upstream has it.
import type { Surface } from "../../shared/wire.ts";

interface Pin { surface?: Surface; surfaceSource?: "user" | "auto" }

/** The listed servers this bot or turn has, in the order config.json lists them. */
export function screenMcpNames(cfg: { screenMcpServers?: readonly string[] }, has: Record<string, unknown> | undefined): string[] {
  return (cfg.screenMcpServers ?? []).filter((name) => has !== undefined && Object.hasOwn(has, name));
}

/** A pin an earlier turn made on its own to the built-in browser is no pin for such a bot. */
export function withoutAutoBrowserPin<T extends Pin>(task: T | undefined, names: readonly string[]): T | undefined {
  return task && names.length && task.surface === "browser" && task.surfaceSource === "auto"
    ? { ...task, surface: undefined, surfaceSource: undefined } : task;
}

/** What a turn stores once it knows the place it used: the usual auto pin, except that the built-in browser is never
 * pinned for such a bot, and a pin an earlier turn left there is cleared. Null stores nothing. */
export function autoPinPatch(used: Surface | null, names: readonly string[], task: Pin | undefined): Pin | null {
  if (!used) return null;
  if (used !== "browser" || !names.length) return { surface: used, surfaceSource: "auto" };
  return task?.surface === "browser" && task.surfaceSource === "auto" ? { surface: undefined, surfaceSource: undefined } : null;
}

const list = (names: readonly string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;

/** Each pair rewrites one phrase of server/surface.ts that leaves no room for the person's own server. */
function rewrites(tools: string): ReadonlyArray<readonly [RegExp | string, string]> {
  return [
    [/ Everything you do on screen happens (on|in) /, " The screen tools OpenMausBot mounted this turn work $1 "],
    ["there is no desktop computer this turn", "no desktop computer is mounted this turn"],
    [/Web tasks → the built-in browser\./, `Web tasks → ${tools} first, then the built-in browser.`],
    ["a connected app that does it, your built-in browser,", `a connected app that does it, ${tools}, your built-in browser,`],
    ["a connected app that does it, web search and fetching pages,", `a connected app that does it, web search and fetching pages, ${tools},`],
    ["use OpenMausBot's mounted browser/computer tools first:", `use ${tools} or OpenMausBot's mounted browser/computer tools:`],
    [" Do not substitute the provider's own desktop, a shell-launched browser, or another automation path for the selected OpenMausBot surface.",
      " Do not substitute the provider's own desktop or a shell-launched browser for them."],
    ["You cannot open apps, click, or inspect a screen through OpenMausBot. If asked for screen work,",
      `OpenMausBot's own tools cannot open apps, click, or inspect a screen this turn. If asked for screen work that ${tools} cannot do,`],
    ["use the selected OpenMausBot browser when a search service is unavailable", `use ${tools} or the selected OpenMausBot browser when a search service is unavailable`],
  ];
}

/** The Surface section of a turn that has these servers. `browser`: the built-in browser is mounted this turn.
 * `chose`: the person picked the built-in browser themselves (a pin in the Screen panel, or Works on), which stands. */
export function screenMcpWording(text: string, opts: { names: readonly string[]; browser: boolean; chose?: boolean }): string {
  if (!opts.names.length || opts.chose) return text;
  // Only the two shapes surfacePrompt gives a turn that may do screen work; Off and the other notes stay as they are.
  if (!text.includes(" For browser and computer tasks,") && !text.includes(" No computer or built-in browser tools are mounted this turn.")) return text;
  const tools = list(opts.names), many = opts.names.length > 1;
  let out = text;
  for (const [from, to] of rewrites(tools)) out = out.replace(from, to);
  // First, so a turn reads which tool comes first before it reads the long account of OpenMausBot's own tools.
  return ` The person added the ${tools} MCP server${many ? "s" : ""} so you can work in the browsers and apps on their own computers, where they are already signed in. ${many ? "They are" : "It is"} a proper way to do screen and web work, not a substitute for anything below. Where the person's rules say which to use, follow them. Otherwise, to read web pages or use a site they are signed in to, use ${tools} first.${opts.browser
    ? ` Use the built-in browser only for a step the person must do by hand in it, such as scanning a QR code or passing a CAPTCHA. Before asking them to sign in to a site in the built-in browser, check whether a browser you reach through ${tools} is already signed in there.`
    : ""} The rest of this section is about OpenMausBot's own browser and computer tools: what it says about places, pins and switching covers only those, never ${tools}.${out}`;
}
