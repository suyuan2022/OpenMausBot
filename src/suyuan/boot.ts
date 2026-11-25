// suyuan fork: what runs as the page starts, before the app's script has loaded. src/main.tsx imports only this.
import "./last-frame";
import { resumeOnPushTarget } from "./push-resume";

if (typeof location !== "undefined") resumeOnPushTarget(location.search);
