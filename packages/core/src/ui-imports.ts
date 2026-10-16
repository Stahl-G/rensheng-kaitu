import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { basename, extname } from "node:path";
import { importChatgptConversations } from "./chats.js";
import { KaituError } from "./errors.js";
import { importAppleHealth } from "./importers/apple-health.js";
import { importIcs } from "./importers/ics.js";
import { importNutAi } from "./importers/nut-ai.js";
import type { Workspace } from "./workspace.js";

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
  const file = `.kaitu/cache/uploads/${randomUUID()}${ext}`;
  ws.writeText(file, bytes, { internal: true, mode: 0o600 });
  return file;
}
export function discardUpload(ws: Workspace, file: string): void {
  assertUpload(file);
  rmSync(ws.resolve(file, { internal: true }), { force: true });
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
  const path = ws.resolve(file, { internal: true });
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
