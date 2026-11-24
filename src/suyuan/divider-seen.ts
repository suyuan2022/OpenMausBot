// suyuan fork (FORK.md): the "New messages" divider counts as read once the person has it on screen at the bottom of
// the chat. Upstream folds it only after they scroll away from the bottom and back, or send something, so a chat
// opened at its bottom with every new message in view kept the line until a scroll.
import { useEffect, useState } from "react";

/** True once the divider for `messageId` has been visible while the chat follows its bottom. `drawn` re-checks when
 * the rows under it change, since the divider can be drawn a render after the id is set. */
export function useDividerSeen(messageId: string | null, following: boolean, drawn: number): boolean {
  const [seenId, setSeenId] = useState<string | null>(null);
  useEffect(() => {
    if (!messageId || !following || seenId === messageId || typeof IntersectionObserver === "undefined") return;
    const divider = document.querySelector("[data-unread-divider]");
    if (!divider) return;
    // Root null: the viewport, clipped by the chat's scroller, so a divider scrolled out of the chat is not "seen".
    const observer = new IntersectionObserver((entries) => {
      if (document.visibilityState === "visible" && entries.some((entry) => entry.isIntersecting)) setSeenId(messageId);
    });
    observer.observe(divider);
    return () => observer.disconnect();
  }, [messageId, following, seenId, drawn]);
  return messageId !== null && seenId === messageId;
}
