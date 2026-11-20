// suyuan fork (automation-report-turns.ts), end to end on an isolated server with the scripted fake engine:
// 1. attach_file in an automation run carries every attached file onto the line posted in the main chat and serves it.
// 2. A multi-turn run (handing work to a teammate via coordinate_bots) posts turn 1's reply + attachment right away
//    and turn 2's reply when the teammate returns, without losing turn 1 or duplicating turn 1's attachment.
// 3. When turn 2 ends with NOTHING NEW, turn 1's reported reply stays in the main chat and the run stays "posted".
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "../../scripts/control-omb.ts";

let fixture: VerificationServer | undefined;
afterEach(async () => {
  if (fixture) await fixture.close();
  fixture = undefined;
});

// Minimal valid 1x1 PNG bytes for attach_file image test.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

it("delivers attach_file files and every non-quiet turn of a multi-turn automation run into the main chat", async () => {
  fixture = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status?: number) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    if (status === undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const { bot: lizhi } = await cli("new-bot", "--name", "Lizhi");
  const { bot: stylist } = await cli("new-bot", "--name", "Stylist");
  const main = lizhi.activeTaskId as string;

  // Put files inside Lizhi's shared workspace so attach_file can deliver them.
  const workspace = join(dataDir, "workspaces", lizhi.id);
  mkdirSync(workspace, { recursive: true });
  const qrPath = join(workspace, "login-qr.png");
  const clipPath = join(workspace, "morning-brief.txt");
  const videoPath = join(workspace, "morning-video.mp4");
  writeFileSync(qrPath, TINY_PNG);
  writeFileSync(clipPath, "daily summary payload");
  writeFileSync(videoPath, Buffer.from("fake-mp4-bytes"));

  const planPath = join(dataDir, "room-plan.json");
  const header = (name: string) => `Routine ${JSON.stringify(name)} — do this now:`;
  const gate1 = join(dataDir, "stylist-turn1.gate");
  const gate2 = join(dataDir, "stylist-turn2.gate");

  writeFileSync(planPath, JSON.stringify({
    [lizhi.id]: {
      script: [
        // Scenario 1: single-turn run attaches two files via attach_file before replying with text.
        {
          key: "single-attach",
          match: [header("QR push")],
          steps: [
            { tool: "attach_file", arguments: { path: qrPath, name: "公众号扫码.png" } },
            { tool: "attach_file", arguments: { path: clipPath, name: "summary.txt" } },
          ],
          reply: "扫码登录页打开了，附件在上面。",
        },
        // Scenario 2: multi-turn run attaches a video + hands off to Stylist in turn 1, then reports Stylist's answer in turn 2.
        {
          key: "morning-t1",
          match: [header("Morning video")],
          steps: [
            { tool: "attach_file", arguments: { path: videoPath, name: "晨间视频.mp4" } },
            { tool: "coordinate_bots", arguments: { bot_ids: [stylist.id], message: "Check the 5 down jackets." } },
          ],
          reply: "今天三件要你定，视频在上面。",
        },
        {
          key: "morning-t2",
          match: ["3 of the 5 are cotton"],
          reply: "羽绒服查完了：3 件是棉服，2 件是白鸭绒。",
        },
        // Scenario 3: multi-turn run reports substantive work in turn 1, then replies NOTHING NEW in turn 2.
        {
          key: "patrol-t1",
          match: [header("Night patrol")],
          steps: [
            { tool: "coordinate_bots", arguments: { bot_ids: [stylist.id], message: "Double check leftover item." } },
          ],
          reply: "今晚处置了 5 件。",
        },
        {
          key: "patrol-t2",
          match: ["Leftover item is clean"],
          reply: "NOTHING NEW",
        },
      ],
    },
    [stylist.id]: {
      script: [
        { key: "stylist-jackets", match: ["Check the 5 down jackets."], reply: "3 of the 5 are cotton.", gateFile: gate1 },
        { key: "stylist-patrol", match: ["Double check leftover item."], reply: "Leftover item is clean.", gateFile: gate2 },
      ],
    },
  }));

  const createRoutine = async (name: string) => (await api("POST", "/api/routines", {
    name, prompt: `Run ${name}.`, botId: lizhi.id, enabled: false,
    schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
  }, 201)).routine.id as string;
  const runNow = async (routineId: string) => (await api("POST", `/api/routines/${routineId}/run`, undefined, 201)).run.id as string;
  const runOf = async (id: string) => ((await api("GET", "/api/routines")).runs as any[]).find((r) => r.id === id);
  const settled = (id: string, status = "completed") => expect.poll(async () => (await runOf(id))?.status, { timeout: 30_000 }).toBe(status);
  const linesFor = async (runId: string) => ((await api("GET", `/api/threads/${main}/messages?limit=200`)).messages as any[])
    .filter((m) => m.automation?.runId === runId && m.kind === "text");

  // 1. Single-turn attach_file
  const r1 = await runNow(await createRoutine("QR push"));
  await settled(r1);
  await expect.poll(async () => (await linesFor(r1)).length, { timeout: 15_000 }).toBe(1);
  const [qrLine] = await linesFor(r1);
  expect(qrLine.text).toBe("扫码登录页打开了，附件在上面。");
  expect(qrLine.attachments?.map((a: any) => a.mime)).toEqual(["image/png", "text/plain"]);
  // Verify both the attached image and file can be fetched from the main chat message.
  const servedImg = await fetch(`${url}/api/attachments/${encodeURIComponent(basename(qrLine.attachments[0].path))}`, { headers: { origin: url } });
  expect(servedImg.status).toBe(200);
  const servedFile = await fetch(`${url}/api/threads/${encodeURIComponent(main)}/messages/${encodeURIComponent(qrLine.id)}/file`, {
    method: "POST", headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ path: qrLine.attachments[1].path }),
  });
  expect(servedFile.status).toBe(200);
  expect(await servedFile.text()).toBe("daily summary payload");

  // 2. Multi-turn with attach_file + coordinate_bots
  const r2 = await runNow(await createRoutine("Morning video"));
  await settled(r2, "waiting");
  // Turn 1's video reply lands in the main chat immediately without waiting for Stylist.
  await expect.poll(async () => (await linesFor(r2)).length, { timeout: 15_000 }).toBe(1);
  const [morningT1] = await linesFor(r2);
  expect(morningT1.text).toBe("今天三件要你定，视频在上面。");
  expect(morningT1.attachments?.map((a: any) => a.name)).toEqual(["晨间视频.mp4"]);

  writeFileSync(gate1, "go");
  await settled(r2, "completed");
  await expect.poll(async () => (await linesFor(r2)).length, { timeout: 15_000 }).toBe(2);
  const morningLines = await linesFor(r2);
  expect(morningLines.map((m) => m.text)).toEqual([
    "今天三件要你定，视频在上面。",
    "羽绒服查完了：3 件是棉服，2 件是白鸭绒。",
  ]);
  expect(morningLines[1].attachments).toBeUndefined();

  // 3. Multi-turn where turn 2 ends with NOTHING NEW
  const r3 = await runNow(await createRoutine("Night patrol"));
  await settled(r3, "waiting");
  await expect.poll(async () => (await linesFor(r3)).length, { timeout: 15_000 }).toBe(1);
  writeFileSync(gate2, "go");
  await settled(r3, "completed");
  // Give any trailing flush a moment, then assert turn 1 is preserved and report stays posted.
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect((await linesFor(r3)).map((m) => m.text)).toEqual(["今晚处置了 5 件。"]);
  expect((await runOf(r3))?.report?.state).toBe("posted");
}, 120_000);
