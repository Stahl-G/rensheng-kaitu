import { isUtf8 } from "node:buffer";
import {
  type Dirent,
  closeSync,
  copyFileSync,
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
import { basename, dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { proposeBlock, writeDigest } from "./agent-tools.js";
import { clockTime } from "./doc-input.js";
import { KaituError } from "./errors.js";
import { hasFrontmatter, parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { parseHealthInWorker } from "./health-import.js";
import { batchSnapshot } from "./history.js";
import { importBatch } from "./importers/batch.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { availableInboxPath, findInboxNote, moveInboxFile, noteAgent, noteMetadata } from "./inbox-notes.js";
import { type MemoryInput, importMemories, memoryInput, memoryType } from "./memory.js";
import { listRecordTypes } from "./modules.js";
import { type ExperienceInput, addExperiences } from "./places.js";
import { recordReference, recordRejectionHelp } from "./record-reference.js";
import { addRecords } from "./records.js";
import { placeholderOriginal } from "./sync-files.js";
import { isoInZone, localDate, localTimeToInstant } from "./time.js";
import type { Workspace } from "./workspace.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new KaituError("必须是 JSON 对象", "BAD_INBOX");
  return value as Record<string, unknown>;
}
const sourceAgent = noteAgent;
/** 只留认得的字段，多余的忽略，不因为多写了一个字段整条退回。 */
function only(data: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => fields.includes(key)));
}

const TYPE_ALIASES: Record<string, string> = {
  news: "news_item",
  article: "news_item",
  articles: "news_item",
  新闻: "news_item",
  资讯: "news_item",
  饮食: "meal",
  吃饭: "meal",
  food: "meal",
  训练: "workout",
  运动: "workout",
  exercise: "workout",
  睡眠: "sleep",
  todo: "task",
  todos: "task",
  待办: "task",
  心情: "mood",
};
/** 记录类型的常见写法：大小写、连字符、复数、中文 → 工作区里的类型名。 */
function recordType(ws: Workspace, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const known = new Set(listRecordTypes(ws).map((ref) => ref.type));
  if (known.has(value)) return value;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  for (const candidate of [key, TYPE_ALIASES[key], key.replace(/ies$/, "y"), key.replace(/e?s$/, "")])
    if (candidate && known.has(candidate)) return candidate;
  return value;
}

type InboxContent =
  | { kind: "records"; rows: (Record<string, unknown> | null)[] }
  | { kind: "memory"; rows: unknown[] }
  | { kind: "proposal"; row: Record<string, unknown> }
  | { kind: "note" };

/**
 * 认文件名约定的后缀；没有约定后缀的 .json / .jsonl 看内容：
 * 带 type 的对象当记录，带正文的偏好、事实等当记忆，有起止时间的当日程建议，其余收成待整理笔记。
 */
function inboxContent(file: string, text: string): InboxContent {
  const parseLines = () =>
    text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        try {
          const value = JSON.parse(line);
          return value && typeof value === "object" && !Array.isArray(value) ? value : null;
        } catch {
          return null;
        }
      });
  if (file.endsWith(".jsonl")) return { kind: "records", rows: parseLines() };
  if (!file.endsWith(".json") || file.endsWith(".health.json")) return { kind: "note" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // 也可能是没改后缀的 JSONL。
    const rows = parseLines();
    return rows.length > 1 && rows.every(Boolean) ? { kind: "records", rows } : { kind: "note" };
  }
  const object =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (file.endsWith(".memory.json") || Array.isArray(object?.memories))
    return {
      kind: "memory",
      rows: Array.isArray(value) ? value : Array.isArray(object?.memories) ? object.memories : [value],
    };
  if (file.endsWith(".proposal.json")) return { kind: "proposal", row: object ?? {} };
  const list = Array.isArray(value) ? value : Array.isArray(object?.records) ? object.records : [value];
  const rows = list.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row),
  );
  if (!rows.length || rows.length !== list.length) return { kind: "note" };
  if (rows.every((row) => memoryType(row.type) && (row.text ?? row.content))) return { kind: "memory", rows };
  // 有标题和起止时间、没写类型或写明是日程建议的，按日程建议收，不当成记录类型去查。
  if (
    object?.title &&
    object.start &&
    object.end &&
    (object.type === undefined || /^(proposal|suggestion|日程建议|建议)$/i.test(String(object.type)))
  )
    return { kind: "proposal", row: object };
  if (rows.every((row) => typeof row.type === "string")) return { kind: "records", rows };
  return { kind: "note" };
}

