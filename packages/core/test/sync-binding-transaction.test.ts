import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { currentWorkspace, disableSync, enableSync } from "../src/drive.js";
import { initWorkspace } from "../src/init.js";
import { localStateRoot } from "../src/local-state.js";
import { mcpToken } from "../src/secrets.js";
import { stateBinding } from "../src/state-binding.js";
import { tmp } from "./helpers.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

const originalFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const rename = vi.mocked(renameSync);
const bytes = (root: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(root, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry): [string, string][] =>
        entry.isDirectory()
          ? Object.entries(bytes(join(root, entry.name))).map(([path, data]) => [
              `${entry.name}/${path}`,
              data,
            ])
          : [[entry.name, readFileSync(join(root, entry.name)).toString("hex")]],
      ),
  );
const registry = () =>
  Object.fromEntries(
    readdirSync(join(localStateRoot(), "workspaces"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [name, readFileSync(join(localStateRoot(), "workspaces", name), "utf8")]),
  );
async function fixture() {
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", join(home, "local-state"));
  const local = join(home, "local");
  const ws = await initWorkspace(local);
  ws.writeText("inbox/notes/2026-10-31/original.md", "Synthetic original, unchanged after a failed move.\n");
  const folder = join(home, "sync-folder");
  mkdirSync(folder);
  await enableSync(ws, "drive", { dir: folder, provider: "folder" });
  return { home, local, ws, source: ws.root, token: mcpToken(ws) };
}
const registration = (from: string, to: string, target: string) =>
  dirname(to) === join(localStateRoot(), "workspaces") &&
  JSON.parse(readFileSync(from, "utf8")).root ===
    (existsSync(target) ? realpathSync(target) : join(realpathSync(dirname(target)), basename(target)));

it("keeps originals, bindings and the open root intact when the target binding rename fails", async () => {
  const { home, ws, source, token } = await fixture();
  const target = join(home, "returned");
  const before = bytes(source);
  const binding = stateBinding(source);
  const state = bytes(binding.state);
  const mappings = registry();
  const pointer = currentWorkspace();
  const failure = Object.assign(new Error("Synthetic binding rename denied"), {
    code: "EPERM",
    syscall: "rename",
  });
  rename.mockImplementation((from, to) => {
    if (registration(String(from), String(to), target)) throw failure;
    originalFs.renameSync(from, to);
  });
  try {
    await expect(disableSync(ws, { to: target })).rejects.toBe(failure);
    if (!existsSync(source))
      console.error("binding-failure-physical-state", {
        openRootStillAtSource: ws.root === source,
        sourceExists: false,
        targetExists: existsSync(target),
        originalsAtTarget: existsSync(target) && JSON.stringify(bytes(target)) === JSON.stringify(before),
        isolatedStateIntact: JSON.stringify(bytes(binding.state)) === JSON.stringify(state),
        bindingsUnchanged: JSON.stringify(registry()) === JSON.stringify(mappings),
        pointerUnchanged: currentWorkspace() === pointer,
      });
    expect(ws.root).toBe(source);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(bytes(source)).toEqual(before);
    expect(bytes(binding.state)).toEqual(state);
    expect(stateBinding(source)).toEqual(binding);
    expect(registry()).toEqual(mappings);
    expect(currentWorkspace()).toBe(pointer);
    expect(mcpToken(ws)).toBe(token);
    rename.mockImplementation(originalFs.renameSync);
    await disableSync(ws, { to: target });
    expect(ws.root).toBe(target);
    expect(ws.readText("inbox/notes/2026-10-31/original.md")).toContain("Synthetic original");
    expect(stateBinding(target).mode).toBe("local");
    expect(mcpToken(ws)).toBe(token);
  } finally {
    rename.mockImplementation(originalFs.renameSync);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("restores prior registration after a failed move and preserves both errors if undo also fails", async () => {
  const { home, local, ws, source } = await fixture();
  const before = bytes(source);
  const binding = stateBinding(source);
  const state = bytes(binding.state);
  const pointer = currentWorkspace();
  try {
    for (const [target, undoFails] of [
      [join(home, "new-target"), false],
      [local, false],
      [local, true],
    ] as const) {
      const mappings = registry();
      const failure = Object.assign(new Error("Synthetic workspace rename denied"), {
        code: "EPERM",
        syscall: "rename",
      });
      const undo = Object.assign(new Error("Synthetic binding undo denied"), {
        code: "EPERM",
        syscall: "rename",
      });
      let writes = 0;
      rename.mockImplementation((from, to) => {
        if (registration(String(from), String(to), target) && ++writes === 2 && undoFails) throw undo;
        if (String(from) === source && String(to) === target) throw failure;
        originalFs.renameSync(from, to);
      });
      const error: unknown = await disableSync(ws, { to: target }).catch((cause: unknown) => cause);
      if (undoFails) {
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([failure, undo]);
        expect((error as AggregateError).cause).toBe(failure);
      } else {
        expect(error).toBe(failure);
        expect(registry()).toEqual(mappings);
      }
      expect(ws.root).toBe(source);
      expect(existsSync(source)).toBe(true);
      expect(existsSync(target)).toBe(false);
      expect(bytes(source)).toEqual(before);
      expect(bytes(binding.state)).toEqual(state);
      expect(stateBinding(source)).toEqual(binding);
      expect(currentWorkspace()).toBe(pointer);
    }
  } finally {
    rename.mockImplementation(originalFs.renameSync);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
