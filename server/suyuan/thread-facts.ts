// suyuan fork: what bots are told about threads, made true for one bot, one home (home.ts). Upstream's words say the person
// sees every thread as a row under its bot and names a thread for the sidebar. With the thread list hidden (simple mode, the
// person's everyday view) there is no such row: they talk with a bot in its main conversation and open any other thread from
// its chip or a #Title link, read-only (checked on an isolated instance, closed threads too). Every sentence here holds with
// the list shown too. Each pair swaps one upstream
// phrase; wiring.test.ts goes red when upstream rewords one, so a swap never quietly stops applying.
export const THREAD_FACTS: ReadonlyArray<readonly [upstream: string, fork: string]> = [
  // server/system-prompt.ts THREADS_PROMPT
  [
    "a bot can have several running at once, and the person sees them as rows under that bot.",
    "a bot can have several running at once. The person talks with each bot in its main conversation and opens any other thread from the chip left in the conversation that started it, or from a #Title link.",
  ],
  // server/drivers/agents-catalog.ts start_thread
  [
    "shown to the person as a row under you, without switching the person's selected conversation.",
    "which the person opens from the chip this call leaves in this conversation, without switching the person's selected conversation.",
  ],
  [
    "The title becomes the row's name, so make it short and specific,",
    "The title names the thread on that chip, at the top of the thread and in list_threads, so make it short and specific,",
  ],
  // close_thread
  [
    "it leaves the person's default sidebar list (still under all threads, with a note saying you closed it) and list_threads reports it as closed.",
    "list_threads reports it as closed, and the person can still open it.",
  ],
  // server/drivers/agents-call.ts, what close_thread answers
  [
    "It stays in the person's sidebar, idle, with a note that you closed it.",
    "The person can still open it.",
  ],
  // coordinate_bots, its title parameter
  [
    "With thread \"new\": the new thread's sidebar name, short and specific",
    "With thread \"new\": the new thread's title, shown at the top of the thread and used by list_threads and #Title links; short and specific",
  ],
];

export function threadFacts(text: string): string {
  return THREAD_FACTS.reduce((out, [upstream, fork]) => out.replace(upstream, fork), text);
}

type Tool = { description: string; inputSchema: { properties?: Record<string, unknown> } };

/** A catalog tool with the thread facts in its description and its parameters' descriptions; any other tool comes back as
 * the same object. */
export function withThreadFacts<T extends Tool>(tool: T): T {
  let changed = false;
  const fix = (text: string) => {
    const next = threadFacts(text);
    changed ||= next !== text;
    return next;
  };
  const description = fix(tool.description);
  const properties = tool.inputSchema.properties && Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key, value]) => {
    const text = (value as { description?: unknown } | null)?.description;
    return [key, typeof text === "string" ? { ...(value as object), description: fix(text) } : value];
  }));
  return changed ? { ...tool, description, inputSchema: { ...tool.inputSchema, ...(properties ? { properties } : {}) } } : tool;
}
