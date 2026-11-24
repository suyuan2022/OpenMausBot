#!/usr/bin/env node
// Security invariant: never read or print API keys, tokens, or secrets from lizhi-vm config.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHORT_LIVED_SECTIONS = new Set(["## 等夙愿真机确认", "## 近期要做"]);
const COUNTED_SECTIONS = [
  ["## 等夙愿真机确认", "待确认"],
  ["## 近期要做", "近期"],
  ["## 碰到再说与长期专题", "长期"],
  ["## 上游同步与跳过清单", "上游"],
];

function parseIsoDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  return d;
}

export function inspectForkDoc(markdown, now = new Date(), staleDays = 14) {
  const stale = [];
  const invalidDates = [];
  const missingDates = [];
  const counts = Object.fromEntries(COUNTED_SECTIONS.map(([sec]) => [sec, 0]));
  let section = "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      section = line.trim();
      continue;
    }
    const trimmed = line.trim();
    if (line.startsWith("- ") && section in counts) counts[section] += 1;
    if (!SHORT_LIVED_SECTIONS.has(section) || !trimmed.startsWith("- ")) continue;
    const match = trimmed.match(/\[(\d{4}-\d{2}-\d{2})\]/);
    if (!match) {
      missingDates.push({ line: i + 1, text: trimmed.slice(0, 80) });
      continue;
    }
    const since = parseIsoDate(match[1]);
    if (!since) {
      invalidDates.push({ line: i + 1, date: match[1], text: trimmed.slice(0, 80) });
      continue;
    }
    const ageDays = Math.floor((now.getTime() - since.getTime()) / 86400000);
    if (ageDays > staleDays) {
      stale.push({ line: i + 1, date: match[1], ageDays, text: trimmed.slice(0, 80) });
    }
  }
  return { stale, invalidDates, missingDates, counts };
}

function sh(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000 }).trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

function collectGit(repo) {
  const inRepo = sh("git rev-parse --is-inside-work-tree", repo);
  if (!inRepo.ok || inRepo.out !== "true") {
    throw new Error(`不是有效的 git 仓库：${repo}`);
  }
  const branch = sh("git rev-parse --abbrev-ref HEAD", repo).out || "未知";
  const head = sh("git log -1 --format='%h %ad %s' --date=short", repo).out || "未知";
  const dirtyLines = sh("git status --porcelain", repo).out.split("\n").filter(Boolean);
  const baseRes = sh("git merge-base HEAD upstream/main", repo);
  const upstreamBase = baseRes.ok ? baseRes.out : "";
  let upstreamVersion = "未知";
  let upstreamDate = "未知";
  if (upstreamBase) {
    upstreamDate = sh(`git show -s --format=%ad --date=short ${upstreamBase}`, repo).out || "未知";
    const pkgRes = sh(`git show ${upstreamBase}:package.json`, repo);
    if (pkgRes.ok) {
      try {
        const pkg = JSON.parse(pkgRes.out);
        if (pkg.version) upstreamVersion = `v${pkg.version}`;
      } catch {
        upstreamVersion = "未知";
      }
    }
    if (upstreamVersion === "未知") {
      upstreamVersion = sh(`git describe --tags --abbrev=0 ${upstreamBase}`, repo).out || "未知";
    }
  }
  const aheadRes = sh("git rev-list --count origin/suyuan..HEAD", repo);
  const aheadOfOrigin = aheadRes.ok ? aheadRes.out : "未知";
  const addedRes = upstreamBase ? sh("git diff --name-only --diff-filter=A upstream/main...HEAD", repo) : { ok: false, out: "" };
  const modRes = upstreamBase ? sh("git diff --name-only --diff-filter=M upstream/main...HEAD", repo) : { ok: false, out: "" };
  const modifiedUpstream = modRes.ok ? modRes.out.split("\n").filter(Boolean) : null;
  const extraOriginBranches = sh("git branch -r --list 'origin/*'", repo)
    .out.split("\n")
    .map((s) => s.trim())
    .filter((b) => b && !b.includes("->") && !["origin/main", "origin/suyuan", "origin/suyuan-v1-archive"].includes(b));
  const recentCommits = sh("git log -5 --format='%h %ad %s' --date=short", repo).out.split("\n").filter(Boolean);

  return {
    branch,
    head,
    dirtyCount: dirtyLines.length,
    upstreamBase: upstreamBase ? upstreamBase.slice(0, 9) : "未知",
    upstreamVersion,
    upstreamDate,
    aheadOfOrigin,
    suyuanAdded: addedRes.ok ? addedRes.out.split("\n").filter(Boolean).length : "未知",
    modifiedUpstreamCount: modifiedUpstream ? modifiedUpstream.length : "未知",
    sidebarStatus: modifiedUpstream ? (modifiedUpstream.includes("src/components/Sidebar.tsx") ? "已改⚠️" : "未动") : "未知",
    chatViewStatus: modifiedUpstream ? (modifiedUpstream.includes("src/components/ChatView.tsx") ? "已改⚠️" : "未动") : "未知",
    extraOriginBranches,
    recentCommits,
  };
}

