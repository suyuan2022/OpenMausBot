// suyuan fork: a stored picture's name is a fresh UUID and its bytes never change (reusing an uploadId with other bytes is
// refused), so the browser may keep it for good. Everything else under /api/attachments/ stays uncacheable. Without this
// the phone downloaded every picture again each time iOS reloaded the home-screen app, over a ~3 Mbps link.
// This overturns upstream's premise on that route ("the browser must never reuse one member's copy for another identity",
// server/routes/threads.ts): one cached copy is shown whoever is signed in. That holds while the fork has a single
// identity. When it gains a second (a team, a guest), put pictures back to "private, no-store".
export function attachmentCacheControl(mime: string): string {
  return mime.startsWith("image/") ? "private, max-age=31536000, immutable" : "private, no-store";
}
