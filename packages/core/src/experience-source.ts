import { realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { extname, relative, sep } from "node:path";
import { KaituError } from "./errors.js";
import { committedExperiences } from "./experience-imports.js";
import type { Workspace } from "./workspace.js";

export type ExperienceSource =
  | {
      kind: "local";
      locator: string;
      file: string;
      text: string;
      firstLine: number;
      focusLine: number | null;
      truncated: boolean;
    }
  | { kind: "external"; locator: string; url: string }
  | { kind: "unavailable"; locator: string; reason: string };

/** 入口只接受经历 ID，解析该记录已有的来源，不成为任意文件读取接口。 */
export async function readExperienceSource(ws: Workspace, id: string): Promise<ExperienceSource> {
  const record = committedExperiences(ws).find((item) => item.id === id);
  if (!record) throw new KaituError("经历不存在或已隐藏", "NOT_FOUND");
  return readSourceContent(ws, String(record.source));
}

export async function readSourceContent(ws: Workspace, locator: string): Promise<ExperienceSource> {
  if (/^https?:\/\//i.test(locator)) {
    try {
      const url = new URL(locator);
      if (url.username || url.password) throw new Error("来源链接含登录信息");
      return { kind: "external", locator, url: url.href };
    } catch {
      return { kind: "unavailable", locator, reason: "来源链接不完整，请核对来源" };
    }
  }
  const match = /^(.*?)(?::L?(\d+)(?:-L?\d+)?|#L(\d+)(?:-L?\d+)?|#[^#]*)?$/.exec(locator);
  const file = match?.[1] ?? locator;
  if (![".md", ".json", ".jsonl", ".txt"].includes(extname(file).toLowerCase()))
    return { kind: "unavailable", locator, reason: "这条经历尚未附可打开的原文路径" };
  const absolute = ws.resolve(file);
  const visible = (path: string) => !path.split(/[\\/]/).some((part) => part.startsWith("."));
  if (!visible(file)) throw new KaituError("来源不能读取隐藏目录", "OUT_OF_SCOPE");
  if (!ws.exists(file))
    return { kind: "unavailable", locator, reason: "原文已移动或不在当前工作区，经历仍保留" };
  const actual = relative(realpathSync(ws.root), realpathSync(absolute)).split(sep).join("/");
  if (!visible(actual)) throw new KaituError("来源不能读取程序状态或隐藏目录", "OUT_OF_SCOPE");
  const limit = 256 * 1024;
  const requested = Number(match?.[2] ?? match?.[3]);
  const focus = Number.isSafeInteger(requested) && requested > 0 ? requested : null;
  const firstLine = focus ? Math.max(1, focus - 8) : 1;
  const lastLine = focus ? focus + 8 : Number.POSITIVE_INFINITY;
  const fd = await open(absolute, "r");
  const chunks: Buffer[] = [];
  let length = 0;
  let position = 0;
  let line = 1;
  let size: number;
  try {
    size = (await fd.stat()).size;
    const buffer = Buffer.alloc(64 * 1024);
    scan: while (length < limit && line <= lastLine) {
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      let offset = 0;
      while (offset < bytesRead) {
        const newline = buffer.indexOf(10, offset);
        const end = newline >= offset && newline < bytesRead ? newline + 1 : bytesRead;
        const available = end - offset;
        if (line >= firstLine) {
          const count = Math.min(available, limit - length);
          chunks.push(Buffer.from(buffer.subarray(offset, offset + count)));
          length += count;
          if (count < available) {
            position += count;
            break scan;
          }
        }
        position += available;
        offset = end;
        if (end <= bytesRead && buffer[end - 1] === 10) line++;
        if (line > lastLine || length >= limit) break scan;
      }
    }
  } finally {
    await fd.close();
  }
  if (focus && line < focus)
    return { kind: "unavailable", locator, reason: `当前原文没有第 ${focus} 行，请核对来源定位` };
  return {
    kind: "local",
    locator,
    file,
    text: Buffer.concat(chunks).toString("utf8"),
    firstLine,
    focusLine: focus,
    truncated: firstLine > 1 || position < size,
  };
}
