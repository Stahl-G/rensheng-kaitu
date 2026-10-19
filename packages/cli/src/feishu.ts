import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KaituError, type Workspace, captureNote } from "@kaitu/core";

const run = promisify(execFile);
// 飞书文档和修改时间的对应只记在本机，原文仍是普通的待整理笔记。
const seenFile = ".kaitu/feishu.json";

interface FeishuFile {
  token: string;
  name: string;
  type: string;
  url: string;
  modified_time: string;
}

async function lark<T>(cli: string, args: string[]): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await run(cli, [...args, "--as", "user", "--format", "json"], {
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    const { code, stderr } = error as { code?: string; stderr?: string };
    throw new KaituError(
      code === "ENOENT"
        ? "没有找到 lark-cli，请先安装并登录飞书"
        : stderr?.includes('"authentication"')
          ? "飞书登录已过期，请运行 lark-cli auth login"
          : `飞书读取失败：${stderr?.trim() || (error as Error).message}`,
      "FEISHU",
    );
  }
  const result = JSON.parse(stdout) as { ok: boolean; data: T };
  if (!result.ok) throw new KaituError(`飞书读取失败：${stdout.trim()}`, "FEISHU");
  return result.data;
}

/** 把飞书文件夹里的云文档存成原文；没改过的跳过，改过的再存一条。 */
export async function importFeishuFolder(ws: Workspace, folder: string, cli = "lark-cli") {
  const docs: FeishuFile[] = [];
  let page: string | undefined;
  do {
    const data = await lark<{ files: FeishuFile[]; has_more: boolean; next_page_token?: string }>(cli, [
      "drive",
      "files",
      "list",
      "--params",
      JSON.stringify({ folder_token: folder, page_size: 200, ...(page ? { page_token: page } : {}) }),
    ]);
    docs.push(...data.files.filter((file) => file.type === "docx"));
    page = data.has_more ? data.next_page_token : undefined;
  } while (page);
  const seen: Record<string, string> = ws.exists(seenFile) ? ws.readJson(seenFile) : {};
  const imported: string[] = [];
  const skipped: { title: string; reason: string }[] = [];
  for (const doc of docs) {
    if (seen[doc.token] === doc.modified_time) continue;
    const { document } = await lark<{ document: { content: string } }>(cli, [
      "docs",
      "+fetch",
      `--doc=${doc.token}`,
      "--doc-format",
      "markdown",
    ]);
    try {
      const { path } = await captureNote(ws, `# ${doc.name}\n\n${doc.url}\n\n${document.content.trim()}`);
      imported.push(path);
    } catch (error) {
      skipped.push({ title: doc.name, reason: (error as Error).message });
      continue;
    }
    seen[doc.token] = doc.modified_time;
    ws.writeJson(seenFile, seen, { internal: true });
  }
  return {
    documents: docs.length,
    imported,
    unchanged: docs.length - imported.length - skipped.length,
    skipped,
  };
}
