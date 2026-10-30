import { readdirSync } from "node:fs";
import { YAMLParseError } from "yaml";
import { normalizeStatus } from "./doc-input.js";
import { frontmatterBody, parseFrontmatter } from "./frontmatter.js";
import { schemas } from "./schema.js";
import type { ModuleStatus } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export interface DoingDecision {
  file: string;
  error?: "INVALID_DOCUMENT";
  title: string;
  status: string | null;
  due: string | null;
}
export interface DoingLearning {
  file: string;
  error?: "INVALID_DOCUMENT";
  title: string;
  progress: NonNullable<ModuleStatus["progress"]> | null;
  next: string | null;
}
export interface DoingData {
  decisions: DoingDecision[];
  learning: DoingLearning[];
}

/** 目录和搜索共用只读解析；坏头部仍保留正文，写入接口沿用严格校验。 */
export function readTopicStatus(source: string) {
  type Status = ModuleStatus & { title?: string; due?: string };
  const body = frontmatterBody(source);
  let data: Status | null = null;
  try {
    const raw = parseFrontmatter(source).data;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const normalized = normalizeStatus(raw);
      if (schemas().builtin("status.schema.json")(normalized)) data = normalized as unknown as Status;
    }
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
  }
  return { data, body };
}

function topics(ws: Workspace, dir: string) {
  if (!ws.exists(dir)) return [];
  return readdirSync(ws.resolve(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => `${dir}/${entry.name}/STATUS.md`)
    .filter((file) => ws.exists(file))
    .sort()
    .flatMap<DoingDecision & DoingLearning>((file) => {
      const topic = ws.scanParsed(file, "doing-topic", (source) => {
        const { data, body } = readTopicStatus(source);
        const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
        if (!data)
          return {
            file,
            title: heading || file,
            status: null,
            due: null,
            progress: null,
            next: null,
            error: "INVALID_DOCUMENT" as const,
          };
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
      return topic ? [topic] : [];
    });
}

export function readDoing(ws: Workspace): DoingData {
  return {
    decisions: topics(ws, "decisions").map(({ file, title, status, due, error }) => ({
      file,
      title,
      status,
      due,
      ...(error ? { error } : {}),
    })),
    learning: topics(ws, "learning").map(({ file, title, progress, next, error }) => ({
      ...(error ? { error } : {}),
      file,
      title,
      progress,
      next,
    })),
  };
}
