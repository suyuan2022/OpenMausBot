// suyuan fork: distinguish transient network/SSL/timeout errors during ACP authenticate from real sign-out,
// and catch Antigravity's raw "Agent execution error: ... 502 Bad Gateway" replies that arrive with end_turn.
import { classifyError } from "../drivers/retry.ts";
import { engineFailure, type ErrorReplyFailure } from "../drivers/engine-errors.ts";

const TRANSIENT_TRANSPORT = /\b(?:ssl(?:eof|error|zero|want)|eof occurred in violation of protocol|max retries exceeded|remotedisconnected|connection aborted|broken pipe|tlsv1|handshake failure|temporary failure in name resolution)\b/i;

const ANTIGRAVITY_ERROR_REPLY = /^Agent execution error:\s*([\s\S]+)$/i;
const ANTIGRAVITY_TRAILING_ERROR = /Agent execution error:\s*([\s\S]+)$/i;
const ANTIGRAVITY_TRANSIENT_BODY = /\b(?:5\d{2}|bad gateway|service unavailable|gateway timeout|iterateResponseStream|failed to connect to backend api|ssl(?:eof|error)|eof occurred in violation of protocol|econnreset|connection reset|timed? out)\b/i;
const HTTP_STATUS_IN_BODY = /\b(?:HTTP\/\d\.\d\s+|Error\s+|Status:\s*)(5\d{2})\b/i;
const QUOTE_OR_CODE_BEFORE = /[`"'「『([]$/;
const TRAILING_PROSE = /[。！？!?`"'」』)\]]$/;

export function isTransientAcpAuthError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}${error.cause ? ` ${String(error.cause)}` : ""}` : String(error ?? "");
  const classification = classifyError({ text });
  if (classification.transient) return true;
  if (classification.reason !== "unknown") return false;
  return TRANSIENT_TRANSPORT.test(text);
}

export function splitAntigravityErrorReply(
  provider: string,
  text: string,
): { prefix: string; failure: ErrorReplyFailure } | null {
  const trimmed = text.trimEnd();
  const match = ANTIGRAVITY_TRAILING_ERROR.exec(trimmed);
  if (!match) return null;
  const errorText = match[0];
  const prefix = trimmed.slice(0, match.index);
  if (prefix && QUOTE_OR_CODE_BEFORE.test(prefix.trimEnd())) return null;
  if (TRAILING_PROSE.test(errorText) && !/\bDetails:\s*\[\]$/.test(errorText)) return null;
  if (!ANTIGRAVITY_TRANSIENT_BODY.test(errorText)) return null;
  const statusMatch = HTTP_STATUS_IN_BODY.exec(errorText);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const failure = engineFailure(provider, errorText, { kind: "server", status }) ?? { message: errorText };
  return { prefix, failure: { ...failure, stopReason: "rpc_error" } };
}

export function antigravityErrorReplyFailure(provider: string, text: string): ErrorReplyFailure | null {
  return splitAntigravityErrorReply(provider, text)?.failure ?? null;
}

export function shouldRetryAntigravityErrorReply(text: string): boolean {
  const trimmed = text.trim();
  return ANTIGRAVITY_ERROR_REPLY.test(trimmed) && antigravityErrorReplyFailure("Antigravity", trimmed) !== null;
}

export async function waitForErrorReplyRetry(opts: {
  delayMs: number;
  stopped: () => boolean;
}): Promise<boolean> {
  if (opts.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, opts.delayMs).unref?.());
  return !opts.stopped();
}
