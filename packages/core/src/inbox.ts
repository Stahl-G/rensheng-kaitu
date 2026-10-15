import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { proposeBlock, writeDigest } from "./agent-tools.js";
import { KaituError } from "./errors.js";
import { hasFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { batchSnapshot } from "./history.js";
import { type MemoryInput, importMemories } from "./memory.js";
import { assertPublicProject } from "./projects.js";
import { recordReference, recordRejectionHelp } from "./record-reference.js";
import { addRecords } from "./records.js";
import { isoInZone, localDate, localTimeToInstant } from "./time.js";
import type { Workspace } from "./workspace.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new KaituError("必须是 JSON 对象", "BAD_INBOX");
  return value as Record<string, unknown>;
}
function sourceAgent(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value
        .trim()
        .replace(/[\r\n]/g, " ")
        .slice(0, 100)
    : "云端 Agent";
}
function only(data: Record<string, unknown>, fields: string[]) {
  if (Object.keys(data).some((key) => !fields.includes(key)))
    throw new KaituError("收件箱包含不支持的字段", "BAD_INBOX");
}

async function prepare(ws: Workspace, file: string, text: string) {
  if (file.endsWith(".digest.md")) {
    if (text.startsWith("---") && !hasFrontmatter(text))
      throw new KaituError("简报 frontmatter 尚未写完", "INCOMPLETE_INBOX");
    const { data } = parseFrontmatter(text);
    const date = typeof data.date === "string" ? data.date : "";
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      throw new KaituError("简报必须有合法 date frontmatter", "BAD_INBOX");
    }
    const actor = `Agent（Drive 收件箱：${sourceAgent(data.agent)}）`;
    return {
      message: `${actor}写入了 ${date} 的动态简报`,
      apply: () => writeDigest(ws, date, text, actor, sourceAgent(data.agent)),
    };
  }
  if (file.endsWith(".records.jsonl")) {
    if (!text.endsWith("\n")) throw new KaituError("JSONL 必须以换行结束", "INCOMPLETE_INBOX");
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => object(JSON.parse(line)));
    if (!rows.length) throw new KaituError("记录文件为空", "BAD_INBOX");
    const groups = new Map<string, Record<string, unknown>[]>();
    const fileAgent = rows.find((row) => typeof row.agent === "string" && row.agent.trim())?.agent;
    for (const row of rows) {
      const { type, agent, ...data } = row;
      try {
        if (typeof type !== "string" || ["id", "by", "rev", "deleted"].some((key) => key in data)) {
          throw new KaituError("只接受新增记录，不能修改或删除", "BAD_INBOX");
        }
        const reference = recordReference(ws, type);
        const fields = [...reference.required, ...reference.optional].map((field) => field.name);
        if (fields.includes("source") && data.source === undefined) {
          const source = agent ?? fileAgent;
          data.source = typeof source === "string" && source.trim() ? source.trim() : "cloud-agent";
        }
        if (data.ts !== undefined && typeof data.ts !== "string")
          throw new KaituError("ts 必须是带时区偏移的字符串", "BAD_INBOX");
        if (data.ts === undefined && data.date !== undefined) {
          data.ts = isoInZone(localTimeToInstant(`${data.date}T12:00:00`, ws.timeZone()), ws.timeZone());
        }
        const { date: _date, ...withoutDate } = data;
        if (type === "project_metric") assertPublicProject(ws, data.project);
        const group = groups.get(type) ?? [];
        group.push(fields.includes("date") ? data : withoutDate);
        groups.set(type, group);
      } catch (error) {
        throw new KaituError(`${(error as Error).message}\n\n${recordRejectionHelp(ws, type)}`, "BAD_INBOX");
      }
    }
    for (const [type, rows] of groups) {
      try {
        addRecords(ws, type, rows, { dryRun: true });
      } catch (error) {
        throw new KaituError(`${(error as Error).message}\n\n${recordRejectionHelp(ws, type)}`, "BAD_INBOX");
      }
    }
    const agents = [...new Set(rows.map((row) => sourceAgent(row.agent)))].join("、");
    return {
      message: `Agent（Drive 收件箱：${agents}）新增了 ${rows.length} 条记录`,
      apply: async () => {
        for (const [type, rows] of groups) addRecords(ws, type, rows);
      },
    };
  }
  if (file.endsWith(".memory.json")) {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw) || !raw.length) throw new KaituError("记忆文件必须是非空候选数组", "BAD_INBOX");
    const rows = raw.map(object);
    const inputs = rows.map((row) => {
      only(row, ["type", "name", "text", "source", "sensitive", "agent"]);
      const { agent: _agent, ...input } = row;
      return input as unknown as MemoryInput;
    });
    await importMemories(ws, inputs, { dryRun: true });
    const actor = `Agent（Drive 收件箱：${[...new Set(rows.map((row) => sourceAgent(row.agent)))].join("、")}）`;
    return {
      message: `${actor}导入了 ${inputs.length} 条记忆`,
      apply: () => importMemories(ws, inputs, { actor }),
    };
  }
  if (file.endsWith(".proposal.json")) {
    const row = object(JSON.parse(text));
    only(row, ["title", "start", "end", "module", "agent"]);
    if (
      !["title", "start", "end"].every((key) => typeof row[key] === "string") ||
      (row.module !== undefined && typeof row.module !== "string")
    )
      throw new KaituError("日程建议字段不合法", "BAD_INBOX");
    const { agent, ...input } = row;
    const actor = `Agent（Drive 收件箱：${sourceAgent(agent)}）`;
    // proposeBlock 在写入前校验完整 NOW 文档。
    return {
      message: `${actor}提出了日程建议：${row.title}`,
      apply: () => proposeBlock(ws, input as unknown as Parameters<typeof proposeBlock>[1], actor),
    };
  }
  throw new KaituError("不支持的收件箱文件类型", "BAD_INBOX");
}

