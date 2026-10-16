import { readFileSync, readdirSync, rmSync } from "node:fs";
import { unzipSync } from "fflate";
import { updateChatIndex } from "./chat-search.js";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { schemas } from "./schema.js";
import { isoInZone } from "./time.js";
import type { Workspace } from "./workspace.js";

export interface ChatHeader {
  type: "chat";
  id: string;
  title: string;
  source: string;
  created: string;
  updated: string;
}

export interface ChatMessage {
  type: "message";
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  ts: string | null;
  text: string;
}

export interface ChatDocument {
  file: string;
  header: ChatHeader;
  messages: ChatMessage[];
}

export interface ImportEntry {
  id: string;
  title: string;
  action: "added" | "updated" | "skipped";
  file: string;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  entries: ImportEntry[];
  version: string | null;
}

function invalid(): never {
  throw new KaituError("ChatGPT 对话导出格式不合法", "INVALID_IMPORT");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function chatPath(ws: Workspace, file: string): string {
  if (!/^chats\/.+\.jsonl$/.test(file) || file.split("/").some((p) => p === "." || p === "..")) {
    throw new KaituError("只接受 chats/ 下的对话文件", "OUT_OF_SCOPE");
  }
  return ws.resolve(file);
}

export function listChatFiles(ws: Workspace): string[] {
  const files: string[] = [];
  function visit(dir: string): void {
    const abs = ws.resolve(dir);
    if (!ws.exists(dir)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        chatPath(ws, file);
        if (ws.scanText(file) !== undefined) files.push(file);
      }
    }
  }
  visit("chats");
  return files.sort();
}

export function readChat(ws: Workspace, file: string): ChatDocument {
  chatPath(ws, file);
  const validate = schemas().builtin("chat.schema.json");
  const lines = ws
    .readText(file)
    .split("\n")
    .filter((line) => line.trim());
  const rows = lines.map((line, i): ChatHeader | ChatMessage => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new KaituError(`${file}:${i + 1} 不是合法 JSON`, "CORRUPT");
    }
    if (!validate(value)) throw new KaituError(`${file}:${i + 1} 对话数据不合法`, "CORRUPT");
    return value as ChatHeader | ChatMessage;
  });
  const header = rows[0];
  if (!header || header.type !== "chat" || rows.slice(1).some((row) => row.type !== "message")) {
    throw new KaituError(`${file} 对话行顺序不合法`, "CORRUPT");
  }
  return { file, header, messages: rows.slice(1) as ChatMessage[] };
}

function unixTime(value: unknown, zone: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  // 保留毫秒：ChatGPT 的 update_time 是浮点秒，同一秒内的更新也要能区分
  const date = new Date(Math.round(value * 1000));
  const iso = isoInZone(date, zone);
  const ms = date.getUTCMilliseconds();
  return ms ? `${iso.slice(0, 19)}.${String(ms).padStart(3, "0")}${iso.slice(19)}` : iso;
}

function contentText(value: unknown): string {
  const content = object(value);
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        const item = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
        const kind = String(item.content_type ?? "");
        return kind.includes("image") || "asset_pointer" in item ? "[图片]" : "[附件]";
      })
      .join("\n");
  }
  return typeof content.text === "string" ? content.text : "";
}

function parseConversation(value: unknown, zone: string): ChatDocument {
  const source = object(value);
  const id = source.id ?? source.conversation_id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) invalid();
  if (typeof source.title !== "string") invalid();
  const created = unixTime(source.create_time, zone);
  const updated = unixTime(source.update_time ?? source.create_time, zone);
  const mapping = object(source.mapping);
  let cursor = source.current_node;
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  while (cursor !== null && cursor !== undefined) {
    if (typeof cursor !== "string" || seen.has(cursor) || !Object.hasOwn(mapping, cursor)) invalid();
    seen.add(cursor);
    const node = object(mapping[cursor]);
    if (node.message !== null && node.message !== undefined) {
      const message = object(node.message);
      const author = object(message.author);
      const role = author.role;
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") invalid();
      const text = contentText(message.content);
      if (role !== "system" || text.trim()) {
        const messageId = message.id ?? node.id ?? cursor;
        if (typeof messageId !== "string" || !messageId) invalid();
        messages.push({
          type: "message",
          id: messageId,
          role,
          ts: message.create_time == null ? null : unixTime(message.create_time, zone),
          text,
        });
      }
    }
    cursor = node.parent;
  }
  if (typeof source.current_node !== "string") invalid();
  const file = `chats/${created.slice(0, 4)}/${created.slice(5, 7)}/${id}.jsonl`;
  const header: ChatHeader = { type: "chat", id, title: source.title, source: "chatgpt", created, updated };
  const document = { file, header, messages: messages.reverse() };
  const validate = schemas().builtin("chat.schema.json");
  if (![header, ...document.messages].every((row) => validate(row))) invalid();
  return document;
}

function loadExport(file: string): unknown[] {
  let value: unknown;
  try {
    const bytes = readFileSync(file);
    let json: string;
    if (file.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const entries = unzipSync(bytes, { filter: (entry) => /(^|\/)conversations\.json$/.test(entry.name) });
      const names = Object.keys(entries);
      if (names.length !== 1) invalid();
      json = new TextDecoder("utf-8", { fatal: true }).decode(entries[names[0] as string]);
    } else {
      json = bytes.toString("utf8");
    }
    value = JSON.parse(json);
  } catch {
    throw new KaituError("无法读取 ChatGPT 对话导出文件", "INVALID_IMPORT");
  }
  if (!Array.isArray(value)) invalid();
  return value;
}

export async function importChatgptConversations(
  ws: Workspace,
  inputFile: string,
  opts: { dryRun?: boolean } = {},
): Promise<ImportResult> {
  if (!opts.dryRun) ws.assertDownloaded("chats");
  const documents = loadExport(inputFile).map((value) => parseConversation(value, ws.timeZone()));
  const existing = new Map(
    listChatFiles(ws).map((file) => {
      const document = readChat(ws, file);
      return [document.header.id, document] as const;
    }),
  );
  const seen = new Set<string>();
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, entries: [], version: null };
  const changed: ChatDocument[] = [];
  for (const document of documents) {
    const { id, title, updated } = document.header;
    if (seen.has(id)) invalid();
    seen.add(id);
    chatPath(ws, document.file);
    const previous = existing.get(id);
    const action = !previous
      ? "added"
      : Date.parse(previous.header.updated) === Date.parse(updated)
        ? "skipped"
        : "updated";
    result[action]++;
    result.entries.push({
      id,
      title,
      action,
      file: action === "skipped" && previous ? previous.file : document.file,
    });
    if (action !== "skipped") changed.push(document);
  }
  if (opts.dryRun || changed.length === 0) return result;
  for (const document of changed) {
    const previous = existing.get(document.header.id);
    ws.writeText(
      document.file,
      `${[document.header, ...document.messages].map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
    if (previous && previous.file !== document.file) rmSync(chatPath(ws, previous.file));
  }
  result.version = await snapshot(ws, `导入（chatgpt）了 ${changed.length} 段对话`);
  updateChatIndex(ws, changed);
  return result;
}
