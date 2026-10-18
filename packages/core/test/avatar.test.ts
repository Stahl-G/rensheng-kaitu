import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { enableDrive, initWorkspace, readAvatar, removeAvatar, saveAvatar } from "../src/index.js";
import { tmp } from "./helpers.js";

it("头像只留本机，工作区迁到 Drive 后仍能读回同一张图", async () => {
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  try {
    const ws = await initWorkspace(join(home, "kaitu"));
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const expected = `data:image/png;base64,${bytes.toString("base64")}`;
    saveAvatar(ws, bytes);
    expect(readAvatar(ws)).toBe(expected);
    expect(readdirSync(ws.root, { recursive: true }).some((p) => String(p).endsWith("avatar.jpg"))).toBe(
      false,
    );
    const drive = join(home, "drive");
    mkdirSync(drive);
    await enableDrive(ws, { driveDir: drive });
    expect(readAvatar(ws)).toBe(expected);
    removeAvatar(ws);
    expect(readAvatar(ws)).toBeNull();
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
