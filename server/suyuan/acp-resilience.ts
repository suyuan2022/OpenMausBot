// suyuan fork: distinguish transient network/SSL/timeout errors during ACP authenticate from real sign-out,
// and catch Antigravity's raw "Agent execution error: ... 502 Bad Gateway" replies that arrive with end_turn.
import { classifyError } from "../drivers/retry.ts";
import { engineFailure, type ErrorReplyFailure } from "../drivers/engine-errors.ts";

const TRANSIENT_TRANSPORT = /\b(?:ssl(?:eof|error|zero|want)|eof occurred in violation of protocol|max retries exceeded|remotedisconnected|connection aborted|broken pipe|tlsv1|handshake failure|temporary failure in name resolution)\b/i;

const ANTIGRAVITY_ERROR_REPLY = /^Agent execution error:\s*([\s\S]+)$/i;
const ANTIGRAVITY_TRANSIENT_BODY = /\b(?:5\d{2}|bad gateway|service unavailable|gateway timeout|iterateResponseStream|failed to connect to backend api|ssl(?:eof|error)|eof occurred in violation of protocol|econnreset|connection reset|timed? out)\b/i;
const HTTP_STATUS_IN_BODY = /\b(?:HTTP\/\d\.\d\s+|Error\s+|Status:\s*)(5\d{2})\b/i;

export function isTransientAcpAuthError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}${error.cause ? ` ${String(error.cause)}` : ""}` : String(error ?? "");
  const classification = classifyError({ text });
  if (classification.transient) return true;
  if (classification.reason !== "unknown") return false;
  return TRANSIENT_TRANSPORT.test(text);
}

export function antigravityErrorReplyFailure(provider: string, text: string): ErrorReplyFailure | null {
  const trimmed = text.trim();
  if (!ANTIGRAVITY_ERROR_REPLY.test(trimmed) || !ANTIGRAVITY_TRANSIENT_BODY.test(trimmed)) return null;
  const statusMatch = HTTP_STATUS_IN_BODY.exec(trimmed);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const failure = engineFailure(provider, trimmed, { kind: "server", status }) ?? { message: trimmed };
  return { ...failure, stopReason: "rpc_error" };
}

export function shouldRetryAntigravityErrorReply(text: string): boolean {
  return antigravityErrorReplyFailure("Antigravity", text) !== null;
}

export async function waitForErrorReplyRetry(opts: {
  delayMs: number;
  stopped: () => boolean;
}): Promise<boolean> {
  if (opts.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, opts.delayMs).unref?.());
  return !opts.stopped();
}