function stamp(ws: Workspace, file: string) {
  const stat = statSync(ws.resolve(file));
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
function archive(ws: Workspace, file: string, directory: string) {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const target = `${directory}/${name}`;
  if (ws.exists(target)) throw new KaituError(`归档文件已存在：${target}`, "CONFLICT");
  const abs = ws.resolve(target);
  mkdirSync(dirname(abs), { recursive: true });
  renameSync(ws.resolve(file), abs);
  return target;
}

export async function processInbox(ws: Workspace, options: { stableMs?: number } = {}) {
  const result = { processed: [] as string[], rejected: [] as string[], pending: [] as string[] };
  if (!ws.exists("inbox/agents")) return result;
  const lock = ws.resolve(".kaitu/cache/inbox.lock", { internal: true });
  mkdirSync(dirname(lock), { recursive: true });
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) return result;
    try {
      process.kill(pid, 0);
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return result;
      rmSync(lock, { force: true });
    }
  }
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return result;
    throw error;
  }
  try {
    writeFileSync(fd, String(process.pid));
    const observed = new Map<string, string>();
    for (const entry of readdirSync(ws.resolve("inbox/agents"), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue;
      const file = `inbox/agents/${entry.name}`;
      observed.set(file, stamp(ws, file));
    }
    if (!observed.size) return result;
    await setTimeout(options.stableMs ?? 1500);
    for (const [file, before] of observed) {
      if (!ws.exists(file)) continue;
      if (stamp(ws, file) !== before) {
        result.pending.push(file);
        continue;
      }
      try {
        const text = ws.readText(file);
        const prepared = await prepare(ws, file, text);
        if (stamp(ws, file) !== before) {
          result.pending.push(file);
          continue;
        }
        const directory = `inbox/processed/${localDate(new Date(), ws.timeZone())}`;
        const target = `${directory}/${file.split("/").at(-1)}`;
        if (ws.exists(target)) throw new KaituError(`归档文件已存在：${target}`, "CONFLICT");
        await batchSnapshot(ws, prepared.message, async () => {
          await prepared.apply();
          archive(ws, file, directory);
        });
        result.processed.push(file);
      } catch (error) {
        if (!ws.exists(file)) throw error;
        const position = /position (\d+)/.exec((error as Error).message)?.[1];
        const incompleteJson =
          error instanceof SyntaxError &&
          (/Unexpected end|Unterminated string/.test(error.message) ||
            (position !== undefined && Number(position) >= ws.readText(file).trimEnd().length));
        if ((error as KaituError).code === "INCOMPLETE_INBOX" || incompleteJson) {
          result.pending.push(file);
          continue;
        }
        if (stamp(ws, file) !== before) {
          result.pending.push(file);
          continue;
        }
        const target = archive(ws, file, "inbox/rejected");
        ws.writeText(`${target}.error.txt`, `${(error as Error).message}\n`);
        result.rejected.push(file);
      }
    }
    ws.writeJson(".kaitu/inbox-state.json", { lastProcessed: new Date().toISOString() }, { internal: true });
    return result;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
