import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Workspace, initWorkspace, writePhoneSnapshots } from "../src/index.js";
import { userNavigation } from "../src/navigation.js";
import { setStateBinding } from "../src/state-binding.js";
import { tmp } from "./helpers.js";

it("导航不依赖摘要，跟随正文改名删除，按实际模块身份排除财务", async () => {
  const ws = await initWorkspace(join(tmp(), "ws"));
  ws.writeText("learning/topic/notes.md", "# 开图 SDK\n合成原文，无摘要");
  let nav = userNavigation(ws);
  expect(nav.files.find((file) => file.path === "learning/topic/notes.md")?.title).toBe("开图 SDK");
  ws.writeText("learning/topic/notes.md", "# 改过的标题\n新正文");
  expect(userNavigation(ws).files.find((file) => file.path === "learning/topic/notes.md")?.title).toBe(
    "改过的标题",
  );
  renameSync(ws.resolve("learning/topic"), ws.resolve("learning/renamed"));
  nav = userNavigation(ws);
  expect(nav.files.some((file) => file.path === "learning/topic/notes.md")).toBe(false);
  expect(nav.files.some((file) => file.path === "learning/renamed/notes.md")).toBe(true);
  rmSync(ws.resolve("learning/renamed/notes.md"));
  expect(userNavigation(ws).files.some((file) => file.path === "learning/renamed/notes.md")).toBe(false);
  ws.writeText("learning/renamed/notes.md", "# SYNTH_PRIVATE\n不要输出");
  const finance = ws.readJson<object>("finance/module.json");
  ws.writeJson("learning/module.json", finance);
  nav = userNavigation(ws);
  expect(JSON.stringify(nav)).not.toContain("SYNTH_PRIVATE");
  expect(nav.modules.some((module) => module.path === "learning/module.json")).toBe(false);
  expect(nav.files.some((file) => file.path.startsWith("learning/"))).toBe(false);
});

it("导航占位标为不可用，失败保留上一代，恢复后发现没有摘要的新文件", async () => {
  const original = await initWorkspace(join(tmp(), "ws"));
  setStateBinding(original.root, original.resolve(".kaitu", { internal: true }), "icloud");
  const ws = new Workspace(original.root, { maintain: false });
  ws.writeText("learning/topic/notes.md", "仅有原文，没有摘要");
  await writePhoneSnapshots(ws, new Date(), { force: true });
  const before = ws.readText("phone/library.json");
  ws.writeText("learning/new/notes.md", "新建原文，没有摘要");
  const write = ws.writeJson.bind(ws);
  const failure = vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    if (file === "phone/library.json") throw new Error("synthetic interrupted publication");
    return write(file, value, options);
  });
  await expect(writePhoneSnapshots(ws, new Date(), { force: true })).rejects.toThrow("synthetic interrupted");
  expect(ws.readText("phone/library.json")).toBe(before);
  failure.mockRestore();
  rmSync(ws.resolve("learning/new/notes.md"));
  renameSync(ws.resolve("learning/topic/notes.md"), ws.resolve("learning/topic/notes.saved"));
  writeFileSync(ws.resolve("learning/topic/.notes.md.icloud"), "");
  expect(userNavigation(ws).status).toBe("unavailable");
  await writePhoneSnapshots(ws, new Date(), { force: true });
  const pending = ws.readJson<{ navigation: ReturnType<typeof userNavigation> }>("phone/library.json");
  expect(pending.navigation.status).toBe("unavailable");
  expect(pending.navigation.files.some((file) => file.path === "learning/topic/notes.md")).toBe(true);
  rmSync(ws.resolve("learning/topic/.notes.md.icloud"));
  renameSync(ws.resolve("learning/topic/notes.saved"), ws.resolve("learning/topic/notes.md"));
  await writePhoneSnapshots(ws, new Date(), { force: true });
  expect(
    ws.readJson<{ navigation: ReturnType<typeof userNavigation> }>("phone/library.json").navigation.status,
  ).toBe("available");
  expect(JSON.parse(before).navigation.files).toEqual(userNavigation(ws).files);
});

it("无关附件占位不影响导航或触发下载，必要原文占位仍失效", async () => {
  const original = await initWorkspace(join(tmp(), "ws"));
  setStateBinding(original.root, original.resolve(".kaitu", { internal: true }), "icloud");
  const ws = new Workspace(original.root, { maintain: false });
  ws.writeText("learning/topic/notes.md", "# 合成学习原文");
  const before = userNavigation(ws);
  writeFileSync(ws.resolve("learning/topic/.assets.icloud"), "");
  const checked = vi.spyOn(ws, "isUnavailable");
  expect(userNavigation(ws)).toEqual(before);
  expect(checked.mock.calls.flat().some((path) => path.includes("assets"))).toBe(false);
  checked.mockRestore();
  writeFileSync(ws.resolve("learning/topic/.notes.md.icloud"), "");
  expect(userNavigation(ws).status).toBe("unavailable");
});
