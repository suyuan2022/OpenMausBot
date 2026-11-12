import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { claudeHookSettings } from "../drivers/claude.ts";
import { buildSystemPrompt, JUST_DO_IT_PROMPT, userProfileSystemPrompt } from "../system-prompt.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { noteTurnVolatile, PIECE_CHARS, VOLATILE_SLOTS, volatileHookReply, volatilePieces } from "./compact-volatile.ts";
import "./steady-prompt.ts";

const compacted = (slot = 1) => ({ event: "SessionStart", payload: { source: "compact", session_id: "s" }, slot: `volatile-${slot}` });
const live = () => true;
const turnHalf = (justDoIt: boolean, memory = " Memory: the person's printer is in room 3.") => buildSystemPrompt("You are Maus.", "", [
  { id: "user-profile", label: "About the user", text: userProfileSystemPrompt({ aboutMe: "写短，结论先说。" }) },
  { id: "memory", label: "Memory", text: memory },
  { id: "just-do-it", label: "Just do it", text: justDoIt ? JUST_DO_IT_PROMPT : "" },
  { id: "recall", label: "Recall", text: " Recall." },
]).volatile;
/** Every slot's context, joined, as the model would get it. */
const resent = (threadId: string, generation: string, active = live) =>
  Array.from({ length: VOLATILE_SLOTS }, (_, i) => volatileHookReply(compacted(i + 1), { threadId, generation }, active)?.context ?? "").join("");

describe("after a compaction the rest of the turn gets the turn's volatile half again", () => {
  it("re-sends the half this turn was given: the person's profile, memory and, on a turn the person drives, Just do it", () => {
    noteTurnVolatile("thread-person", "turn-1", turnHalf(true));
    const context = resent("thread-person", "turn-1");
    expect(context).toContain("The conversation was just compacted");
    expect(context).toContain("写短，结论先说。");
    expect(context).toContain("printer is in room 3");
    expect(context).toContain(JUST_DO_IT_PROMPT.trim());
    expect(context).not.toContain("Recall.");
  });

  it("a later turn another bot sent re-sends its own half, without the earlier turn's Just do it, and the earlier bearer gets nothing", () => {
    noteTurnVolatile("thread-mixed", "person-turn", turnHalf(true));
    noteTurnVolatile("thread-mixed", "peer-turn", turnHalf(false));
    const context = resent("thread-mixed", "peer-turn");
    expect(context).toContain("写短，结论先说。");
    expect(context).not.toContain("Just do it");
    expect(resent("thread-mixed", "person-turn")).toBe("");
  });

  it("never hands one conversation another's half", () => {
    noteTurnVolatile("thread-a", "turn-a", turnHalf(true, " Memory: A's secret."));
    expect(resent("thread-b", "turn-a")).toBe("");
    noteTurnVolatile("thread-b", "turn-b", turnHalf(false, " Memory: B's note."));
    const b = resent("thread-b", "turn-b");
    expect(b).toContain("B's note");
    expect(b).not.toContain("A's secret");
    expect(resent("thread-a", "turn-a")).toContain("A's secret");
  });

  it("sends nothing without this turn's half: none noted, an empty one, a turn that ended, or not a compaction", () => {
    expect(volatileHookReply(compacted(), { threadId: "thread-none", generation: "g" }, live)).toEqual({ ok: true });
    noteTurnVolatile("thread-empty", "g", "  ");
    expect(resent("thread-empty", "g")).toBe("");
    noteTurnVolatile("thread-ended", "g", turnHalf(true));
    expect(resent("thread-ended", "g", () => false)).toBe("");
    const startup = { ...compacted(), payload: { source: "startup" } };
    expect(volatileHookReply(startup, { threadId: "thread-ended", generation: "g" }, live)).toEqual({ ok: true });
    expect(volatileHookReply({ ...compacted(), slot: "volatile-9" }, { threadId: "thread-ended", generation: "g" }, live)).toEqual({ ok: true });
  });

  it("leaves upstream's own hook call, which names no slot, to upstream", () => {
    noteTurnVolatile("thread-upstream", "g", turnHalf(true));
    expect(volatileHookReply({ event: "SessionStart", payload: { source: "compact" } }, { threadId: "thread-upstream", generation: "g" }, live)).toBeNull();
  });

  it("splits a long half into whole lines under Claude Code's 10,000 characters per hook, or sends none of a half too long for the hooks", () => {
    const long = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(70)}`).join("\n");
    const pieces = volatilePieces(long)!;
    expect(pieces).toHaveLength(3);
    for (const [i, piece] of pieces.entries()) {
      expect(piece.length).toBeLessThanOrEqual(PIECE_CHARS);
      expect(piece).toContain(`(part ${i + 1} of 3)`);
    }
    expect(pieces.map((piece) => piece.slice(piece.indexOf(":\n\n") + 3)).join("\n")).toBe(long);
    expect(volatilePieces("x\n".repeat(20_000))).toBeNull();
    noteTurnVolatile("thread-huge", "g", "x\n".repeat(20_000));
    expect(resent("thread-huge", "g")).toBe("");
  });
});

describe("the hooks that carry it", () => {
  it("adds compact-only SessionStart hooks after upstream's, each a distinct command (Claude Code drops duplicates)", () => {
    const posix = claudeHookSettings("/opt/omb/helper.ts", "darwin") as Record<string, Array<{ matcher: string; hooks: Array<{ command: string; args?: string[] }> }>>;
    expect(posix.SessionStart![0]).toEqual(posix.PostToolUse![0]);
    const extra = posix.SessionStart!.slice(1);
    expect(extra.map((entry) => entry.matcher)).toEqual(["compact", "compact", "compact"]);
    expect(extra.map((entry) => entry.hooks[0]!.command)).toEqual([1, 2, 3].map((n) => `${posix.PostToolUse![0]!.hooks[0]!.command} volatile-${n}`));
    const win = claudeHookSettings("C:\\omb\\helper.ts", "win32") as typeof posix;
    expect(win.SessionStart!.slice(1).map((entry) => entry.hooks[0]!.args)).toEqual([1, 2, 3].map((n) => ["C:\\omb\\helper.ts", `volatile-${n}`]));
  });

  const HELPER = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "omb-hook.ts");
  const dir = mkdtempSync(join(tmpdir(), "omb-compact-volatile-"));
  const servers: Server[] = [];
  afterAll(async () => {
    for (const server of servers) server.close();
    await removeTempDir(dir);
  });

  it.each([["volatile-2", "volatile-2"], [undefined, undefined]])("the helper tells the harness which slot it is (%s)", async (slot, expected) => {
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "t\n", { mode: 0o600 });
    let seen: { slot?: string } = {};
    const url = await new Promise<string>((resolve) => {
      const server = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => { seen = JSON.parse(raw); res.end(JSON.stringify({ ok: true, context: "piece" })); });
      });
      servers.push(server);
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
    });
    const stdout = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [HELPER, ...(slot ? [slot] : [])], { env: { ...process.env, OMB_HOOK_URL: url, OMB_HOOK_TOKEN_FILE: tokenFile }, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("close", () => resolve(out));
      child.stdin.end(JSON.stringify({ hook_event_name: "SessionStart", source: "compact" }));
    });
    expect(seen.slot).toBe(expected);
    expect(stdout).toBe("piece");
  });
});
