import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ScopeError,
  Workspace,
  addRecord,
  deleteRecord,
  history,
  initWorkspace,
  restore,
  snapshot,
  updateRecord,
} from "../src/index.js";
import { tmp, workout } from "./helpers.js";

describe("写入范围", () => {
  it("拒绝工作区外、.kaitu/ 与 .git/ 的路径", async () => {
    const parent = tmp();
    const ws = await initWorkspace(join(parent, "kaitu"));
    for (const bad of ["../x.md", "me/../../x.md", "/etc/passwd", ".kaitu/config.json", ".git/config"]) {
      expect(() => ws.writeText(bad, "x"), bad).toThrow(ScopeError);
    }
    expect(() => ws.writeText(".kaitu/cache/a", "x", { internal: true })).not.toThrow();
  });

  it("一整套操作只改动工作区内的文件", async () => {
    const parent = tmp();
    writeFileSync(join(parent, "sentinel.txt"), "keep");
    const ws = await initWorkspace(join(parent, "kaitu"));
    const r = addRecord(ws, "workout", workout).record;
    updateRecord(ws, "workout", r.id, { sets: 4 });
    deleteRecord(ws, "workout", r.id);
    await snapshot(ws, "测试");
    const [first] = (await history(ws)).slice(-1);
    await restore(ws, first?.oid as string);
    expect(readdirSync(parent).sort()).toEqual(["kaitu", "sentinel.txt"]);
    expect(readFileSync(join(parent, "sentinel.txt"), "utf8")).toBe("keep");
  });

  it("init 拒绝非空目录", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.txt"), "x");
    await expect(initWorkspace(dir)).rejects.toThrow(/不是空目录/);
    expect(existsSync(join(dir, ".kaitu"))).toBe(false);
  });

  it("Workspace 只接受相对路径", () => {
    const ws = new Workspace(tmp());
    expect(() => ws.resolve("/tmp/x")).toThrow(ScopeError);
  });
});
