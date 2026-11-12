import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";
import { THREADS_PROMPT } from "../system-prompt.ts";
import { THREAD_FACTS, threadFacts, withThreadFacts } from "./thread-facts.ts";

describe("what bots are told about threads", () => {
  const tools = availableTools({ ...catalogProfileFromEnv({}), chief: true, botId: "bot" });
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;

  it("tells of the main conversation, the chip and the #Title link, and of no row or sidebar", () => {
    expect(THREADS_PROMPT).toContain("The person talks with each bot in its main conversation and opens any other thread from the chip left in the conversation that started it, or from a #Title link.");
    expect(tool("start_thread").description).toContain("which the person opens from the chip this call leaves in this conversation, without switching");
    expect(tool("start_thread").description).toContain("The title names the thread on that chip, at the top of the thread and in list_threads, so make it short and specific,");
    expect(tool("close_thread").description).toContain("as finished once you have read its result: list_threads reports it as closed, and the person can still open it. Nothing is deleted");
    const title = (tool("coordinate_bots").inputSchema.properties as Record<string, { description: string }>).title!.description;
    expect(title).toBe("With thread \"new\": the new thread's title, shown at the top of the thread and used by list_threads and #Title links; short and specific (e.g. \"Launch: Reddit draft\"). Defaults to the start of message.");
    // What close_thread answers (server/drivers/agents-call.ts passes it through threadFacts).
    expect(threadFacts("Closed #Review on @Ada. It stays in the person's sidebar, idle, with a note that you closed it.")).toBe("Closed #Review on @Ada. The person can still open it.");
    const everything = JSON.stringify({ THREADS_PROMPT, tools });
    for (const [upstream] of THREAD_FACTS) expect(everything).not.toContain(JSON.stringify(upstream).slice(1, -1));
    expect(everything).not.toMatch(/sidebar|rows? under/);
  });

  it("leaves every other tool the same object", () => {
    const plain = { name: "x", description: "Nothing about threads.", inputSchema: { properties: { a: { type: "string", description: "A." } } } };
    expect(withThreadFacts(plain)).toBe(plain);
    expect(threadFacts("Nothing about threads.")).toBe("Nothing about threads.");
  });
});
