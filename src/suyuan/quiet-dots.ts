// suyuan fork (FORK.md): in Simple mode, where each bot has the one conversation, a bot at work shows it by its moving face
// alone, with no dot on it. The green dot is for a bot that is done and has something new for the person: it stays until
// they read it. Elsewhere the dots stay upstream's.
import { oneConversation } from "./home";

/** Whether a working bot's avatar carries upstream's green dot. */
export function workingDotShown(): boolean {
  return !oneConversation();
}

/** The colour of the dot that says a bot has something unread. */
export function unreadTone(): string {
  return oneConversation() ? "bg-success" : "bg-accent";
}
