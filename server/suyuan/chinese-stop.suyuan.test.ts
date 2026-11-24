import { expect, it } from "vitest";

import { isStopCommand } from "../room-holds.ts";

it("reads a Chinese stop as a stop, and a sentence that only mentions stopping as a message", () => {
  for (const text of ["停", "停！", "停下", "全部停下", "都停掉吧", "别干了", "别干了。", "@荔枝 停", "先停一下", "叫停", "停止", "stop"]) {
    expect(isStopCommand(text, "荔枝"), text).toBe(true);
  }
  for (const text of ["停车场在哪", "先别停，接着做", "为什么停了", "暂停一下提醒", "别干了这个去干那个", "停 一下 那个 脚本 先"]) {
    expect(isStopCommand(text, "荔枝"), text).toBe(false);
  }
});
