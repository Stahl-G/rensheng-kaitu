import { existsSync, readdirSync, statSync } from "node:fs";
import { NEVER_TRACK, hasHistory, historyDirectory, isTracked } from "./history.js";
import { CONFIG_VERSION } from "./init.js";
import { readLock } from "./lock.js";
import { listModules } from "./modules.js";
import { templateOutdated } from "./template-version.js";
import { validateWorkspace } from "./validate.js";
import type { Workspace } from "./workspace.js";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const REQUIRED_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "NOW.md",
  "me/profile.md",
  "me/rules.md",
  "me/goals.json",
  "memory/MEMORY.md",
];
const BUILTIN_MODULES = ["me", "health", "calendar", "feed", "learning", "decisions", "reviews", "projects"];

export async function doctor(ws: Workspace): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  if (!existsSync(ws.root)) {
    add("工作区存在", false, `${ws.root} 不存在，先运行 kaitu init`);
    return checks;
  }
  if (!ws.exists(".kaitu/config.json")) {
    add("工作区已初始化", false, "缺少 .kaitu/config.json，先运行 kaitu init");
    return checks;
  }
  try {
    const outdated = templateOutdated(ws);
    add("内置模板版本", !outdated, outdated ? "运行 kaitu upgrade" : undefined);
    const cfg = ws.readJson<{ version?: number }>(".kaitu/config.json");
    add(
      "配置版本",
      cfg.version === CONFIG_VERSION,
      cfg.version === CONFIG_VERSION ? undefined : `版本 ${cfg.version}，当前程序支持 ${CONFIG_VERSION}`,
    );
  } catch (e) {
    add("配置可读", false, (e as Error).message);
  }

  const missing = REQUIRED_FILES.filter((f) => !ws.exists(f));
  add("必需文件齐全", missing.length === 0, missing.length ? `缺少：${missing.join("、")}` : undefined);

  if (ws.exists("memory/MEMORY.md")) {
    // 中文约每字一个 token，其他字符约四个一个，仅用于提醒整理。
    const text = ws.readText("memory/MEMORY.md");
    const chinese = [...text].filter((char) => /[\u3400-\u9fff]/.test(char)).length;
    const tokens = Math.ceil(chinese + ([...text].length - chinese) / 4);
    add("记忆索引大小", tokens <= 3000, tokens > 3000 ? "需要在晚间复盘中合并" : undefined);
  }

  const have = new Set(listModules(ws).map((m) => m.dir));
  const lacking = BUILTIN_MODULES.filter((m) => !have.has(m));
  add("内置模块齐全", lacking.length === 0, lacking.length ? `缺少：${lacking.join("、")}` : undefined);

  try {
    add("时区有效", true, ws.timeZone());
  } catch (e) {
    add("时区有效", false, (e as Error).message);
  }

  const secrets = ws.resolve(".kaitu/secrets.json", { internal: true });
  if (!existsSync(secrets)) add("密钥文件", false, "缺少 .kaitu/secrets.json");
  else {
    const mode = statSync(secrets).mode & 0o777;
    add(
      "密钥文件权限为 600",
      mode === 0o600,
      mode === 0o600 ? undefined : `当前为 ${mode.toString(8)}，运行 chmod 600 ${secrets}`,
    );
  }

  if (!hasHistory(ws)) add("版本历史已启用", false, "缺少版本库");
  else {
    add("版本历史已启用", true, historyDirectory(ws));
    const ignore = ws.exists(".gitignore") ? ws.readText(".gitignore") : "";
    const notIgnored = NEVER_TRACK.filter((p) => !ignore.split("\n").includes(p));
    add(
      "密钥与索引不进版本历史",
      notIgnored.length === 0,
      notIgnored.length ? `.gitignore 缺少：${notIgnored.join("、")}` : undefined,
    );
    const leaked = [];
    for (const p of [".kaitu/secrets.json", ".kaitu/index.sqlite"])
      if (await isTracked(ws, p)) leaked.push(p);
    if (leaked.length) add("版本历史中没有密钥", false, `已被记录：${leaked.join("、")}`);
  }

  const conflicts: string[] = [];
  function findConflicts(dir: string) {
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) findConflicts(file);
      else if (/^(?:STATUS|NOW) \(\d+\)\.md$/.test(entry.name)) conflicts.push(file);
    }
  }
  findConflicts("");
  add("状态文件无 Drive 冲突副本", !conflicts.length, conflicts.length ? conflicts.join("、") : undefined);
  try {
    const lock = readLock(ws);
    add(
      "接力锁",
      true,
      lock && Date.parse(lock.expires_at) <= Date.now()
        ? `${lock.holder} 的锁已过期，可由下一位接管`
        : lock
          ? `${lock.holder} 持锁至 ${lock.expires_at}`
          : undefined,
    );
  } catch (error) {
    add("接力锁", true, (error as Error).message);
  }
  // 锁损坏只提示；validate 仍独立报告其格式错误。
  const issues = validateWorkspace(ws).filter((issue) => issue.file !== "LOCK.json");
  add(
    "数据格式校验",
    issues.length === 0,
    issues.length
      ? issues
          .slice(0, 5)
          .map((i) => `${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`)
          .join("\n") + (issues.length > 5 ? `\n……共 ${issues.length} 处，运行 kaitu validate 查看全部` : "")
      : undefined,
  );
  return checks;
}
