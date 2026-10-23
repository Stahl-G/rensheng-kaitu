import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initWorkspace, localStateRoot, moveWorkspace, rememberWorkspace } from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { stateBinding } from "../../core/src/state-binding.js";
// @ts-expect-error Desktop entry points are shipped as native ESM.
import { desktopPaths } from "../environment.mjs";
// @ts-expect-error Desktop entry points are shipped as native ESM.
import { openDesktopWorkspace } from "../local.mjs";

test("绑定的云盘资料改名后可取消、重试并选择任意名称重连，保留身份与本机状态", async () => {
  const home = process.env.HOME as string;
  const ws = await initWorkspace(join(home, "original"), { timeZone: "Asia/Shanghai" });
  const cloud = join(home, "synthetic-drive");
  mkdirSync(cloud);
  await moveWorkspace(ws, join(cloud, "before"), true, "folder");
  const previous = ws.root;
  const binding = stateBinding(previous);
  ws.writeText("inbox/preserved.md", "synthetic original\n");
  ws.writeJson(".kaitu/preferences.json", { language: "en" }, { internal: true });
  const renamed = join(cloud, "任意资料名 with spaces");
  renameSync(previous, renamed);
  const configBefore = readFileSync(join(renamed, ".kaitu/config.json"));
  const pointer = join(localStateRoot(), "current-workspace.json");
  const pointerBefore = readFileSync(pointer);
  const paths = desktopPaths({ KAITU_LOCAL_STATE_DIR: localStateRoot() });
  expect(paths.workspace).toBe(previous);
  expect(paths.createWorkspace).toBe(false);

  const invalid = join(home, "ordinary-folder");
  mkdirSync(invalid);
  writeFileSync(join(invalid, "keep.txt"), "do not initialize");
  const defaultExisted = existsSync(join(home, "kaitu-ai-memory"));
  const actions = [0, 1, 0, 0]; // 选择取消、重试旧位置、误选、再选有效目录。
  const showMessageBox = vi.fn(async (_window, options) => {
    expect(options.buttons).toContain("重新选择资料文件夹");
    expect(readFileSync(pointer)).toEqual(pointerBefore);
    expect(existsSync(previous)).toBe(false);
    return { response: actions.shift() ?? 2 };
  });
  const showOpenDialog = vi
    .fn()
    .mockResolvedValueOnce({ canceled: true, filePaths: [] })
    .mockResolvedValueOnce({ canceled: false, filePaths: [invalid] })
    .mockResolvedValueOnce({ canceled: false, filePaths: [renamed] });
  const opened = await openDesktopWorkspace({
    ...paths,
    window: { isDestroyed: () => false },
    dialog: { showMessageBox, showOpenDialog },
  });
  expect(opened.root).toBe(renamed);
  expect(opened.readText("inbox/preserved.md")).toBe("synthetic original\n");
  expect(opened.readJson(".kaitu/preferences.json")).toEqual({ language: "en" });
  expect(stateBinding(renamed)).toMatchObject({ id: binding.id, state: binding.state, mode: binding.mode });
  const registry = join(localStateRoot(), "workspaces");
  const registrations = readdirSync(registry).map((name) =>
    JSON.parse(readFileSync(join(registry, name), "utf8")),
  );
  expect(registrations.some((entry) => entry.root === previous)).toBe(false);
  expect(JSON.parse(readFileSync(pointer, "utf8")).root).toBe(renamed);
  expect(desktopPaths({ KAITU_LOCAL_STATE_DIR: localStateRoot() }).workspace).toBe(renamed);
  expect(readFileSync(join(renamed, ".kaitu/config.json"))).toEqual(configBefore);
  expect(readdirSync(invalid)).toEqual(["keep.txt"]);
  expect(existsSync(previous)).toBe(false);
  expect(existsSync(join(home, "kaitu-ai-memory"))).toBe(defaultExisted);
  expect(showMessageBox).toHaveBeenCalledTimes(4);
  expect(showOpenDialog).toHaveBeenCalledTimes(3);
});

test("配置未下载错误有单独提示，选择其他合法工作区不继承旧身份", async () => {
  const home = process.env.HOME as string;
  const ws = await initWorkspace(join(home, "offline"), { timeZone: "Asia/Shanghai" });
  const other = await initWorkspace(join(home, "other"), { timeZone: "Asia/Shanghai" });
  const otherBinding = stateBinding(other.root);
  rememberWorkspace(ws.root);
  const original = ws.root;
  renameSync(original, `${original}-moved`);
  const opened = await openDesktopWorkspace({
    state: join(home, "app"),
    workspace: original,
    createWorkspace: false,
    workspaceError: Object.assign(new Error("synthetic offline"), { code: "CLOUD_UNAVAILABLE" }),
    window: { isDestroyed: () => false },
    dialog: {
      showMessageBox: async (_window: unknown, options: { detail: string }) => {
        expect(options.detail).toContain("尚未下载");
        return { response: 0 };
      },
      showOpenDialog: async () => ({ canceled: false, filePaths: [other.root] }),
    },
  });
  expect(opened.root).toBe(other.root);
  expect(stateBinding(other.root).id).toBe(otherBinding.id);
});

test("重连保存失败时恢复原状态登记和指针，排除保存故障后可重试", async () => {
  const home = process.env.HOME as string;
  const ws = await initWorkspace(join(home, "rollback-original"));
  const cloud = join(home, "rollback-cloud");
  mkdirSync(cloud);
  await moveWorkspace(ws, join(cloud, "before"), true, "folder");
  const previous = ws.root;
  const binding = stateBinding(previous);
  const renamed = join(cloud, "after");
  renameSync(previous, renamed);
  const pointer = join(localStateRoot(), "current-workspace.json");
  const before = readFileSync(pointer);
  mkdirSync(`${pointer}.tmp`); // 真实文件系统失败：无法原子保存指针。
  let prompt = 0;
  const opened = await openDesktopWorkspace({
    ...desktopPaths({ KAITU_LOCAL_STATE_DIR: localStateRoot() }),
    window: { isDestroyed: () => false },
    dialog: {
      showMessageBox: async () => {
        if (prompt++ === 0) return { response: 0 };
        expect(readFileSync(pointer)).toEqual(before);
        expect(stateBinding(previous)).toEqual(binding);
        // 排除保存故障后直接重试同一个已选目录。
        rmSync(`${pointer}.tmp`, { recursive: true });
        return { response: 1 };
      },
      showOpenDialog: async () => ({ canceled: false, filePaths: [renamed] }),
    },
  });
  expect(opened.root).toBe(renamed);
  expect(stateBinding(renamed)).toMatchObject({ id: binding.id, state: binding.state });
  expect(prompt).toBe(2);
});
