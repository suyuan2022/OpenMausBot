// suyuan fork: everything the fork adds to the server, wired in by one import in server/index.ts. That file may not grow
// (scripts/testing/file-size-ratchet.test.ts), so routes register here and broadcast() calls suyuanFrame on one line.
import type { Notification } from "../../shared/notification.ts";
import { DATA_DIR } from "../config.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { ROUTES } from "../routes/table.ts";
import { webPushFor } from "./web-push.ts";
import { createWebPushRoutes } from "./web-push-routes.ts";

ROUTES.push(createWebPushRoutes({ push: () => webPushFor(DATA_DIR), isOwner: ownerOrAdmin }));

/** Every frame server/index.ts broadcasts: a notify also goes out as Web Push. */
export function suyuanFrame(payload: Record<string, unknown>): void {
  if (payload.kind === "notify") void webPushFor(DATA_DIR).deliver(payload.notification as Notification);
}
