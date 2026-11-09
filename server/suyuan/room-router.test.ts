import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import type { Decider } from "../decider/index.ts";
import { decideRoomResponder } from "../decider/room-routing.ts";
import { roomRoutingInput } from "../host/room-routing-input.ts";
import type { BotRecord, Message } from "../store.ts";
import {
  namedBot, ROOM_ROUTER_FILE, ROOM_ROUTER_SYSTEM, roomRouterPrompt, roomRouterSettings, roomRoutingReady, routedText, withRoomRouter, withRoomRouterStatus,
} from "./room-router.ts";

const SETTINGS = { baseUrl: "https://api.example.test/v1/", model: "deepseek-ai/DeepSeek-V4.1-Flash", apiKey: "sk-test" };
const cfg = {} as AppConfig;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "room-router-"));
});
afterEach(() => {
  vi.restoreAllMocks();
});
const save = (settings: unknown) => writeFileSync(join(dir, ROOM_ROUTER_FILE), JSON.stringify(settings));

const members = [
  { id: "outfit", name: "穿搭", title: "穿搭顾问", description: "搭配和挑款" },
  { id: "shop", name: "shopping", description: "查价格、口碑和货源" },
] as BotRecord[];
const line = (id: string, role: "user" | "bot", kind: Message["kind"], text: string, from?: string): Message =>
  ({ id, role, kind, text, at: 1, ...(from ? { from: { botId: from, name: from === "outfit" ? "穿搭" : "shopping", color: "green" } } : {}) }) as Message;
const history = [
  line("1", "user", "text", "我想买双冬天通勤的鞋"),
  line("2", "bot", "activity", "Bash: curl https://www.dewu.com", "outfit"),
  line("3", "bot", "text", "低帮防滑的皮面运动鞋比较合适", "outfit"),
];
const input = () => roomRoutingInput("买鞋", "帮我查一下京东和得物哪家便宜", members, history, "夙愿");

function upstream(): Decider {
  return {
    ask: vi.fn(), score: vi.fn(), yesNo: vi.fn(), testKey: vi.fn(),
    choose: vi.fn(async () => ({ ok: false as const, reason: "disabled" as const })),
  } as unknown as Decider;
}
function answering(content: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
}

describe("roomRouterSettings", () => {
  it("reads the file in the data directory, and only an https or loopback address", () => {
    expect(roomRouterSettings(dir)).toBeNull();
    save(SETTINGS);
    expect(roomRouterSettings(dir)).toEqual({ ...SETTINGS, baseUrl: "https://api.example.test/v1" });
    save({ ...SETTINGS, baseUrl: "http://api.example.test/v1" });
    expect(roomRouterSettings(dir)).toBeNull();
    save({ ...SETTINGS, baseUrl: "http://127.0.0.1:9999/v1" });
    expect(roomRouterSettings(dir)?.baseUrl).toBe("http://127.0.0.1:9999/v1");
    save({ ...SETTINGS, apiKey: " " });
    expect(roomRouterSettings(dir)).toBeNull();
  });
});

describe("roomRoutingReady and the app's status", () => {
  it("counts the router unless room routing or the decision model is turned off", () => {
    const status = { enabled: false, jobs: { roomRouting: false } };
    expect(roomRoutingReady(cfg, dir)).toBe(false);
    expect(withRoomRouterStatus(status, cfg, dir)).toBe(status);
    save(SETTINGS);
    expect(roomRoutingReady(cfg, dir)).toBe(true);
    expect(withRoomRouterStatus(status, cfg, dir)).toEqual({ enabled: true, jobs: { roomRouting: true } });
    expect(roomRoutingReady({ decider: { provider: "off" } } as AppConfig, dir)).toBe(false);
    expect(roomRoutingReady({ decider: { enabled: false } } as AppConfig, dir)).toBe(false);
  });

  it("keeps Settings' room routing switch live after it is turned off, so it can be turned on again", () => {
    save(SETTINGS);
    const off = { decider: { jobs: { roomRouting: false } } } as AppConfig;
    expect(roomRoutingReady(off, dir)).toBe(false);
    expect(withRoomRouterStatus({ enabled: false, jobs: { roomRouting: false } }, off, dir)).toEqual({ enabled: true, jobs: { roomRouting: false } });
  });
});

