// suyuan fork: four more sections of the system prompt count as changing between turns, so they ride in the turn's
// message instead of the system prompt. Claude keys its per-thread process on the stable half (server/system-prompt.ts):
// a change there relaunches the process on a new system prompt and the whole conversation is written to the prompt cache
// again. On this install that happened on about one turn in four (2026-11-06 to 11-10, read from Claude's own request
// records), and these four were the sections behind it:
// - "user-profile": every preference a bot learns about the person lands here, and it is shared by all bots, so one
//   learned line relaunched every live conversation of every bot;
// - "device": flips between "the phone is reachable" and "not in this conversation" as routine reports arrive in a chat;
// - "mcp": lists the person's own MCP servers and says which did not start, and lcu sometimes starts late;
// - "just-do-it": on for a turn the person drives, off for a peer or unattended turn in the same thread.
// "setup" and "webhook" stay where upstream put them, for the reasons given there.
import { VOLATILE_SECTIONS } from "../system-prompt.ts";

export const PER_TURN_SECTIONS = ["user-profile", "device", "mcp", "just-do-it"] as const;

for (const id of PER_TURN_SECTIONS) VOLATILE_SECTIONS.add(id);
