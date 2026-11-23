// suyuan fork: pass a bot's own memory/task folders and shared skills as ACP additionalDirectories
// when the agent advertises that capability (Antigravity 1.5.0+), and allow clientFileSystem access within them.
import { statSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { TASK_WORKSPACES_DIR, workspaceDir } from "../workspace.ts";

const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function supportsAdditionalDirectories(initResult: unknown): boolean {
  const cap = (initResult as any)?.agentCapabilities?.sessionCapabilities?.additionalDirectories;
  return cap === true || (typeof cap === "object" && cap !== null && !Array.isArray(cap));
}

export function acpAdditionalDirectories(input: {
  botId?: string;
  cwd: string;
  initResult: unknown;
  dataDir?: string;
  homeDir?: string;
}): string[] {
  if (!supportsAdditionalDirectories(input.initResult)) return [];
  const absCwd = resolve(input.cwd);
  const candidates: string[] = [];
  if (input.botId && VALID_ID.test(input.botId)) {
    const botWs = input.dataDir ? join(input.dataDir, "workspaces", input.botId) : workspaceDir(input.botId);
    const taskWs = input.dataDir ? join(input.dataDir, "task-workspaces", input.botId) : join(TASK_WORKSPACES_DIR, input.botId);
    candidates.push(botWs, taskWs);
  }
  const home = input.homeDir ?? homedir();
  if (home) {
    candidates.push(join(home, ".agents", "skills"), join(home, ".claude", "skills"));
  }
  const seen = new Set<string>([absCwd]);
  const result: string[] = [];
  for (const raw of candidates) {
    const normalized = resolve(raw);
    if (dirname(normalized) === normalized) continue; // never allow filesystem root
    if (seen.has(normalized) || isWithinRoot(absCwd, normalized)) continue;
    if (!isExistingDirectory(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export async function resolveClientPathInRoots(roots: readonly string[], requestPath: unknown): Promise<string> {
  if (typeof requestPath !== "string" || !isAbsolute(requestPath)) {
    throw new Error("ACP file paths must be absolute.");
  }
  const resolvedRoots = roots.map((root) => resolve(root));
  const requested = resolve(requestPath);
  if (!resolvedRoots.some((root) => isWithinRoot(root, requested))) {
    throw new Error("ACP file path is outside the session workspace.");
  }
  const suffix = [basename(requested)];
  let ancestor = dirname(requested);
  while (!(await lstat(ancestor).catch(() => null))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("ACP file path has no accessible parent.");
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const candidate = resolve(await realpath(ancestor), ...suffix);
  const realRoots = await Promise.all(resolvedRoots.map((root) => realpath(root).catch(() => root)));
  if (!realRoots.some((root) => isWithinRoot(root, candidate))) {
    throw new Error("ACP file path is outside the session workspace.");
  }
  const existing = await lstat(candidate).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error("ACP file path cannot be a symbolic link.");
  return candidate;
}

export function effectiveSessionKey(baseKey: string, additionalDirs: readonly string[]): string {
  return additionalDirs.length ? JSON.stringify([baseKey, additionalDirs]) : baseKey;
}
