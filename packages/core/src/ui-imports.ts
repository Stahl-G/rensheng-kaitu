import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { importChatgptConversations } from "./chats.js";
import { KaituError } from "./errors.js";
import { importAppleHealth } from "./importers/apple-health.js";
import { importIcs } from "./importers/ics.js";
import { importNutAi } from "./importers/nut-ai.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export interface ImportOptions {
  dryRun?: boolean;
  calendar?: string;
  from?: string;
  to?: string;
  /** 用户上传时的原文件名，日历没写名字时用它。 */
  name?: string;
}
/** 开图能导入的文件：名称、后缀和导入函数只写在这里，命令行、DSH 工具和界面都从这里读。 */
export const importSources = {
  "chatgpt-conversations": {
    name: "ChatGPT 对话",
    extensions: [".json", ".zip"],
    onboarding: true,
    run: (ws: Workspace, path: string, o: ImportOptions) => importChatgptConversations(ws, path, o),
  },
  "apple-health": {
    name: "Apple 健康",
    extensions: [".zip", ".xml"],
    onboarding: true,
    run: (ws: Workspace, path: string, o: ImportOptions) => importAppleHealth(ws, path, o),
  },
  ics: {
    name: "日历 .ics",
    extensions: [".ics"],
    onboarding: true,
    run: (ws: Workspace, path: string, { name, ...o }: ImportOptions) =>
      importIcs(ws, path, { ...o, fallbackCalendarName: name ? basename(name, extname(name)) : undefined }),
  },
  "nut-ai": {
    name: "Nut AI",
    extensions: [".json"],
    onboarding: true,
    run: (ws: Workspace, path: string, o: ImportOptions) => importNutAi(ws, path, o),
  },
};
export type FileImportSource = keyof typeof importSources;
export const fileImportSources = Object.keys(importSources) as [FileImportSource, ...FileImportSource[]];
export type ImportSource = FileImportSource | "finance";
const EXTENSIONS: Record<ImportSource, string[]> = {
  ...(Object.fromEntries(fileImportSources.map((id) => [id, importSources[id].extensions])) as Record<
    FileImportSource,
    string[]
  >),
  finance: [".csv", ".xml", ".xls", ".xlsx"],
};
const UPLOAD = new RegExp(
  `^\\.kaitu/cache/uploads/[a-f0-9-]+\\.(${[...new Set(Object.values(EXTENSIONS).flat())].map((ext) => ext.slice(1)).join("|")})$`,
);
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
  if (!UPLOAD.test(file)) throw new KaituError("无效的上传文件", "BAD_ARGS");
}
export function importUpload(
  ws: Workspace,
  source: ImportSource,
  file: string,
  dryRun: boolean,
  originalName?: string,
) {
  assertUpload(file);
  if (!Object.hasOwn(importSources, source)) throw new KaituError("未知导入来源", "BAD_ARGS");
  return importSources[source as FileImportSource].run(ws, resolveUpload(ws, file), {
    dryRun,
    name: originalName,
  });
}
