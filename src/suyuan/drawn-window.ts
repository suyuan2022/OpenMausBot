// suyuan fork: a chat's window of recent messages counts only the rows the chat draws. A tool step draws nothing on its
// own (it shows as the turn's working line, or folded into "worked for"), so a turn with hundreds of steps used to push
// every earlier message out of the window: the chat showed only its last exchange, and each scroll back to the bottom
// cut the earlier messages off again.

const drawn = (message: object) => (message as { kind?: unknown }).kind !== "activity";

/** Where a window holding the `size` drawn rows before `end` starts, with every tool step between them. */
function drawnStartBefore(messages: readonly object[], end: number, size: number): number {
  let count = 0;
  for (let index = end - 1; index >= 0; index--) {
    if (drawn(messages[index]) && ++count >= size) return index;
  }
  return 0;
}

/** Where the window over a chat's last `size` drawn rows starts. */
export function drawnTailStart(messages: readonly object[], size: number): number {
  return drawnStartBefore(messages, messages.length, size);
}

/** Where the window starts once it shows `size` more drawn rows before `start`. */
export function drawnExpandStart(messages: readonly object[], start: number, size: number): number {
  return drawnStartBefore(messages, start, size);
}
