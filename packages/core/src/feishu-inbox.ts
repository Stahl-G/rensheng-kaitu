import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { assertAgentPath } from "./agent-file-policy.js";
import { KaituError } from "./errors.js";
import { stringifyFrontmatter } from "./frontmatter.js";
import { noteMetadata } from "./inbox-notes.js";
import { isoInZone, localDate } from "./time.js";
import { type Workspace, stateDirectory } from "./workspace.js";

function revisionKey(documentId: string, revision: number) {
  return createHash("sha256")
    .update(JSON.stringify([documentId, revision]))
    .digest("hex");
}

export interface FeishuRevision {
  documentId: string;
  revision: number;
  title: string;
  url: string;
  content: string;
}

/** 外部导入入口只接受工作区内的普通目录，不能借符号链接写到其他位置。 */
function noteTarget(ws: Workspace, path: string): string {
  const target = assertAgentPath(ws.root, ws.resolve(path));
  let probe = ws.root;
  for (const part of relative(ws.root, target).split(sep)) {
    probe = join(probe, part);
    try {
      if (lstatSync(probe).isSymbolicLink())
        throw new KaituError("原文路径包含符号链接 / Note path contains a symlink", "OUT_OF_SCOPE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

/** 本机有限去重映射。原文仍使用既有 capture 格式，不改变共享数据规范。 */
export function openFeishuInbox(ws: Workspace) {
  if (!ws.exists(".kaitu/config.json"))
    throw new KaituError("请指定已有开图工作区 / Select an existing Kaitu workspace", "BAD_ARGS");
  noteTarget(ws, "inbox/notes");
  const state = join(stateDirectory(ws.root), "feishu");
  try {
    if (lstatSync(state).isSymbolicLink())
      throw new KaituError("飞书状态目录包含符号链接 / Feishu state directory is a symlink", "OUT_OF_SCOPE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(state, { recursive: true });
  const lock = join(state, "import.lock");
  const fd = openSync(lock, "wx", 0o600);
  closeSync(fd);
  try {
    const file = ".kaitu/feishu/imports.json";
    try {
      if (lstatSync(join(state, "imports.json")).isSymbolicLink())
        throw new KaituError("飞书状态映射包含符号链接 / Feishu state mapping is a symlink", "OUT_OF_SCOPE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const saved: unknown = ws.exists(file) ? ws.readJson(file) : [];
    if (!Array.isArray(saved) || saved.some((key) => typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)))
      throw new KaituError(
        "飞书本机映射无效，未继续导入 / Invalid local Feishu mapping; import stopped",
        "BAD_FEISHU_STATE",
      );
    const completed = new Set<string>(saved);
    let existingNotes: Map<string, string> | undefined;
    function collectNotes(directory: string, notes: Map<string, string>) {
      if (!ws.exists(directory)) return;
      for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) collectNotes(path, notes);
        else if (entry.isFile() && /^feishu-[a-f0-9]{64}\.md$/.test(entry.name) && !notes.has(entry.name))
          notes.set(entry.name, path);
      }
    }
    return {
      has(documentId: string, revision: number) {
        return completed.has(revisionKey(documentId, revision));
      },
      capture(doc: FeishuRevision): string | undefined {
        // 哈希只把外部身份编码成安全文件名，不是本机内容的自校验哈希。
        const key = revisionKey(doc.documentId, doc.revision);
        if (completed.has(key)) return;
        const name = `feishu-${key}.md`;
        // 仅映射缺项时恢复“已写原文但映射写失败”的窗口，包括已经归档的原文。
        // 本次导入按需枚举一次，后续新版本复用路径，不读无关正文。
        if (!existingNotes) {
          existingNotes = new Map();
          collectNotes("inbox/notes", existingNotes);
        }
        const existing = existingNotes.get(name);
        if (existing) {
          const metadata = noteMetadata(ws.readText(existing));
          if (metadata.feishu_document_id !== doc.documentId || metadata.feishu_revision_id !== doc.revision)
            throw new KaituError(
              "飞书原文文件名冲突，保留已有内容 / Feishu note collision; existing content preserved",
              "FEISHU_COLLISION",
            );
        }
        let path: string | undefined;
        if (!existing) {
          const now = new Date();
          const zone = ws.timeZone();
          const date = localDate(now, zone);
          path = `inbox/notes/${date}/${name}`;
          const target = noteTarget(ws, path);
          mkdirSync(dirname(target), { recursive: true });
          const temp = `${target}.${randomUUID()}.tmp`;
          try {
            writeFileSync(
              temp,
              stringifyFrontmatter(
                {
                  agent: "飞书 / Feishu",
                  kind: "capture",
                  date,
                  created: isoInZone(now, zone),
                  title: doc.title,
                  source: doc.url,
                  feishu_document_id: doc.documentId,
                  feishu_revision_id: doc.revision,
                },
                doc.content,
              ),
              { flag: "wx" },
            );
            // 完整落盘后以硬链接原子发布，已有文件一律 EEXIST，不留下半篇原文。
            linkSync(temp, target);
            existingNotes.set(name, path);
          } finally {
            rmSync(temp, { force: true });
          }
        }
        // 实际写入成功之后才记录成功。任何故障均向上传播，下次从原文恢复。
        ws.writeJson(file, [...completed, key], { internal: true, mode: 0o600 });
        completed.add(key);
        return path;
      },
      close() {
        unlinkSync(lock);
      },
    };
  } catch (error) {
    unlinkSync(lock);
    throw error;
  }
}
