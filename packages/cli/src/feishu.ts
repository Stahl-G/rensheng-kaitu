import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { KaituError, Workspace, openFeishuInbox } from "@kaitu/core";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new KaituError("飞书响应缺少对象 / Invalid Feishu response object", "FEISHU_PROTOCOL");
  return value as ObjectValue;
}
function token(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new KaituError("飞书 token 无效 / Invalid Feishu token", "FEISHU_PROTOCOL");
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new KaituError("飞书 revision 无效 / Invalid Feishu revision", "FEISHU_PROTOCOL");
  return value;
}

export interface FeishuImportOptions {
  root: string;
  folder: string;
  cli: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  progress?: (requests: number) => void;
}

/** 手动、串行，只接受明确的可执行文件与 folder，不发现账号或目录。 */
export async function importFeishuFolder(options: FeishuImportOptions) {
  const report = {
    requests: 0,
    versionChecks: 0,
    listed: 0,
    documents: 0,
    imported: 0,
    unchanged: 0,
    paths: [] as string[],
  };
  let cwd: string | undefined;
  let inbox: ReturnType<typeof openFeishuInbox> | undefined;
  let nextStart = 0;
  const signal = options.signal;
  const timeout = options.timeoutMs ?? 30000;
  function checkCancel() {
    signal?.throwIfAborted();
  }
  async function call(args: string[], versionCheck = false): Promise<string> {
    checkCancel();
    await delay(Math.max(0, nextStart - performance.now()), undefined, { signal });
    checkCancel();
    if (versionCheck) report.versionChecks++;
    else report.requests++;
    options.progress?.(report.requests);
    return new Promise<string>((resolve, reject) => {
      execFile(
        options.cli,
        args,
        {
          cwd,
          shell: false,
          timeout,
          signal,
          killSignal: "SIGKILL",
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
          env: {
            ...process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          // 不转发正文、凭据或 hint，不执行任何恢复命令，也不重试。
          let detail = "";
          try {
            const problem = object(object(JSON.parse(stderr)).error);
            detail = [problem.type, problem.subtype, problem.code]
              .filter((value) => typeof value === "string" || typeof value === "number")
              .join("/");
          } catch {
            /* 非 JSON stderr 只报告进程状态。 */
          }
          const reason = signal?.aborted
            ? "cancelled"
            : error.killed
              ? "timeout/output limit"
              : String(error.code);
          reject(new KaituError(`飞书读取停止 / Feishu read stopped: ${detail || reason}`, "FEISHU_CLI"));
        },
      );
    }).finally(() => {
      nextStart = performance.now() + 210;
    });
  }
  async function read(args: string[]): Promise<ObjectValue> {
    const stdout = await call(args);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new KaituError("飞书未返回单个 JSON / Expected a single JSON response", "FEISHU_PROTOCOL");
    }
    const result = object(parsed);
    if (result.ok !== true) throw new KaituError("飞书读取未成功 / Feishu ok is not true", "FEISHU_PROTOCOL");
    return object(result.data);
  }
  try {
    token(options.folder);
    if (!isAbsolute(options.root) || !isAbsolute(options.cli) || !Number.isFinite(timeout) || timeout <= 0)
      throw new KaituError(
        "需明确绝对工作区/CLI 路径和有效超时 / Explicit absolute paths and timeout required",
        "BAD_ARGS",
      );
    checkCancel();
    const ws = new Workspace(options.root, { maintain: false });
    inbox = openFeishuInbox(ws);
    cwd = mkdtempSync(join(tmpdir(), "kaitu-feishu-"));
    if ((await call(["--version"], true)).trim() !== "lark-cli version 1.0.98")
      throw new KaituError("仅支持 lark-cli 1.0.98 / Requires lark-cli 1.0.98", "FEISHU_VERSION");
    const docs = new Map<string, { title: string; url: string }>();
    const pages = new Set<string>();
    let page: string | undefined;
    do {
      const data = await read([
        "drive",
        "files",
        "list",
        "--params",
        JSON.stringify({
          folder_token: options.folder,
          page_size: 200,
          ...(page ? { page_token: page } : {}),
        }),
        "--as",
        "user",
        "--format",
        "json",
      ]);
      if (!Array.isArray(data.files) || typeof data.has_more !== "boolean")
        throw new KaituError("飞书分页字段缺失 / Missing Feishu pagination fields", "FEISHU_PROTOCOL");
      for (const raw of data.files) {
        const file = object(raw);
        if (typeof file.type !== "string")
          throw new KaituError("缺少文件类型 / Missing file type", "FEISHU_PROTOCOL");
        report.listed++;
        if (file.type !== "docx") continue;
        const id = token(file.token);
        if (typeof file.name !== "string" || typeof file.url !== "string")
          throw new KaituError("飞书文档字段缺失 / Missing Feishu document fields", "FEISHU_PROTOCOL");
        const url = new URL(file.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== `/docx/${id}` ||
          !(
            url.hostname === "feishu.cn" ||
            url.hostname.endsWith(".feishu.cn") ||
            url.hostname === "larksuite.com" ||
            url.hostname.endsWith(".larksuite.com")
          )
        )
          throw new KaituError("飞书来源链接无效 / Invalid Feishu source link", "FEISHU_PROTOCOL");
        docs.set(id, { title: file.name, url: file.url });
      }
      if (!data.has_more) break;
      if (
        typeof data.next_page_token !== "string" ||
        !data.next_page_token ||
        pages.has(data.next_page_token)
      )
        throw new KaituError("飞书分页无法继续 / Invalid Feishu continuation", "FEISHU_PROTOCOL");
      page = data.next_page_token;
      pages.add(page);
    } while (page);
    report.documents = docs.size;
    for (const [id, doc] of docs) {
      const metadata = object(
        (
          await read([
            "api",
            "GET",
            `/open-apis/docx/v1/documents/${encodeURIComponent(id)}`,
            "--as",
            "user",
            "--format",
            "json",
          ])
        ).document,
      );
      if (metadata.document_id !== id)
        throw new KaituError("飞书文档 ID 不匹配 / Document ID mismatch", "FEISHU_PROTOCOL");
      const rev = revision(metadata.revision_id);
      if (inbox.has(id, rev)) {
        report.unchanged++;
        continue;
      }
      const fetched = object(
        (
          await read([
            "docs",
            "+fetch",
            "--doc",
            id,
            "--doc-format",
            "markdown",
            "--as",
            "user",
            "--format",
            "json",
            "--revision-id",
            String(rev),
          ])
        ).document,
      );
      if (
        fetched.document_id !== id ||
        revision(fetched.revision_id) !== rev ||
        typeof fetched.content !== "string"
      )
        throw new KaituError(
          "飞书正文 ID/版本/内容不匹配 / Fetch identity, revision or content mismatch",
          "FEISHU_PROTOCOL",
        );
      checkCancel();
      const path = inbox.capture({ documentId: id, revision: rev, ...doc, content: fetched.content });
      if (path) {
        report.imported++;
        report.paths.push(path);
      } else report.unchanged++;
    }
    return report;
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { report });
  } finally {
    try {
      inbox?.close();
    } finally {
      if (cwd) rmSync(cwd, { recursive: true, force: true });
    }
  }
}
