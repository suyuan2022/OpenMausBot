// suyuan fork: two more sections of the system prompt count as changing between turns, so they ride in the turn's
// message instead of the system prompt. Claude keys its per-thread process on the stable half (server/system-prompt.ts):
// a change there relaunches the process on a new system prompt and the whole conversation is written to the prompt cache
// again. On this install that happened on about one turn in four (2026-11-06 to 11-10, read from Claude's own request
// records). These two change while the rest of the launch stays the same, so moving them keeps the process:
// - "user-profile": every preference a bot learns about the person lands here, and it is shared by all bots, so one
//   learned line relaunched every live conversation of every bot;
// - "just-do-it": on for a turn the person drives, off for a peer or unattended turn in the same thread, while the
//   permission mode stays the same.
// "device" and "mcp" change too, but only together with the MCP servers the turn mounts (the phone's server comes and
// goes with them, and a server that did not start is left out), which relaunches the process anyway, so they stay.
// "setup" and "webhook" stay where upstream put them, for the reasons given there.
// The cost: a compaction in the middle of a turn drops the volatile half until the next turn re-sends it
// (server/drivers/claude.ts, compact_boundary), so the rest of that turn runs without these two.
import { VOLATILE_SECTIONS } from "../system-prompt.ts";

export const PER_TURN_SECTIONS = ["user-profile", "just-do-it"] as const;

for (const id of PER_TURN_SECTIONS) VOLATILE_SECTIONS.add(id);
