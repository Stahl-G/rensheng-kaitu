import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BackupFiles,
  connectWorkspaceBackup,
  currentWorkspace,
  initWorkspace,
  parseFrontmatter,
  rememberWorkspace,
  syncWorkspaceBackup,
} from "@kaitu/core";
import { afterEach, expect, it } from "vitest";
import { type UiOptions, startUi } from "../src/ui/server.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(options: UiOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-failure-recovery-"));
  const root = join(directory, "current");
  cleanup.push(async () => rmSync(directory, { recursive: true, force: true }));
  const ws = await initWorkspace(root);
  const ui = await startUi(ws, { port: 0, open: false, systemLocale: "zh-CN", ...options });
  cleanup.push(ui.close);
  const post = async (method: string, args: unknown[], raw = JSON.stringify(args)) => {
    const response = await fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { Origin: ui.url, "X-Kaitu": "1" },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  };
  return { ws, post };
}

it("空目录可独立新建再切回，拒绝覆盖已有资料，打开入口保留可操作错误", async () => {
  const lifecycle: string[] = [];
  const { ws, post } = await setup({
    onWorkspaceChanging: async () => {
      lifecycle.push("changing");
    },
    onWorkspaceChanged: async () => {
      lifecycle.push("changed");
    },
  });
  const previous = ws.root;
  const profile = `${ws.readText("me/profile.md")}\n仅属于原工作区的合成资料\n`;
  ws.writeText("me/profile.md", profile);
  rememberWorkspace(previous);
  const target = join(previous, "../empty");
  mkdirSync(target);
  const opened = await post("workspaceBackup", ["activate", { root: target }]);
  expect(opened.status).toBe(400);
  expect(opened.body.error).toContain("新建空白工作区");
  expect(ws.root).toBe(previous);
  expect(currentWorkspace()).toBe(previous);
  expect(readdirSync(target)).toEqual([]);
  lifecycle.length = 0;
  expect((await post("workspaceBackup", ["initialize", { root: target }])).status).toBe(200);
  expect(ws.root).toBe(previous);
  expect((await post("workspaceBackup", ["activate", { root: target }])).status).toBe(200);
  expect(lifecycle).toEqual(["changing", "changed"]);
  expect(ws.root).toBe(join(previous, "../empty"));
  expect(currentWorkspace()).toBe(ws.root);
  expect(ws.readText("me/profile.md")).not.toContain("仅属于原工作区");
  expect(readFileSync(join(previous, "me/profile.md"), "utf8")).toBe(profile);
  expect((await post("onboarding", [])).status).toBe(200);
  expect((await post("workspaceBackup", ["activate", { root: previous }])).status).toBe(200);
  expect(ws.readText("me/profile.md")).toBe(profile);
  const files = readdirSync(target);
  expect((await post("workspaceBackup", ["initialize", { root: target }])).status).toBe(400);
  expect(readdirSync(target)).toEqual(files);
  const occupied = join(previous, "../occupied");
  mkdirSync(occupied);
  writeFileSync(join(occupied, "keep.txt"), "existing synthetic content");
  expect((await post("workspaceBackup", ["initialize", { root: occupied }])).status).toBe(400);
  expect(readdirSync(occupied)).toEqual(["keep.txt"]);
  expect(readFileSync(join(occupied, "keep.txt"), "utf8")).toBe("existing synthetic content");
  expect(ws.root).toBe(previous);
});

it("损坏的请求与 frontmatter 不写入，修正后完成下一步且重试不再写入", async () => {
  const { ws, post } = await setup();
  const file = "health/STATUS.md";
  const original =
    "---\nupdated: null\nnext:\n  - id: v5\n    title: 合成事项\n    status: todo\n---\n保留正文\n";
  ws.writeText(file, original);
  expect((await post("completeNext", [file, "v5"], "[broken")).status).toBe(400);
  expect(ws.readText(file)).toBe(original);
  const broken = original.replace("updated: null", "updated: [unterminated");
  ws.writeText(file, broken);
  const failed = await post("completeNext", [file, "v5"]);
  expect(failed.status).toBe(400);
  expect(failed.body.error).toContain(file);
  expect(failed.body.error).toContain("YAML");
  expect(ws.readText(file)).toBe(broken);
  ws.writeText(file, original);
  expect((await post("completeNext", [file, "v5"])).status).toBe(200);
  const completed = ws.readText(file);
  expect(parseFrontmatter<{ next: { status: string }[] }>(completed).data.next[0]?.status).toBe("done");
  expect(parseFrontmatter(completed).body).toBe("保留正文\n");
  expect((await post("completeNext", [file, "v5"])).status).toBe(409);
  expect(ws.readText(file)).toBe(completed);
});

it("同步冲突后又有本机编辑时 HTTP 要求重新核对，两份内容保留且重试不重复归档", async () => {
  const { ws, post } = await setup();
  let files: BackupFiles = {};
  const remote = {
    inspect: async () => ({ private: true, branch: "main" }),
    read: async () => ({ head: "synthetic-head", files }),
    push: async (_repo: string, _branch: string, _head: string | null, next: BackupFiles) => {
      files = next;
      return "synthetic-head";
    },
  };
  await connectWorkspaceBackup(ws, { repo: "synthetic/recovery", text: true, records: false }, remote);
  await syncWorkspaceBackup(ws, remote);
  ws.writeText("me/profile.md", "first local edit\n");
  files = { ...files, "me/profile.md": "remote edit\n" };
  await syncWorkspaceBackup(ws, remote);
  ws.writeText("me/profile.md", "second local edit\n");
  const args = ["resolve", { path: "me/profile.md", choice: "remote" }];
  const failed = await post("workspaceBackup", args);
  expect(failed.status).toBe(409);
  expect(ws.readText("me/profile.md")).toBe("second local edit\n");
  const status = await post("workspaceBackup", ["status"]);
  expect(status.body.conflicts[0]).toMatchObject({ local: "second local edit\n", remote: "remote edit\n" });
  expect((await post("workspaceBackup", args)).status).toBe(200);
  expect(ws.readText("me/profile.md")).toBe("remote edit\n");
  const archive = ws.resolve(".kaitu/backup-conflicts", { internal: true });
  const saved = readdirSync(archive);
  expect(saved).toHaveLength(1);
  expect(ws.readJson(`.kaitu/backup-conflicts/${saved[0]}`)).toMatchObject({
    local: "second local edit\n",
    remote: "remote edit\n",
  });
  expect((await post("workspaceBackup", args)).status).toBe(409);
  expect(readdirSync(archive)).toEqual(saved);
  expect(ws.readText("me/profile.md")).toBe("remote edit\n");
});

it("没有桌面宿主仍能读取内置模块，插件写操作继续拒绝", async () => {
  const { post } = await setup();
  expect(await post("plugins", ["explore"])).toEqual({ status: 200, body: [] });
  expect((await post("overview", [])).status).toBe(200);
  expect((await post("plugins", ["install", "synthetic-plugin"])).status).toBe(400);
});
