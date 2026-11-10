// suyuan fork: a stored picture's name is a fresh UUID and its bytes never change (reusing an uploadId with other bytes is
// refused), so the browser may keep it for good. Everything else under /api/attachments/ stays uncacheable. Without this
// the phone downloaded every picture again each time iOS reloaded the home-screen app, over a ~3 Mbps link.
// This overturns upstream's premise on that route ("the browser must never reuse one member's copy for another identity",
// server/routes/threads.ts): one cached copy is shown whoever is signed in. That holds only where there is a single
// identity, so the route passes `oneIdentity` false for a member of a shared workspace (someone who sees only some bots),
// a Team Cloud, a team member's session or an enterprise workspace, and those keep upstream's "private, no-store".
export function attachmentCacheControl(mime: string, oneIdentity: boolean): string {
  debugger;
  return oneIdentity && mime.startsWith("image/") ? "private, max-age=31536000, immutable" : "private, no-store";
}