async function prepare(ws: Workspace, file: string, text: string) {
  if (file.endsWith(".digest.md")) {
    if (text.startsWith("---") && !hasFrontmatter(text))
      throw new KaituError("简报 frontmatter 尚未写完", "INCOMPLETE_INBOX");
    const { data } = parseFrontmatter(text);
    const valid = (value: unknown) =>
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    // 没写日期时取文件名里的日期，再没有就是今天；写了却读不出时转待整理，不归到别的日子。
    const given =
      data.date === undefined || data.date === null || data.date === ""
        ? undefined
        : String(data.date)
            .trim()
            .replace(
              /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/,
              (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
            );
    if (given !== undefined && !valid(given))
      throw new KaituError(`简报的 date 读不出：${String(data.date)}，请写成 YYYY-MM-DD`, "BAD_INBOX");
    const named = /(\d{4}-\d{2}-\d{2})/.exec(basename(file))?.[1];
    const date = given ?? (valid(named) ? (named as string) : localDate(new Date(), ws.timeZone()));
    const actor = `Agent（Drive 收件箱：${sourceAgent(data.agent)}）`;
    return {
      message: `${actor}写入了 ${date} 的动态简报`,
      apply: () => writeDigest(ws, date, text, actor, sourceAgent(data.agent)),
    };
  }
  const content = inboxContent(file, text);
  if (content.kind === "records") {
    const rows = content.rows;
    const errors: string[] = [];
    if (!rows.length) errors.push(`记录文件为空\n\n${recordRejectionHelp(ws, undefined)}`);
    const groups = new Map<string, Record<string, unknown>[]>();
    const fileAgent = rows.find((row) => row && typeof row.agent === "string" && row.agent.trim())?.agent;
    for (const [index, row] of rows.entries()) {
      const { type: rawType, agent, id: _id, by: _by, rev: _rev, ...data } = row ?? {};
      const type = recordType(ws, rawType);
      try {
        if (!row) throw new KaituError("必须是合法 JSON 对象", "BAD_INBOX");
        if (typeof type !== "string") throw new KaituError("缺少 type（记录类型）", "BAD_INBOX");
        // 收件箱只新增：带了 id、by、rev 就当新记录收下，删除标记不接受。
        if ("deleted" in data) throw new KaituError("收件箱只新增记录，不能删除", "BAD_INBOX");
        if (typeof data.ts === "number" && Number.isFinite(data.ts))
          data.ts = isoInZone(new Date(data.ts > 1e12 ? data.ts : data.ts * 1000), ws.timeZone());
        const reference = recordReference(ws, type);
        const fields = [...reference.required, ...reference.optional].map((field) => field.name);
        const news = type === "news_item" || type === "trend";
        // 新闻的 source 是发布方，不是 Agent；没写时由开图按网址补。via 没写就记成交来的 Agent。
        if (fields.includes("source") && data.source === undefined && !news) {
          const source = agent ?? fileAgent;
          data.source = typeof source === "string" && source.trim() ? source.trim() : "cloud-agent";
        }
        if (news && data.via === undefined) data.via = agent ?? fileAgent ?? "agent";
        if (data.ts !== undefined && typeof data.ts !== "string")
          throw new KaituError("ts 必须是带时区偏移的字符串", "BAD_INBOX");
        if (data.ts === undefined && data.date !== undefined) {
          data.ts = isoInZone(localTimeToInstant(`${data.date}T12:00:00`, ws.timeZone()), ws.timeZone());
        }
        const { date: _date, ...withoutDate } = data;
        const record = fields.includes("date") ? data : withoutDate;
        if (["experience_source", "experience_batch"].includes(type))
          throw new KaituError("收件箱只提交经历，来源与批次由开图管理", "BAD_INBOX");
        if (type === "experience")
          await addExperiences(ws, [record as unknown as ExperienceInput], "agent", { dryRun: true });
        else addRecords(ws, type, [record], { dryRun: true });
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
        for (const [type, rows] of groups) {
          if (type === "experience") await addExperiences(ws, rows as unknown as ExperienceInput[], "agent");
          else addRecords(ws, type, rows);
        }
      },
    };
  }
  if (content.kind === "memory") {
    const raw = content.rows;
    if (!raw.length) throw new KaituError("记忆文件是空的", "BAD_INBOX");
    const inputs: MemoryInput[] = [];
    const agents: string[] = [];
    const errors: string[] = [];
    for (const [index, value] of raw.entries()) {
      try {
        const row = object(value);
        agents.push(sourceAgent(row.agent));
        const input = memoryInput(row);
        await importMemories(ws, [input], { dryRun: true });
        inputs.push(input);
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
  if (content.kind === "proposal") {
    const raw = content.row;
    const row = only(
      {
        ...raw,
        title: raw.title ?? raw.name,
        start: clockTime(raw.start) ?? raw.start,
        end: clockTime(raw.end) ?? raw.end,
      },
      ["title", "start", "end", "module", "agent"],
    );
    if (
      !["title", "start", "end"].every((key) => typeof row[key] === "string") ||
      (row.module !== undefined && typeof row.module !== "string")
    )
      throw new KaituError("日程建议需要 title、start、end（如 18:00）", "BAD_INBOX");
    const { agent, ...input } = row;
    const actor = `Agent（Drive 收件箱：${sourceAgent(agent)}）`;
    // proposeBlock 在写入前校验完整 NOW 文档。
    return {
      message: `${actor}提出了日程建议：${row.title}`,
      apply: () => proposeBlock(ws, input as unknown as Parameters<typeof proposeBlock>[1], actor),
    };
  }
  // 其余文字（.md、.txt、读不出结构的 JSON）当待整理笔记收下，不算出错。
  return undefined;
}

function stamp(ws: Workspace, file: string) {
  const stat = statSync(ws.resolve(file));
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
function saveNote(ws: Workspace, file: string, errors: string[] = [], agent?: string, attach = false) {
  const size = statSync(ws.resolve(file)).size;
  const bytes = attach ? Buffer.alloc(0) : ws.readBytes(file);
  const directory = `inbox/notes/${localDate(new Date(), ws.timeZone())}`;
  // .md 笔记原样收下（.note.md 是旧写法，也认）；简报读不出时才包成待整理笔记。
  if (
    file.endsWith(".md") &&
    !file.endsWith(".digest.md") &&
    !errors.length &&
    isUtf8(bytes) &&
    !bytes.includes(0)
  ) {
    if (/^channel-[a-f0-9]{64}\.note\.md$/.test(basename(file))) {
      const existing = findInboxNote(ws, basename(file));
      if (existing) {
        rmSync(ws.resolve(file));
        return existing;
      }
      const date = noteMetadata(bytes.toString("utf8")).date;
      if (
        typeof date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date
      ) {
        const target = `inbox/notes/${date}/${basename(file)}`;
        mkdirSync(dirname(ws.resolve(target)), { recursive: true });
        renameSync(ws.resolve(file), ws.resolve(target));
        return target;
      }
    }
    return moveInboxFile(ws, file, directory);
  }
  const text = !attach && isUtf8(bytes) && !bytes.includes(0) ? bytes.toString("utf8") : null;
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
        text === null ? `文件：${basename(file)}\n大小：${size} 字节\n原件：${attachment}` : text,
      ].join("\n\n"),
    ),
  );
  if (text !== null) rmSync(ws.resolve(file));
  return target;
}

/// 外部健康收件箱来源（.kaitu/config.json 的 health_inbox_external，绝对路径数组）。
/// KaituSync 的「iCloud Drive 文件夹」收件方式写入的位置；文件拉入工作区后原件移除。
export function externalHealthPaths(ws: Workspace): string[] {
  try {
    const config = ws.readJson(".kaitu/config.json") as { health_inbox_external?: unknown };
    const list = Array.isArray(config.health_inbox_external) ? config.health_inbox_external : [];
    return list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

function pullExternalHealthInbox(ws: Workspace) {
  for (const dir of externalHealthPaths(ws)) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".health.json")) continue;
      const source = join(dir, entry.name);
      try {
        JSON.parse(readFileSync(source, "utf8"));
        mkdirSync(ws.resolve("inbox/health"), { recursive: true });
        const target = ws.resolve(`inbox/health/${entry.name}`);
        if (!existsSync(target)) copyFileSync(source, target);
        rmSync(source);
      } catch {
        // 同步盘可能仍在写入或下载未完成，留待下一轮
      }
    }
  }
}

