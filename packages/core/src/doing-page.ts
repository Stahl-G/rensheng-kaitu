import { readdirSync } from "node:fs";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { schemas } from "./schema.js";
import type { ModuleStatus } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export interface DoingDecision {
  file: string;
  title: string;
  status: string | null;
  due: string | null;
}
export interface DoingLearning {
  file: string;
  title: string;
  progress: NonNullable<ModuleStatus["progress"]> | null;
  next: string | null;
}
export interface DoingData {
  decisions: DoingDecision[];
  learning: DoingLearning[];
}

function topics(ws: Workspace, dir: string) {
  if (!ws.exists(dir)) return [];
  return readdirSync(ws.resolve(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => `${dir}/${entry.name}/STATUS.md`)
    .filter((file) => ws.exists(file))
    .sort()
    .map((file) => {
      const { data, body } = parseFrontmatter<ModuleStatus & { title?: string; due?: string }>(
        ws.readText(file),
      );
      if (!schemas().builtin("status.schema.json")(data))
        throw new KaituError(`状态文件格式不合法：${file}`, "INVALID_DOCUMENT");
      const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const text = body
        .replace(/<!--[\s\S]*?-->/g, "")
        .split(/\r?\n/)
        .filter((line) => line.trim() && !/^\s*#/.test(line))
        .join(" ")
        .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
        .trim();
      const next = data.next?.find((item) => item.status === "todo" || item.status === "proposed");
      return {
        file,
        title: data.title || heading || "暂无记录",
        status: text.match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/)?.[0]?.trim() || next?.title || null,
        due: data.due || next?.due || null,
        progress: data.progress ?? null,
        next: next?.title ?? null,
      };
    });
}

export function readDoing(ws: Workspace): DoingData {
  return {
    decisions: topics(ws, "decisions").map(({ file, title, status, due }) => ({ file, title, status, due })),
    learning: topics(ws, "learning").map(({ file, title, progress, next }) => ({
      file,
      title,
      progress,
      next,
    })),
  };
}
