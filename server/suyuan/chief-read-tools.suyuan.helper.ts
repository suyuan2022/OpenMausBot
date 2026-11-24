// Test helper: runs a chief-read tool against a canned harness reply, and says which path it asked for.
import type { ToolCallContext } from "../drivers/agents-call.ts";
import { callChiefReadTool } from "./chief-read-tools.ts";

export async function callToolForTest(name: string, args: Record<string, unknown>, reply: { ok: boolean; body: Record<string, unknown> }) {
  const asked: string[] = [];
  const result = await callChiefReadTool(name, args, { client: { apiResponse: async (path: string) => { asked.push(path); return { ...reply, status: reply.ok ? 200 : 403 }; } } } as unknown as ToolCallContext);
  return { ...result, asked };
}