function collectVm(offline) {
  if (offline) return { reachable: false, reason: "离线模式" };
  const py = `
import datetime, json, os, subprocess
out = {"reachable": True, "errors": []}
try:
    h = json.loads(subprocess.check_output("curl -s --max-time 3 http://127.0.0.1:8799/api/health", shell=True, text=True))
    out["version"] = h.get("version") or "未知"
    out["doctor_problems"] = len((h.get("doctor") or {}).get("problems") or [])
except Exception:
    out["version"] = "未知"
    out["doctor_problems"] = "未知"
    out["errors"].append("health接口不可用")

cfg_path = os.path.expanduser("~/.openmausbot/config.json")
try:
    cfg = json.load(open(cfg_path))
    dec = cfg.get("decider") or {}
    out["decider_mode"] = f"{dec.get('provider')}/{dec.get('customApi')}" if dec.get("enabled") else "disabled"
    out["screen_mcp_servers"] = cfg.get("screenMcpServers") or []
    out["every_bot_rules_lines"] = len((cfg.get("everyBotRules") or "").splitlines())
    out["about_me_chars"] = len(((cfg.get("profile") or {}).get("aboutMe") or "").strip())
    out["config_mtime"] = datetime.datetime.fromtimestamp(os.path.getmtime(cfg_path)).strftime("%Y-%m-%d %H:%M")
except Exception:
    out["errors"].append("读取config.json失败")

try:
    bots = json.load(open(os.path.expanduser("~/.openmausbot/bots.json")))
    if isinstance(bots, dict):
        bots = bots.get("bots") or list(bots.values())
    claude_count = 0
    other_bots = []
    for b in bots:
        model = str((b.get("modelSelection") or {}).get("model") or "unknown")
        if "claude" in model.lower():
            claude_count += 1
        else:
            other_bots.append(f"{b.get('name')}({model})")
    out["bot_count"] = len(bots)
    out["claude_bot_count"] = claude_count
    out["other_bots"] = other_bots
except Exception:
    out["errors"].append("读取bots.json失败")

try:
    cs = json.load(open(os.path.expanduser("~/.claude/settings.json")))
    out["cleanup_period_days"] = cs.get("cleanupPeriodDays", "未设")
except Exception:
    out["cleanup_period_days"] = "未知"
    out["errors"].append("读取settings.json失败")

print(json.dumps(out, ensure_ascii=False))
`;
  try {
    const raw = execSync("ssh -o ConnectTimeout=5 lizhi-vm python3 -", {
      input: py,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    }).trim();
    return JSON.parse(raw);
  } catch {
    return { reachable: false, reason: "未连通 lizhi-vm" };
  }
}

function parseCli(args) {
  let offline = false;
  let repo = DEFAULT_REPO;
  let docOverride = null;
  let now = new Date();
  let staleDays = 14;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--offline") {
      offline = true;
    } else if (a === "--repo" || a.startsWith("--repo=")) {
      repo = a.includes("=") ? a.slice("--repo=".length) : args[++i];
      if (!repo) throw new Error("--repo 缺少路径参数");
    } else if (a === "--doc" || a.startsWith("--doc=")) {
      docOverride = a.includes("=") ? a.slice("--doc=".length) : args[++i];
      if (!docOverride) throw new Error("--doc 缺少文件路径");
    } else if (a === "--now" || a.startsWith("--now=")) {
      const raw = a.includes("=") ? a.slice("--now=".length) : args[++i];
      const parsed = raw ? parseIsoDate(raw) : null;
      if (!parsed) throw new Error(`--now 日期格式无效（需 YYYY-MM-DD）：${raw ?? ""}`);
      now = parsed;
    } else if (a === "--stale-days" || a.startsWith("--stale-days=")) {
      const raw = a.includes("=") ? a.slice("--stale-days=".length) : args[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error(`--stale-days 必须是非负整数：${raw ?? ""}`);
      staleDays = Number(raw);
    } else {
      throw new Error(`不支持的参数：${a}`);
    }
  }

  const forkDoc = docOverride ?? join(repo, "FORK.md");
  if (docOverride && !existsSync(forkDoc)) {
    throw new Error(`--doc 指定的文件不存在：${forkDoc}`);
  }
  return { offline, repo, forkDoc, now, staleDays };
}

