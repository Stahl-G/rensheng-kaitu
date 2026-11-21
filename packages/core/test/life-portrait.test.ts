import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { dshFiles } from "../src/dsh-files.js";
import { latestPortrait } from "../src/life-portrait.js";
import type { Workspace } from "../src/workspace.js";

const { openNativePath } = vi.hoisted(() => ({ openNativePath: vi.fn() }));
vi.mock("@deepseek-ai/dsh-native-command", async (load) => ({
  ...(await load<typeof import("@deepseek-ai/dsh-native-command")>()),
  openNativePath,
}));

it("reopens only the selected workspace's own saved generation in calendar and numeric order", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "kaitu-exhibition-"));
  const root = join(fixture, "workspace");
  const other = join(fixture, "other");
  const prefix = "reviews/portrait/";
  const file = `${prefix}2024-02-29-10.html`;
  try {
    for (const workspace of [root, other]) {
      mkdirSync(join(workspace, prefix), { recursive: true });
      writeFileSync(join(workspace, file), "synthetic");
    }
    for (const name of [
      "2024-02-29",
      "2024-02-29-9",
      "2024-02-28-200",
      "2024-02-30",
      "2024-03-01-01",
      "2024-03-01-0",
      "2024-03-01-1",
      "notes",
    ]) {
      writeFileSync(join(root, prefix, `${name}.html`), "");
    }
    mkdirSync(join(root, prefix, "2024-04-01.html"));
    symlinkSync(join(other, file), join(root, prefix, "2024-05-01.html"), "file");
    expect(latestPortrait(root)).toEqual({ root, file });
    const workspace = { root };
    const files = dshFiles(workspace as Workspace);
    expect(await files.openPortrait(root, file)).toEqual({ opened: true });
    expect(openNativePath).toHaveBeenCalledExactlyOnceWith(join(root, file), expect.any(AbortSignal));
    for (const invalid of [`${prefix}../2024-02-29.html`, `${prefix}2024-05-01.html`, join(root, file)]) {
      expect(await files.openPortrait(root, invalid)).toEqual({ opened: false });
    }
    workspace.root = other;
    expect(await files.openPortrait(root, file)).toEqual({ opened: false });
    rmSync(join(other, file));
    expect(await files.openPortrait(other, file)).toEqual({ opened: false });
    expect(latestPortrait(other)).toEqual({ root: other, file: null });
    rmSync(join(other, "reviews"), { recursive: true });
    symlinkSync(join(root, "reviews"), join(other, "reviews"), "junction");
    expect(latestPortrait(other).file).toBeNull();
    expect(await files.openPortrait(other, file)).toEqual({ opened: false });
    expect(openNativePath).toHaveBeenCalledTimes(1);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
