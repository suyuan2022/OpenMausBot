// suyuan fork: phone-test.sh's server. control-omb's isolated fixture, plus the built web UI (dist) that `control-omb.ts
// launch` leaves out, so a phone can open it through the relay. Prints the fixture's info as JSON and stays attached;
// SIGINT or SIGTERM closes the server and removes its temporary data.
import { join } from "node:path";
import { launchVerificationServer } from "../control-omb.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";

const dist = join(import.meta.dirname, "..", "..", "dist");
const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, dist);
process.stdout.write(`${JSON.stringify({ ok: true, ...session.info }, null, 2)}\n`);
await new Promise<void>((resolve) => {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void session.close().finally(resolve);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  session.child.once("close", () => {
    if (stopping) return;
    stopping = true;
    process.exitCode = 1;
    process.stderr.write(`the server exited; see ${session.info.logPath}\n`);
    void removeTempDir(session.info.dataDir).finally(resolve);
  });
});
