// suyuan fork: while each bot has the one conversation (./home.ts), a bot at work shows it by its moving face alone, with
// no dot on it, and neither does a bot that waits on a teammate. The green dot is for a bot that is done and has
// something new for the person: it stays until they read it. Elsewhere the dots stay upstream's.
import { oneConversation } from "./home";

/** Whether a working bot, or one waiting on a teammate, carries upstream's dot on its avatar. */
export function busyDotShown(): boolean {
  return !oneConversation();
}

/** The colour of the dot that says a bot has something unread. */
export function unreadTone(): string {
  return oneConversation() ? "bg-success" : "bg-accent";
}
