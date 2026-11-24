import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stringifyFrontmatter } from "../frontmatter.js";
import { type Relay, appendFile, directory, hash, incoming, missing, plainFile } from "./files.js";

const replyName = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.(?:md|txt)$/;
const end = "【交接结束】";
const replyLimit = 96 * 1024;

// The core importer preserves channel note names when moving them into a dated
// live or archive folder. Index names once per pull without opening other notes.
function receivedNotes(relay: Relay) {
  const notes = new Map<string, string>();
  const base = join(relay.ws.root, "inbox", "notes");
  if (!lstatSync(base, { throwIfNoEntry: false })) return notes;
  directory(relay.ws.root, ["inbox", "notes"]);
  for (const area of ["inbox/notes", "inbox/notes/done"]) {
    const root = join(relay.ws.root, area);
    if (!lstatSync(root, { throwIfNoEntry: false })) continue;
    directory(relay.ws.root, area.split("/"));
    for (const day of readdirSync(root, { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      for (const entry of readdirSync(join(root, day.name), { withFileTypes: true })) {
        if (entry.isFile() && /^channel-[a-f0-9]{64}\.note\.md$/.test(entry.name))
          notes.set(entry.name, `${area}/${day.name}/${entry.name}`);
      }
    }
  }
  return notes;
}

function deliver(relay: Relay, dir: string, name: string, date: string, notes: Map<string, string>) {
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error("文件名日期无效");
  const text = plainFile(join(dir, name), replyLimit)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const lines = text.trimEnd().split("\n");
  if (lines.pop()?.trim() !== end || !lines.join("\n").trim())
    throw new Error("等待完整回件：正文与末行【交接结束】");
  // Quote the payload, including any frontmatter, links or JSON it contains. The transport
  // identifies the inbox, not the human or model that actually wrote the text.
  const content = stringifyFrontmatter(
    { agent: "百度网盘接力", date, source: `百度网盘/${incoming}/${name}` },
    [
      "",
      "待核对的接力结果",
      `来源：百度网盘/${incoming}/${name}`,
      "",
      ...lines.map((line) => `    ${line}`),
      "",
    ].join("\n"),
  );
  const local = `channel-${hash(`baidu-netdisk\0${name}`)}.note.md`;
  const ws = relay.ws;
  const queue = directory(ws.root, ["inbox", "agents"], true);
  // Scope the search to Kaitu's notes. Its importer retains this filename when the user
  // archives a note. A changed delivery with the same identity must not replace it.
  const previous = notes.get(local);
  if (previous) {
    directory(ws.root, dirname(previous).split(/[\\/]/));
    if (plainFile(join(ws.root, previous), Buffer.byteLength(content) + replyLimit, queue) !== content)
      throw new Error("同名回件已收过且正文不同，请用新编号追加");
    return false;
  }
  return appendFile(join(queue, local), content);
}

export function pullReplies(relay: Relay) {
  if (plainFile(relay.markerFile, 512, relay.sync) !== relay.markerText)
    throw new Error("请先向此目录发布已核对的项目");
  const dir = directory(relay.sync, [incoming]);
  const report = {
    queued: 0,
    alreadyReceived: 0,
    ignored: 0,
    issues: [] as { file: string; reason: string }[],
  };
  let notes: Map<string, string> | undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const match = replyName.exec(entry.name);
    if (entry.name.length > 110 || !match?.[1]) {
      report.ignored++;
      continue;
    }
    try {
      if (!entry.isFile()) throw new Error("只收独立文本文件");
      notes ??= receivedNotes(relay);
      if (deliver(relay, dir, entry.name, match[1], notes)) report.queued++;
      else report.alreadyReceived++;
    } catch (error) {
      report.issues.push({
        file: basename(entry.name),
        reason: missing(error) ? "文件正在移动，请重试" : (error as Error).message,
      });
    }
  }
  return report;
}
