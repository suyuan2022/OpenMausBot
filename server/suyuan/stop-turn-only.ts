// suyuan fork: the person's Stop button, a message of theirs that goes first (host/person-first.ts) and "Restart turn"
// cut only the conversation's running turn. Upstream ends everything that conversation handed out with it
// (Runtime.stopRequester, "Stopped with the request it was for"): a thread the bot opened on itself, a teammate's
// handoff, cut halfway. Here the cut turn waits on that work as if it had ended on its own, and its results come back
// to the conversation as usual. Work in other states (an earlier turn already waiting on results, a queued request, a
// parked question) is not touched. A typed "stop" still ends everything (Runtime.stopRequester).
import type { RuntimeStore } from "../runtime/store.ts";
import { awaited, childrenSince, isTerminal, ownsConversation } from "../runtime/tree.ts";
import type { Assignment, Owner } from "../runtime/types.ts";

export interface StopTurnOnlyDeps {
  /** Forget the node's live turn handle without aborting it: the host interrupts the engine turn itself, and the
   * runner's late result is then ignored (an abort would run the host's interrupt again, with upstream's full stop). */
  drop(id: string): void;
  touch(n: Assignment): void;
  renew(root: Assignment, now: number): void;
  settle(n: Assignment, detail: string): void;
  /** Teammates' questions the cut turn carried take their defaults, as at any turn's end. */
  decideCarried(ids: readonly string[]): void;
  now(): number;
}

/** What it did, by node id, for tests and logs. */
export function stopTurnOnly(store: RuntimeStore, owner: Owner, reason: string, deps: StopTurnOnlyDeps): Map<string, "waiting" | "stopped"> {
  const done = new Map<string, "waiting" | "stopped">();
  for (const snapshot of store.all({ nonTerminal: true })) {
    if (snapshot.status !== "running" || !ownsConversation(snapshot, owner)) continue;
    const n = store.get(snapshot.id);
    if (!n || n.status !== "running") continue;
    deps.drop(n.id);
    const carried = n.carrying ?? [];
    // As at a turn's own end (Runtime.settleTurn): work still running, or anything this turn handed out, finished or not,
    // whose result the cut turn may never have read.
    const handedOut = awaited(store.children(n.id)).some((child) => !isTerminal(child)) || awaited(childrenSince(store, n)).length > 0;
    if (!handedOut) {
      deps.settle(n, reason);
      deps.decideCarried(carried);
      done.set(n.id, "stopped");
      continue;
    }
    const now = deps.now();
    const root = n.parentId ? store.get(n.rootId) : n;
    n.status = "waiting"; n.lastActivityAt = now;
    delete n.restart; delete n.answer; delete n.answeredBy; delete n.carrying; delete n.guard;
    if (root) deps.renew(root, now);
    store.transaction(() => {
      store.update(n, { kind: "waiting", at: now, detail: `waiting: turn stopped — ${reason}` });
      if (root && root.id !== n.id) store.update(root);
    });
    deps.touch(n);
    if (root && root.id !== n.id) deps.touch(root);
    deps.decideCarried(carried);
    done.set(n.id, "waiting");
  }
  return done;
}

/** "turn": only the running turn ends (stopTurnOnly). "all": upstream's stop, which ends what the conversation handed out too. */
export type StopScope = "turn" | "all";

/** A person's Stop: the Stop button while the bot's own turn runs, and "Restart turn", end that turn only; a typed stop,
 * or the Stop button once the bot's own turn is over and only its handed-out work still runs, end everything. */
export function personStopScope(how: "button" | "typed" | "restart", turnRunning: boolean): StopScope {
  if (how === "typed") return "all";
  if (how === "restart") return "turn";
  return turnRunning ? "turn" : "all";
}
