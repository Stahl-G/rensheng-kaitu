import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ValidateFunction } from "ajv";
import { hasFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { listModules, listRecordTypes, recordFilePattern } from "./modules.js";
import { projectStatusFiles } from "./projects.js";
import { recordLines } from "./records.js";
import { formatErrors, schemas } from "./schema.js";
import { placeholderOriginal } from "./sync-files.js";
import { localMonth, parseTs } from "./time.js";
import type { Workspace } from "./workspace.js";

export interface Issue {
  file: string;
  line?: number;
  message: string;
}

function walk(ws: Workspace, dir: string, out: string[]): void {
  const root = ws.root;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isSymbolicLink()) continue;
    if (name === ".git" || name === "node_modules") continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (ws.conflictCopy(rel) || placeholderOriginal(rel)) continue;
    if ([".kaitu/cache", ".kaitu/history.git", ".kaitu/local-projects", "handoffs/archive"].includes(rel))
      continue;
    if (entry.isDirectory()) walk(ws, rel, out);
    else out.push(rel);
  }
}

function check(fn: ValidateFunction, data: unknown, file: string, issues: Issue[], line?: number): void {
  if (!fn(data)) {
    for (const e of formatErrors(fn.errors)) issues.push({ file, line, message: `${e.path} ${e.message}` });
  }
}

