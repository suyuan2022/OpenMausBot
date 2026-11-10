/** Claude Code compacts its own session in place (at `--autocompact`, or near its window without it). OpenMausBot's
 * automatic fold would get there first and restart the conversation on a new session that holds only a short summary. */
export function engineCompactsItself(driverKind: string): boolean {
  return driverKind === "claudeAgent";
}
