import { join } from "node:path";
import { expect, it } from "vitest";
import { setStateBinding } from "../src/state-binding.js";
import { clonedWorkspace, tmp } from "./helpers.js";

it("normalizes local paths while preserving protected paths and live workspace bindings", async () => {
  const ws = await clonedWorkspace();
  expect(ws.resolve("learning/../me/profile.md")).toBe(join(ws.root, "me/profile.md"));
  for (const file of ["../outside.md", ws.root, ".git/config", "me/../.kaitu/cache"]) {
    expect(() => ws.resolve(file)).toThrow();
  }
  const first = tmp();
  setStateBinding(ws.root, first, "drive");
  expect(ws.resolve(".kaitu/cache", { internal: true })).toBe(join(first, "cache"));
  expect(ws.resolve(".kaitu/config.json", { internal: true })).toBe(join(ws.root, ".kaitu/config.json"));
  const second = tmp();
  setStateBinding(ws.root, second, "drive");
  expect(ws.resolve(".kaitu/cache", { internal: true })).toBe(join(second, "cache"));
  const other = await clonedWorkspace();
  ws.root = other.root;
  expect(ws.resolve("me/profile.md")).toBe(join(other.root, "me/profile.md"));
  expect(ws.resolve(".kaitu/cache", { internal: true })).toBe(join(other.root, ".kaitu/cache"));
});