describe("the prompt", () => {
  it("lists the bots and the room's chat lines, without tool steps, and asks for one name", () => {
    const fetch = answering("shopping");
    save(SETTINGS);
    return decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, fetch), input()).then(() => {
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe("https://api.example.test/v1/chat/completions");
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ model: SETTINGS.model, temperature: 0, max_tokens: 20, thinking: { type: "disabled" } });
      expect(body.messages[0]).toEqual({ role: "system", content: ROOM_ROUTER_SYSTEM });
      expect(body.messages[1].content).toBe([
        "群：买鞋",
        "",
        "bot：",
        "- 穿搭：穿搭顾问 搭配和挑款",
        "- shopping：查价格、口碑和货源",
        "",
        "最近的聊天：",
        "夙愿：我想买双冬天通勤的鞋",
        "穿搭 (bot)：低帮防滑的皮面运动鞋比较合适",
        "",
        "最新一条，夙愿说：帮我查一下京东和得物哪家便宜",
        "",
        "由谁来回答？",
      ].join("\n"));
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    });
  });

  it("carries the line a reply quotes, so a reply to a bot's message can go back to it", async () => {
    const fetch = answering("shopping");
    save(SETTINGS);
    const quoted = line("4", "bot", "text", "得物这双 399，链接在这", "shop");
    const reply = roomRoutingInput("买鞋", routedText("这个链接打不开", quoted), members, history, "夙愿");
    expect(await decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, fetch), reply)).toMatchObject({ kind: "member", botId: "shop" });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).messages[1].content)
      .toContain("最新一条，夙愿说：（回复 shopping (bot) 的「得物这双 399，链接在这」）这个链接打不开");
    expect(routedText("好的", line("5", "user", "text", "我先看看"))).toBe("（回复「我先看看」）好的");
    expect(routedText("好的")).toBe("好的");
  });

  it("leaves out the chat when the room has none", () => {
    expect(roomRouterPrompt({ room: "买鞋", bots_in_room: ["穿搭"], new_message: { from: "夙愿", text: "在吗" } }, ["没有介绍"]))
      .not.toContain("最近的聊天");
  });
});

describe("namedBot", () => {
  const names = ["穿搭", "shopping", "穿搭2"];
  it("takes the name as written, in quotes, after an @, or with end punctuation", () => {
    expect(namedBot("shopping", names)).toBe(1);
    expect(namedBot(" 「穿搭」。", names)).toBe(0);
    expect(namedBot("@shopping\n", names)).toBe(1);
    expect(namedBot("穿搭2", names)).toBe(2);
  });

  it("takes the one name inside a longer answer, and no name when there are several or none", () => {
    expect(namedBot("应该由 shopping 回答", names)).toBe(1);
    expect(namedBot("穿搭和 shopping 都行", names)).toBe(-1);
    expect(namedBot("荔枝", names)).toBe(-1);
  });
});

describe("withRoomRouter", () => {
  it("sends a room's message to the bot the model names", async () => {
    save(SETTINGS);
    const route = await decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, answering("shopping")), input());
    expect(route).toEqual({ kind: "member", botId: "shop", probability: 1, provider: "openrouter" });
  });

  it("falls back to the room's lead when the model names nobody, refuses the key, or cannot be reached", async () => {
    save(SETTINGS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, answering("荔枝")), input()))
      .toEqual({ kind: "fallback", reason: "malformed" });
    expect(await decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, answering("x", 401)), input()))
      .toEqual({ kind: "fallback", reason: "rejected" });
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, down), input()))
      .toEqual({ kind: "fallback", reason: "unreachable" });
  });

  it("stops when the room's turn is cancelled", async () => {
    save(SETTINGS);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = new AbortController();
    const waits = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = decideRoomResponder(withRoomRouter(upstream(), () => cfg, dir, waits), input(), { signal: stop.signal });
    stop.abort();
    expect(await pending).toEqual({ kind: "fallback", reason: "cancelled" });
  });

  it("leaves every other decision, and room routing without its file, to the app's decider", async () => {
    const base = upstream();
    const fetch = answering("shopping");
    const decider = withRoomRouter(base, () => cfg, dir, fetch);
    await decider.choose("roomRouting", {}, { instructions: "", options: { a: "A", b: "B" } });
    save(SETTINGS);
    await decider.choose("inboxTriage", {}, { instructions: "", options: { a: "A", b: "B" } });
    expect(base.choose).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
