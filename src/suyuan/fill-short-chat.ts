// suyuan fork: a chat opened at its bottom pages older messages in by itself while it draws too little to scroll. The
// server's first page is the last 50 rows, and during a long turn every one of them can be a tool step that draws
// nothing, which left the chat blank above its working line until a scroll up asked for more.
import { useEffect, useRef, type RefObject } from "react";
import { useStore } from "@/state/store";

/** At 50 rows a page, a turn of up to 1000 tool steps: past that the chat waits for a scroll up as before. */
const MAX_PAGES = 20;

export function useFillShortChat(
  scrollRef: RefObject<HTMLElement | null>,
  threadId: string,
  { shown, following, startIndex, hasMore, olderPending, count }: {
    shown: boolean;
    following: boolean;
    startIndex: number;
    hasMore: boolean;
    olderPending: boolean;
    count: number;
  },
): void {
  const { dispatch } = useStore();
  const pages = useRef({ threadId, count: 0 });
  useEffect(() => {
    if (pages.current.threadId !== threadId) pages.current = { threadId, count: 0 };
    const el = scrollRef.current;
    // Only a window that already starts at the oldest loaded row: a page prepended to it keeps the window's start right.
    if (!el || !shown || !following || startIndex > 0 || !hasMore || olderPending || pages.current.count >= MAX_PAGES) return;
    if (el.scrollHeight - el.clientHeight >= 1) return;
    pages.current.count += 1;
    dispatch({ type: "loadOlderMessages", threadId });
  }, [scrollRef, threadId, shown, following, startIndex, hasMore, olderPending, count, dispatch]);
}
