import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openRelay } from "../src/baidu-netdisk/files.js";
import { previewSnapshot, publishSnapshot } from "../src/baidu-netdisk/snapshot.js";
import { stringifyFrontmatter } from "../src/frontmatter.js";
import { inboxNoteDone, inboxNotes } from "../src/inbox-notes.js";
import { processInbox } from "../src/inbox.js";
import { clonedWorkspace, tmp } from "./helpers.js";

const status = "projects/lantern/STATUS.md";
const secret = `sk-test-${"a".repeat(24)}`;
function project(title = "纸灯") {
  return stringifyFrontmatter(
    {
      title,
      updated: "2026-01-04T12:00:00Z",
      next: [
        { id: "step", title: `凝固后测量 /Users/example/private ${secret}`, status: "todo" },
        {
          id: "done",
          title: "第一次测量",
          status: "done",
          result: "宽度为十厘米",
          completed: "2026-01-02T12:00:00Z",
        },
        { id: "private", title: "隐藏的约定", status: "todo", sensitive: true },
      ],
    },
    "仅存在于项目正文",
  );
}

it("发布只允许已核对的字段、格式、目的地和工作区，按需取单个项目日志", async () => {
  const ws = await clonedWorkspace();
  ws.writeText(status, project());
  ws.writeText("projects/lantern/log.md", "## 2026-01-04\n已验证灯罩\n");
  ws.writeText("projects/other/STATUS.md", project("其他项目原文"));
  const sync = tmp();
  const relay = openRelay(ws.root, sync);
  const preview = previewSnapshot(relay, "lantern", "md");
  expect(readdirSync(sync)).toEqual([]);
  for (const forbidden of [
    secret,
    "/Users/example",
    "仅存在于项目正文",
    "隐藏的约定",
    "已验证灯罩",
    "其他项目原文",
  ])
    expect(preview.body).not.toContain(forbidden);
  expect(preview.body).toContain("2026-01-02 · 宽度为十厘米");
  expect(preview.body).toContain(status);
  ws.writeText(status, project("变更后的纸灯"));
  expect(() => publishSnapshot(relay, "lantern", "md", false, preview.approval)).toThrow();
  ws.writeText(status, project());
  expect(() => publishSnapshot(relay, "lantern", "txt", false, preview.approval)).toThrow();
  expect(() =>
    publishSnapshot(openRelay(ws.root, tmp()), "lantern", "md", false, preview.approval),
  ).toThrow();
  expect(readdirSync(sync)).toEqual([]);
  const published = publishSnapshot(relay, "lantern", "md", false, preview.approval);
  expect(published).toMatchObject({ local: "created", cloud: "unverified" });
  expect(readFileSync(join(sync, published.file), "utf8")).toBe(preview.body);
  expect(publishSnapshot(relay, "lantern", "md", false, preview.approval).local).toBe("already_present");
  const plain = previewSnapshot(relay, "lantern", "txt", true);
  const second = publishSnapshot(relay, "lantern", "txt", true, plain.approval);
  expect(second.file).toMatch(/\.txt$/);
  expect(plain.body).toContain("2026-01-04 · 已验证灯罩");
  expect(() => openRelay(ws.root, join(ws.root, "projects"))).toThrow();
  const other = await clonedWorkspace();
  expect(() => openRelay(other.root, sync)).toThrow();
  ws.writeText(
    "projects/no-share/STATUS.md",
    stringifyFrontmatter({ title: "不外发", updated: null, sensitive: true }),
  );
  expect(() => previewSnapshot(relay, "no-share", "md")).toThrow();
  // A credential file linked into the selected project must not become shareable.
  const linkDir = join(ws.root, "projects", "alias");
  mkdirSync(linkDir);
  linkSync(join(ws.root, status), join(linkDir, "STATUS.md"));
  expect(() => previewSnapshot(relay, "alias", "md")).toThrow();
  symlinkSync(linkDir, join(ws.root, "projects", "alias-dir"), "junction");
  expect(() => previewSnapshot(relay, "alias-dir", "md")).toThrow();
});

it("从命令行收件，经正式导入与归档仍去重；残件修好后可重试，回件原文不能写主记录", async () => {
  const ws = await clonedWorkspace();
  const original = project();
  ws.writeText(status, original);
  const sync = tmp();
  const cli = fileURLToPath(new URL("../dist/baidu-netdisk/cli.js", import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args, "--dir", ws.root, "--relay", sync], { encoding: "utf8" });
  const preview = run("preview", "--project", "lantern");
  expect(preview.status, preview.stderr).toBe(0);
  const approval = /--approve ([a-f0-9]{64})/.exec(preview.stdout)?.[1] ?? "";
  const result = run("publish", "--project", "lantern", "--approve", approval);
  expect(result.status, result.stderr).toBe(0);
  const name = "2026-01-05-lantern-01.txt";
  const reply = join(sync, "收件箱", name);
  const payload = '---\nagent: 你\nkind: capture\n---\n{"type":"task","title":"未授权的待办"}';
  const now = ws.readText("NOW.md");
  writeFileSync(reply, payload);
  writeFileSync(join(sync, "资料", "2026-01-05-not-inbox.txt"), "其他目录\n【交接结束】");
  writeFileSync(join(sync, "收件箱", "other.records.jsonl"), '{"type":"task"}');
  const partial = run("pull");
  expect(partial.status).toBe(1);
  expect(JSON.parse(partial.stdout)).toMatchObject({ queued: 0, ignored: 1, issues: [{ file: name }] });
  const complete = `${payload}\n【交接结束】\n`;
  writeFileSync(reply, complete);
  expect(JSON.parse(run("pull").stdout)).toMatchObject({ queued: 1, issues: [] });
  expect(JSON.parse(run("pull").stdout)).toMatchObject({ queued: 0, alreadyReceived: 1 });
  const imported = await processInbox(ws, { stableMs: 0 });
  expect(imported.notes).toHaveLength(1);
  const notes = inboxNotes(ws);
  expect(notes).toHaveLength(1);
  const [note] = notes;
  if (!note) throw new Error("正式导入器未返回笔记");
  expect(note.agent).toBe("百度网盘接力");
  expect(note.kind).toBeUndefined();
  expect(note.content).toContain(`百度网盘/收件箱/${name}`);
  expect(note.content).toContain("    agent: 你");
  expect(JSON.parse(run("pull").stdout)).toMatchObject({ alreadyReceived: 1 });
  const archived = await inboxNoteDone(ws, note.path);
  expect(JSON.parse(run("pull").stdout)).toMatchObject({ queued: 0, alreadyReceived: 1 });
  expect(readFileSync(reply, "utf8")).toBe(complete);
  writeFileSync(reply, "修改过的同名交接\n【交接结束】");
  const conflict = run("pull");
  expect(conflict.status).toBe(1);
  expect(JSON.parse(conflict.stdout)).toMatchObject({ queued: 0, issues: [{ file: name }] });
  expect(ws.readText(archived.path)).toBe(note.content);
  expect(ws.readText(status)).toBe(original);
  expect(ws.readText("NOW.md")).toBe(now);
  expect(inboxNotes(ws)).toEqual([]);
  expect(readdirSync(join(ws.root, "inbox", "agents")).filter((file) => file.endsWith(".note.md"))).toEqual(
    [],
  );
});