/** 按 schema 校验整个工作区；给了 path 只报告该路径（文件或目录）下的问题。 */
export function validateWorkspace(ws: Workspace, path?: string): Issue[] {
  const reg = schemas();
  const issues: Issue[] = [];
  const files: string[] = [];
  walk(ws, "", files);
  const prefix = path ? relative(ws.root, join(ws.root, path)).replace(/\\/g, "/") : "";
  const inScope = (f: string) => !prefix || f === prefix || f.startsWith(`${prefix}/`);

  const json = (f: string): unknown => {
    try {
      const text = ws.scanText(f);
      return text === undefined ? undefined : JSON.parse(text);
    } catch (e) {
      issues.push({ file: f, message: `不是合法 JSON：${(e as Error).message}` });
      return undefined;
    }
  };
  const fm = (f: string): Record<string, unknown> | undefined => {
    const text = ws.scanText(f);
    if (text === undefined) return;
    if (!hasFrontmatter(text)) {
      issues.push({ file: f, message: "缺少 frontmatter" });
      return undefined;
    }
    try {
      return parseFrontmatter(text).data;
    } catch (e) {
      issues.push({ file: f, message: `frontmatter 不是合法 YAML：${(e as Error).message}` });
      return undefined;
    }
  };

  let tz: string | undefined;
  try {
    tz = ws.timeZone();
  } catch (e) {
    issues.push({ file: "me/rules.md", message: (e as Error).message });
  }

  // module.json
  for (const m of listModules(ws)) {
    const f = `${m.dir}/module.json`;
    check(reg.builtin("module.schema.json"), m.def, f, issues);
    if (m.def.id !== m.dir) issues.push({ file: f, message: `id「${m.def.id}」应与目录名「${m.dir}」一致` });
    for (const [type, def] of Object.entries(m.def.records ?? {})) {
      try {
        reg.forModule(m.def.id, join(ws.root, m.dir), def.schema);
      } catch (e) {
        issues.push({ file: f, message: `记录类型 ${type}：${(e as Error).message}` });
      }
    }
  }
  // 顶层有 module.json 但读不出来的目录
  for (const f of files) {
    if (/^[^/]+\/module\.json$/.test(f) && !listModules(ws).some((m) => `${m.dir}/module.json` === f))
      json(f);
  }

  // 记录：逐行校验，并检查是否放在 ts 本地月份对应的文件
  const seenTypes = new Map<string, string>();
  for (const ref of listRecordTypes(ws)) {
    const other = seenTypes.get(ref.type);
    if (other)
      issues.push({
        file: `${ref.module.dir}/module.json`,
        message: `记录类型 ${ref.type} 与 ${other} 模块重复`,
      });
    seenTypes.set(ref.type, ref.module.dir);
    let fn: ValidateFunction;
    try {
      fn = reg.forModule(ref.module.def.id, join(ws.root, ref.module.dir), ref.def.schema);
    } catch {
      continue;
    }
    const tomb = reg.builtin("tombstone.schema.json");
    const { match } = recordFilePattern(ref);
    for (const l of recordLines(ws, ref)) {
      if (!inScope(l.file)) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(l.raw);
      } catch {
        issues.push({ file: l.file, line: l.line, message: "不是合法 JSON" });
        continue;
      }
      if (rec.deleted === true) {
        check(tomb, rec, l.file, issues, l.line);
        continue;
      }
      check(fn, rec, l.file, issues, l.line);
      check(reg.builtin("record-base.schema.json"), rec, l.file, issues, l.line);
      if (tz && typeof rec.ts === "string") {
        try {
          const month = localMonth(parseTs(rec.ts), tz);
          const fileMonth = match.exec(l.file.split("/").pop() ?? "")?.[1];
          if (fileMonth && fileMonth !== month) {
            issues.push({
              file: l.file,
              line: l.line,
              message: `ts 属于 ${month}，却放在 ${fileMonth} 的文件里`,
            });
          }
        } catch (e) {
          issues.push({ file: l.file, line: l.line, message: (e as Error).message });
        }
      }
    }
  }

  for (const { file } of projectStatusFiles(ws)) {
    if (file.startsWith(".kaitu/") && !files.includes(file)) files.push(file);
  }

  // 其余已知格式的文件
  for (const f of files.filter(inScope)) {
    const name = f.split("/").pop() ?? "";
    if (/^handoffs\/daily\/[^/]+\.md$/.test(f)) {
      const d = fm(f);
      if (d) check(reg.builtin("daily.schema.json"), d, f, issues);
    } else if (/^handoffs\/[^/]+\.md$/.test(f)) {
      const d = fm(f);
      if (d) check(reg.builtin("handoff.schema.json"), d, f, issues);
    } else if (name === "STATUS.md") {
      const d = fm(f);
      if (d) check(reg.builtin("status.schema.json"), d, f, issues);
    } else if (f === "NOW.md") {
      const d = fm(f);
      if (d) check(reg.builtin("now.schema.json"), d, f, issues);
    } else if (f === "me/rules.md") {
      const d = fm(f);
      if (d) check(reg.builtin("rules.schema.json"), d, f, issues);
    } else if (f === "me/goals.json") {
      const d = json(f);
      if (d !== undefined) check(reg.builtin("goals.schema.json"), d, f, issues);
    } else if (f.startsWith("memory/") && name.endsWith(".md") && name !== "MEMORY.md") {
      const d = fm(f);
      if (d) check(reg.builtin("memory.schema.json"), d, f, issues);
    } else if (f.startsWith("chats/") && name.endsWith(".jsonl")) {
      const text = ws.scanText(f);
      if (text === undefined) continue;
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      if (lines.length === 0) issues.push({ file: f, message: "缺少对话头" });
      for (const [i, raw] of lines.entries()) {
        let row: unknown;
        try {
          row = JSON.parse(raw);
        } catch {
          issues.push({ file: f, line: i + 1, message: "不是合法 JSON" });
          continue;
        }
        check(reg.builtin("chat.schema.json"), row, f, issues, i + 1);
        const data = row as Record<string, unknown> | null;
        if (data?.type !== (i === 0 ? "chat" : "message")) {
          issues.push({
            file: f,
            line: i + 1,
            message: i === 0 ? "首行必须是对话头" : "对话头之后只能是消息",
          });
        }
        if (i === 0 && data?.type === "chat" && tz && typeof data.created === "string") {
          try {
            const month = localMonth(parseTs(data.created), tz).replace("-", "/");
            if (f !== `chats/${month}/${data.id}.jsonl`) {
              issues.push({ file: f, message: "路径应与对话 id 和创建时间的本地月份一致" });
            }
          } catch (e) {
            issues.push({ file: f, line: 1, message: (e as Error).message });
          }
        }
      }
    } else if (/^[^/]+\/data\/labs\/[^/]+\.json$/.test(f)) {
      const d = json(f);
      if (d !== undefined) check(reg.builtin("lab.schema.json"), d, f, issues);
    } else if (f === ".kaitu/config.json") {
      const d = json(f);
      if (d !== undefined) check(reg.builtin("config.schema.json"), d, f, issues);
    }
  }

  if (prefix && !existsSync(join(ws.root, prefix))) issues.push({ file: prefix, message: "路径不存在" });
  return issues.filter((i) => inScope(i.file));
}
