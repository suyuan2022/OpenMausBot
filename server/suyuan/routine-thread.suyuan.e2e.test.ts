// suyuan fork: on a real server with the fake engine, a routine run twice leaves one conversation, with both runs in it.
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

it("runs a routine twice into one conversation, and opens a new one after that conversation is deleted", async () => {
  const fixture = await launchVerificationServer();
  const url = fixture.info.url;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(value)}`).toBe(true);
    return value;
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "One thread fixture", "--url", url]) as any;
    const { routine } = await api("POST", "/api/routines", {
      name: "Hourly outfit", prompt: "Pick an outfit.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const run = async () => {
      const { run } = await api("POST", `/api/routines/${routine.id}/run`);
      await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((item: any) => item.id === run.id)?.status, { timeout: 15_000 }).toBe("completed");
      return (await api("GET", "/api/routines")).runs.find((item: any) => item.id === run.id);
    };
    const tasks = async () => (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).tasks as any[];
    const before = (await tasks()).length;
    const first = await run();
    const second = await run();
    expect(second.threadId).toBe(first.threadId);
    expect(await tasks()).toHaveLength(before + 1);
    expect((await tasks()).find((task) => task.threadId === first.threadId).title).toBe("Hourly outfit");
    const { messages } = await api("GET", `/api/threads/${first.threadId}/messages?limit=100`);
    expect(messages.filter((message: any) => message.role === "user")).toHaveLength(2);
    expect(messages.filter((message: any) => message.role === "bot" && message.text === "hello from fake claude")).toHaveLength(2);

    await api("DELETE", `/api/bots/${bot.id}/tasks/${first.threadId}`);
    const third = await run();
    expect(third.threadId).not.toBe(first.threadId);
    expect(await tasks()).toHaveLength(before + 1);
    expect((await run()).threadId).toBe(third.threadId);
  } finally {
    await fixture.close();
  }
}, 90_000);