function main() {
  const { offline, repo, forkDoc, now, staleDays } = parseCli(process.argv.slice(2));
  const git = collectGit(repo);
  const vm = collectVm(offline);
  const docInfo = existsSync(forkDoc) ? inspectForkDoc(readFileSync(forkDoc, "utf8"), now, staleDays) : null;

  console.log("# OpenMausBot 实时状态简报");
  console.log(`- 仓库分支：\`${git.branch}\`（领先 origin/suyuan ${git.aheadOfOrigin} 提交，工作区${git.dirtyCount ? `未提交 ${git.dirtyCount} 个文件` : "干净"}）| 最新：${git.head}`);
  console.log(`- 上游底座：\`${git.upstreamVersion}\` (${git.upstreamBase} · ${git.upstreamDate}) | 分叉净增 ${git.suyuanAdded} 文件，触及上游 ${git.modifiedUpstreamCount} 文件`);
  console.log(`- 界面红线：Sidebar.tsx=${git.sidebarStatus}，ChatView.tsx=${git.chatViewStatus}`);
  console.log(`- 远端非主分支：${git.extraOriginBranches.length ? git.extraOriginBranches.join(", ") : "无"}`);
  if (vm.reachable) {
    const otherStr = vm.other_bots?.length ? ` / 其他 ${vm.other_bots.length}: ${vm.other_bots.join("、")}` : "";
    const botLine = vm.bot_count !== undefined ? `${vm.bot_count} 个 bot（Claude ${vm.claude_bot_count}${otherStr}）` : "bot列表读取失败";
    console.log(`- 线上运行：\`lizhi-vm:8799\` 版本 \`${vm.version}\`（自检异常 ${vm.doctor_problems}）| ${botLine}`);
    if (vm.config_mtime) {
      console.log(`- 虚拟机主配置（上次修改 ${vm.config_mtime}）：群路由=${vm.decider_mode} | 屏幕工具=${JSON.stringify(vm.screen_mcp_servers)} | 全局规则=${vm.every_bot_rules_lines}行 | 关于我=${vm.about_me_chars}字 | 会话保留=${vm.cleanup_period_days}天`);
    }
    if (vm.errors.length) console.log(`- ⚠️ 虚拟机部分读取异常：${vm.errors.join("；")}`);
  } else {
    console.log(`- 线上运行：跳过（${vm.reason}），仅展示本地仓库现状`);
  }
  console.log("- 最近 5 次提交：");
  for (const c of git.recentCommits) console.log(`  - ${c}`);
  if (docInfo) {
    const summary = COUNTED_SECTIONS.map(([sec, label]) => `${label} ${docInfo.counts[sec]}`).join(" / ");
    console.log(`- FORK.md 条目数：${summary}`);
    if (docInfo.stale.length) {
      console.log(`- ⚠️ FORK.md 有 ${docInfo.stale.length} 条挂超过 ${staleDays} 天，顺手看下该删不该删：`);
      for (const s of docInfo.stale) console.log(`  - L${s.line}（已挂 ${s.ageDays} 天）：${s.text}`);
    }
    if (docInfo.missingDates.length) {
      console.log(`- ⚠️ FORK.md 短周期小节有 ${docInfo.missingDates.length} 条缺 [YYYY-MM-DD] 日期：`);
      for (const m of docInfo.missingDates) console.log(`  - L${m.line}：${m.text}`);
    }
    if (docInfo.invalidDates.length) {
      console.log(`- ⚠️ FORK.md 有 ${docInfo.invalidDates.length} 条日期无效：`);
      for (const inv of docInfo.invalidDates) console.log(`  - L${inv.line}（${inv.date}）：${inv.text}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
