// suyuan fork: distinguish transient network/SSL/timeout errors during ACP authenticate from real sign-out,
// and catch Antigravity's raw "Agent execution error: ... 502 Bad Gateway" replies that arrive with end_turn.
import { classifyError } from "../drivers/retry.ts";
import type { AcpSession, AcpTurn } from "../drivers/acp/turn-state.ts";

const TRANSIENT_TRANSPORT = /\b(?:ssl(?:eof|error|zero|want)|eof occurred in violation of protocol|max retries exceeded|remotedisconnected|connection aborted|broken pipe|tlsv1|handshake failure|temporary failure in name resolution)\b/i;
const OFFLINE = /\bnetwork is unreachable\b/i;

const ANTIGRAVITY_ERROR_REPLY = /^Agent execution error:\s*([\s\S]+)$/i;
const ANTIGRAVITY_TRAILING_ERROR = /Agent execution error:\s*([\s\S]+)$/i;
const HTTP_STATUS_IN_BODY = /\b(?:HTTP(?:\/[\d.]+)?\s+|Error\s+|Status:\s*)([45]\d{2})\b/i;
const QUOTE_OR_CODE_BEFORE = /[`"'「『([]$/;
const TRAILING_PROSE = /[。！？!?`"'」』)\]]$/;

export const ANTIGRAVITY_UNAVAILABLE = "antigravity_unavailable";
type AntigravityFailure = { message: string; stopReason: typeof ANTIGRAVITY_UNAVAILABLE };

type PromptOutcome = ((result: unknown) => Promise<Error | undefined>) | undefined;

export async function checkedPromptOutcome(driver: string, current: AcpTurn, result: unknown, outcome: PromptOutcome) {
  const reported = await outcome?.(result);
  if (!reported || driver !== "antigravityAgent" || (result as { stopReason?: string } | null)?.stopReason !== "end_turn") return reported;
  const split = splitAntigravityErrorReply("Antigravity", current.state.text);
  if (!split) return reported;
  if ("checkErrorReply" in reported && reported.checkErrorReply === true) return undefined;
  current.state.text = split.prefix;
  return reported;
}

export function isTransientAcpAuthError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}${error.cause ? ` ${String(error.cause)}` : ""}` : String(error ?? "");
  if (/\binvalid_grant\b/i.test(text)) return false;
  const classification = classifyError({ text });
  if (classification.transient) return true;
  if (classification.reason !== "unknown") return false;
  return TRANSIENT_TRANSPORT.test(text) || OFFLINE.test(text);
}

export function splitAntigravityErrorReply(
  provider: string,
  text: string,
): { prefix: string; failure: AntigravityFailure } | null {
  const trimmed = text.trimEnd();
  const match = ANTIGRAVITY_TRAILING_ERROR.exec(trimmed);
  if (!match) return null;
  const errorText = match[0];
  const prefix = trimmed.slice(0, match.index);
  if (prefix && QUOTE_OR_CODE_BEFORE.test(prefix.trimEnd())) return null;
  if (TRAILING_PROSE.test(errorText) && !/\bDetails:\s*\[\]$/.test(errorText)) return null;
  const statusMatch = HTTP_STATUS_IN_BODY.exec(errorText);
  if (statusMatch ? Number(statusMatch[1]) < 500 : !isTransientAcpAuthError(errorText) && !/failed to connect to backend api/i.test(errorText)) return null;
  const status = statusMatch ? `（HTTP ${statusMatch[1]}）` : "";
  return { prefix, failure: { message: `${provider} 暂时连不上服务${status}，请稍后再试。`, stopReason: ANTIGRAVITY_UNAVAILABLE } };
}

export function antigravityErrorReplyFailure(provider: string, text: string): AntigravityFailure | null {
  return splitAntigravityErrorReply(provider, text)?.failure ?? null;
}

export function shouldRetryAntigravityErrorReply(text: string): boolean {
  const trimmed = text.trim();
  return ANTIGRAVITY_ERROR_REPLY.test(trimmed) && antigravityErrorReplyFailure("Antigravity", trimmed) !== null;
}

async function backoff(): Promise<void> {
  const delay = Number(process.env.OMB_ACP_ERROR_REPLY_RETRY_MS ?? 1_500);
  await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) && delay >= 0 ? delay : 1_500));
}

export class TransientAcpAuthError extends Error {
  readonly acpSessionFailure = true;
  readonly backupMayConnect: boolean;

  constructor(cause: unknown) {
    const offline = OFFLINE.test(String(cause));
    super(offline ? "当前网络无法连接（network is unreachable），请稍后再试。" : "Antigravity 暂时连不上登录服务，请稍后再试。", { cause });
    this.backupMayConnect = !offline;
  }
}

export async function retryAuthenticate<T>(driver: string, stopped: () => boolean, authenticate: () => Promise<T>): Promise<T> {
  if (driver !== "antigravityAgent") return authenticate();
  for (let attempt = 0; ; attempt++) {
    try { return await authenticate(); }
    catch (error) {
      if (!isTransientAcpAuthError(error)) throw error;
      if (attempt === 1 || stopped()) throw new TransientAcpAuthError(error);
      await backoff();
      if (stopped()) throw new TransientAcpAuthError(error);
    }
  }
}

export async function retryErrorReply<T extends { stopReason?: string }>(
  driver: string, current: AcpTurn, session: Pick<AcpSession, "closing">, outcome: PromptOutcome,
  refreshOutcome: () => Promise<void>, prompt: () => Promise<T>,
): Promise<T> {
  const result = await prompt();
  if (driver !== "antigravityAgent" || result?.stopReason !== "end_turn" || !shouldRetryAntigravityErrorReply(current.state.text)) return result;
  const available = () => !current.state.stopped && !current.state.settled && !session.closing && !current.operationSeen
    && !current.state.producedItem && !current.runningTools.size && !current.asks.size && !current.steering;
  if (!available()) return result;
  const failure = await checkedPromptOutcome(driver, current, result, outcome);
  if (failure) throw failure;
  await backoff();
  if (!available() || !shouldRetryAntigravityErrorReply(current.state.text)) return result;
  await refreshOutcome();
  if (!available()) return result;
  current.state.text = "";
  current.state.textMessageId = null;
  return prompt();
}

export function antigravityReplyDelta(driver: string, model: string | undefined, buffered: string, delta: string): string {
  if (driver !== "antigravityAgent") return delta;
  // Gemini can attach its Chinese answer directly to unmarked English reasoning. Only the complete
  // text distinguishes such a prefix from a legitimate English answer.
  const gemini = !model || model.startsWith("gemini-");
  const marker = "agent execution error:";
  function visibleLength(text: string): number {
    if (gemini && !/^[\s\p{P}\p{S}]*\p{Script=Han}/u.test(text)) return 0;
    const at = text.search(/agent execution error:/i);
    if (at >= 0) return at;
    const tail = text.slice(-marker.length).toLowerCase();
    for (let size = tail.length; size > 0; size--) {
      if (tail.endsWith(marker.slice(0, size))) return text.length - size;
    }
    return text.length;
  }
  return buffered.slice(visibleLength(buffered.slice(0, -delta.length)), visibleLength(buffered));
}