export async function processInbox(ws: Workspace, options: { stableMs?: number } = {}) {
  const result = { processed: [] as string[], notes: [] as string[], pending: [] as string[] };
  pullExternalHealthInbox(ws);
  if (!["inbox/agents", "inbox/health", "inbox/rejected"].some((dir) => ws.exists(dir))) return result;
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
    const unavailable = ws.unavailableFiles("inbox");
    const observed = new Map<string, string>();
    for (const dir of ["inbox/agents", "inbox/health"]) {
      if (!ws.exists(dir)) continue;
      for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.endsWith(".tmp") || entry.name === ".DS_Store") continue;
        const file = `${dir}/${entry.name}`;
        if (ws.conflictCopy(file) || placeholderOriginal(file)) continue;
        if (unavailable.some((path) => file === path || file.startsWith(`${path}/`))) {
          result.pending.push(file);
          continue;
        }
        if (file.startsWith("inbox/agents/") && ws.scanText(file) === undefined) continue;
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
      if (file.startsWith("inbox/health/")) {
        if (ws.isUnavailable(file)) {
          result.pending.push(file);
          continue;
        }
        let parsed: Awaited<ReturnType<typeof parseHealthInWorker>> | undefined;
        // 快捷指令导出的任何 .json，以及任何名字的 Apple 健康 .zip / .xml。
        const shortcut = /\.json$/i.test(file);
        const errors: string[] = [];
        try {
          parsed =
            shortcut || /\.(zip|xml)$/i.test(file)
              ? await parseHealthInWorker(ws.resolve(file), ws.timeZone(), shortcut)
              : undefined;
          if (!parsed)
            throw new KaituError(
              "健康收件箱接受 Apple 健康导出的 .zip / .xml，或快捷指令的 .json",
              "BAD_INBOX",
            );
        } catch (error) {
          errors.push((error as Error).message);
        }
        if (!ws.exists(file) || stamp(ws, file) !== before) {
          result.pending.push(file);
          continue;
        }
        let count = 0;
        await batchSnapshot(
          ws,
          () =>
            errors.length
              ? "Apple 健康文件转为待整理笔记"
              : `从 Apple 健康同步了 ${count} 条记录${shortcut ? "（快捷指令）" : ""}`,
          async () => {
            if (parsed) {
              try {
                const imported = await importBatch(ws, "apple-health", parsed.candidates, {
                  ignored: parsed.ignored,
                  skipInvalid: shortcut,
                });
                count = imported.added + imported.updated;
              } catch (error) {
                errors.push((error as Error).message);
              }
            }
            if (errors.length) result.notes.push(saveNote(ws, file, errors, "Apple 健康", true));
            else {
              moveInboxFile(ws, file, `inbox/processed/${localDate(new Date(), ws.timeZone())}`);
              result.processed.push(file);
            }
          },
        );
        continue;
      }
      const text = ws.readText(file);
      let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
      let errors: string[] = [];
      if (!file.endsWith(".md") || file.endsWith(".digest.md")) {
        try {
          prepared = await prepare(ws, file, text);
          errors = prepared?.errors ?? [];
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
