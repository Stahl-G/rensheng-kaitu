import { isUtf8 } from "node:buffer";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { proposeBlock, writeDigest } from "./agent-tools.js";
import { KaituError } from "./errors.js";
import { hasFrontmatter, parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { batchSnapshot } from "./history.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { availableInboxPath, moveInboxFile, noteAgent, noteMetadata } from "./inbox-notes.js";
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
const sourceAgent = noteAgent;
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
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const rows = lines.map((line) => {
      try {
        return object(JSON.parse(line));
      } catch {
        return null;
      }
    });
    const errors: string[] = [];
    if (!lines.length) errors.push(`记录文件为空\n\n${recordRejectionHelp(ws, undefined)}`);
    const groups = new Map<string, Record<string, unknown>[]>();
    const fileAgent = rows.find((row) => row && typeof row.agent === "string" && row.agent.trim())?.agent;
    for (const [index, row] of rows.entries()) {
      const { type, agent, ...data } = row ?? {};
      try {
        if (!row) throw new KaituError("必须是合法 JSON 对象", "BAD_INBOX");
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
        const record = fields.includes("date") ? data : withoutDate;
        addRecords(ws, type, [record], { dryRun: true });
        const group = groups.get(type) ?? [];
        group.push(record);
        groups.set(type, group);
      } catch (error) {
        errors.push(`第 ${index + 1} 条：${(error as Error).message}\n\n${recordRejectionHelp(ws, type)}`);
      }
    }
    const agents = [...new Set(rows.map((row) => sourceAgent(row?.agent ?? fileAgent)))].join("、");
    return {
      errors,
      agent: agents,
      message: `Agent（Drive 收件箱：${agents}）新增了 ${[...groups.values()].flat().length} 条记录`,
      apply: async () => {
        for (const [type, rows] of groups) addRecords(ws, type, rows);
      },
    };
  }
  if (file.endsWith(".memory.json")) {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw) || !raw.length) throw new KaituError("记忆文件必须是非空候选数组", "BAD_INBOX");
    const inputs: MemoryInput[] = [];
    const agents: string[] = [];
    const errors: string[] = [];
    for (const [index, value] of raw.entries()) {
      try {
        const row = object(value);
        agents.push(sourceAgent(row.agent));
        only(row, ["type", "name", "text", "source", "sensitive", "agent"]);
        const { agent: _agent, ...input } = row;
        await importMemories(ws, [input as unknown as MemoryInput], { dryRun: true });
        inputs.push(input as unknown as MemoryInput);
      } catch (error) {
        errors.push(`第 ${index + 1} 条：${(error as Error).message}\n\n${INBOX_FORMATS}`);
      }
    }
    const agent = [...new Set(agents)].join("、") || sourceAgent(undefined);
    const actor = `Agent（Drive 收件箱：${agent}）`;
    return {
      errors,
      agent,
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
function saveNote(ws: Workspace, file: string, errors: string[] = [], agent?: string) {
  const bytes = readFileSync(ws.resolve(file));
  const directory = `inbox/notes/${localDate(new Date(), ws.timeZone())}`;
  if (file.endsWith(".note.md") && !errors.length && isUtf8(bytes) && !bytes.includes(0)) {
    return moveInboxFile(ws, file, directory);
  }
  const text = isUtf8(bytes) && !bytes.includes(0) ? bytes.toString("utf8") : null;
  const attachment = text === null ? moveInboxFile(ws, file, `${directory}/files`) : undefined;
  const target = availableInboxPath(ws, directory, `${basename(file)}.md`);
  ws.writeText(
    target,
    stringifyFrontmatter(
      {
        agent: sourceAgent(agent ?? (text === null ? undefined : noteMetadata(text).agent)),
        original: basename(file),
        ...(attachment ? { attachment } : {}),
      },
      [
        "# 待整理笔记",
        errors.join("\n\n"),
        text === null ? `文件：${basename(file)}\n大小：${bytes.length} 字节\n原件：${attachment}` : text,
      ].join("\n\n"),
    ),
  );
  if (text !== null) rmSync(ws.resolve(file));
  return target;
}

export async function processInbox(ws: Workspace, options: { stableMs?: number } = {}) {
  const result = { processed: [] as string[], notes: [] as string[], pending: [] as string[] };
  if (!ws.exists("inbox/agents") && !ws.exists("inbox/rejected")) return result;
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
    if (ws.exists("inbox/rejected")) {
      for (const entry of readdirSync(ws.resolve("inbox/rejected"), { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.endsWith(".error.txt")) continue;
        const file = `inbox/rejected/${entry.name}`;
        const receipt = `${file}.error.txt`;
        await batchSnapshot(ws, "Agent 迁入了旧收件箱待整理笔记", async () => {
          result.notes.push(saveNote(ws, file, ws.exists(receipt) ? [ws.readText(receipt)] : []));
          if (ws.exists(receipt)) rmSync(ws.resolve(receipt));
        });
      }
      for (const entry of readdirSync(ws.resolve("inbox/rejected"), { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        await batchSnapshot(ws, "Agent 迁入了旧收件箱待整理笔记", async () => {
          result.notes.push(saveNote(ws, `inbox/rejected/${entry.name}`));
        });
      }
      if (!readdirSync(ws.resolve("inbox/rejected")).length)
        rmSync(ws.resolve("inbox/rejected"), { recursive: true });
    }
    const observed = new Map<string, string>();
    if (ws.exists("inbox/agents")) {
      for (const entry of readdirSync(ws.resolve("inbox/agents"), { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = `inbox/agents/${entry.name}`;
        observed.set(file, stamp(ws, file));
      }
    }
    if (!observed.size) return result;
    await setTimeout(options.stableMs ?? 1500);
    for (const [file, before] of observed) {
      if (!ws.exists(file)) continue;
      if (stamp(ws, file) !== before) {
        result.pending.push(file);
        continue;
      }
      const text = ws.readText(file);
      let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
      let errors: string[] = [];
      if (!file.endsWith(".note.md")) {
        try {
          prepared = await prepare(ws, file, text);
          errors = prepared.errors ?? [];
        } catch (error) {
          errors = [`${(error as Error).message}\n\n${INBOX_FORMATS}`];
        }
      }
      if (stamp(ws, file) !== before) {
        result.pending.push(file);
        continue;
      }
      let metadata = noteMetadata(text);
      try {
        const raw = JSON.parse(text);
        metadata = Array.isArray(raw) ? (raw.find((row) => row?.agent) ?? metadata) : (raw ?? metadata);
      } catch {}
      const agent = prepared && "agent" in prepared ? prepared.agent : metadata.agent;
      await batchSnapshot(
        ws,
        () =>
          errors.length || !prepared
            ? `Agent（Drive 收件箱：${sourceAgent(agent)}）留了一条待整理笔记`
            : prepared.message,
        async () => {
          if (prepared) {
            try {
              await prepared.apply();
            } catch (error) {
              errors.push(`${(error as Error).message}\n\n${INBOX_FORMATS}`);
            }
          }
          if (errors.length || !prepared) result.notes.push(saveNote(ws, file, errors, sourceAgent(agent)));
          else {
            moveInboxFile(ws, file, `inbox/processed/${localDate(new Date(), ws.timeZone())}`);
            result.processed.push(file);
          }
        },
      );
    }
    ws.writeJson(".kaitu/inbox-state.json", { lastProcessed: new Date().toISOString() }, { internal: true });
    return result;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
