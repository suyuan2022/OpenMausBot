import { afterEach, describe, expect, it } from "vitest";
import { noteThreadsShown } from "./home";
import { unreadTone, workingDotShown } from "./quiet-dots";

afterEach(() => noteThreadsShown(true));

describe("quiet dots", () => {
  it("drops the working dot and greens the unread one once each bot has one conversation", () => {
    noteThreadsShown(false);
    expect(workingDotShown()).toBe(false);
    expect(unreadTone()).toBe("bg-success");
  });

  it("keeps upstream's dots where threads show", () => {
    noteThreadsShown(true);
    expect(workingDotShown()).toBe(true);
    expect(unreadTone()).toBe("bg-accent");
  });
});
