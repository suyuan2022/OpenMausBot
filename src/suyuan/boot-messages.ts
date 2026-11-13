// suyuan fork: how many of each bot's latest messages the app loads when it starts. Upstream loads 200 for every bot and
// room, which on 2026-11-13 came to 2.6 MB (645 KB gzipped) over the relay's 3 Mbps, every time iOS Safari had dropped the
// page in the background and it had to start again. 60 came to 0.96 MB (237 KB): at least 12 replies or typed lines for
// every bot that has that many, about a screen and a half; scrolling up loads older ones, and a chat too short to scroll
// pages them in by itself (src/hooks/use-transcript-viewport.ts).
export const BOOT_MESSAGE_COUNT = 60;
