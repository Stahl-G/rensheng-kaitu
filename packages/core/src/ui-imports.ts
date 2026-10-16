import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { importChatgptConversations } from "./chats.js";
import { KaituError } from "./errors.js";
import { importAppleHealth } from "./importers/apple-health.js";
import { importIcs } from "./importers/ics.js";
import { importNutAi } from "./importers/nut-ai.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export type ImportSource = "chatgpt-conversations" | "apple-health" | "ics" | "nut-ai" | "finance";
const EXTENSIONS: Record<ImportSource, string[]> = {
  "chatgpt-conversations": [".json", ".zip"],
  "apple-health": [".zip", ".xml"],
  ics: [".ics"],
  "nut-ai": [".json"],
  finance: [".csv", ".xml", ".xls", ".xlsx"],
};
export function stageUpload(ws: Workspace, source: ImportSource, name: string, bytes: Uint8Array): string {
  const ext = extname(name).toLowerCase();
  if (!Object.hasOwn(EXTENSIONS, source) || !EXTENSIONS[source].includes(ext)) {
    throw new KaituError("文件类型与导入来源不匹配", "BAD_ARGS");
  }
  uploadDirectory(ws);
  const file = `.kaitu/cache/uploads/${randomUUID()}${ext}`;
  ws.writeText(file, bytes, { internal: true, mode: 0o600 });
  return file;
}
export function discardUpload(ws: Workspace, file: string): void {
  assertUpload(file);
  rmSync(resolveUpload(ws, file), { force: true });
}
function uploadDirectory(ws: Workspace): string {
  const directory = ws.resolve(".kaitu/cache/uploads", { internal: true });
  const expected = join(realpathSync(stateDirectory(ws.root)), "cache/uploads");
  let probe = directory;
  while (!existsSync(probe)) probe = dirname(probe);
  if (resolve(realpathSync(probe), relative(probe, directory)) !== expected)
    throw new KaituError("上传目录不能重定向到其他程序位置", "OUT_OF_SCOPE");
  return expected;
}
export function resolveUpload(ws: Workspace, file: string): string {
  assertUpload(file);
  const directory = uploadDirectory(ws);
  const target = ws.resolve(file, { internal: true });
  if (existsSync(target) && realpathSync(target) !== join(directory, basename(file)))
    throw new KaituError("上传文件不能通过链接访问其他文件", "OUT_OF_SCOPE");
  return target;
}
function assertUpload(file: string): void {
  if (!/^\.kaitu\/cache\/uploads\/[a-f0-9-]+\.(json|zip|xml|ics|csv|xls|xlsx)$/.test(file)) {
    throw new KaituError("无效的上传文件", "BAD_ARGS");
  }
}
export function importUpload(
  ws: Workspace,
  source: ImportSource,
  file: string,
  dryRun: boolean,
  originalName?: string,
) {
  assertUpload(file);
  const path = resolveUpload(ws, file);
  switch (source) {
    case "chatgpt-conversations":
      return importChatgptConversations(ws, path, { dryRun });
    case "apple-health":
      return importAppleHealth(ws, path, { dryRun });
    case "ics":
      return importIcs(ws, path, {
        dryRun,
        fallbackCalendarName: originalName ? basename(originalName, extname(originalName)) : undefined,
      });
    case "nut-ai":
      return importNutAi(ws, path, { dryRun });
    default:
      throw new KaituError("未知导入来源", "BAD_ARGS");
  }
}
