import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { FsError } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { openNativeAssociatedPath, openNativePath } from "@deepseek-ai/dsh-native-command";
import { initWorkspace, stringifyFrontmatter, upgradeWorkspace, writeAgentsMd } from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { dshFiles } from "../../core/src/dsh-files.js";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { confinedFileSystem } from "../../desktop/sdk-filesystem.mjs";
import { KaituSkillProvider } from "../../dsh-plugin/src/skills.js";

vi.mock("@deepseek-ai/dsh-native-command", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openNativePath: vi.fn(),
  openNativeAssociatedPath: vi.fn(),
}));

test("portrait skills survive upgrades and SDK HTML files use exclusive creation and the external opener", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-portrait-"));
  const ctx = new Context();
  const ws = await initWorkspace(root);
  const paths = [".agents/skills/life-portrait/SKILL.md", ".claude/skills/life-portrait/SKILL.md"] as const;
  const stale = () =>
    ws.writeJson(
      ".kaitu/config.json",
      { ...ws.readJson<object>(".kaitu/config.json"), template_version: "old" },
      { internal: true },
    );
  try {
    const original = ws.readText(paths[0]);
    expect(ws.readText(paths[1])).toBe(original);
    for (const path of paths) rmSync(ws.resolve(path));
    stale();
    expect((await upgradeWorkspace(ws, { dryRun: true })).changes).toEqual(expect.arrayContaining(paths));
    expect(ws.exists(paths[0])).toBe(false);
    await upgradeWorkspace(ws);
    for (const path of paths) expect(ws.readText(path)).toBe(original);
    const custom = stringifyFrontmatter(
      { name: "life-portrait", description: "My portrait" },
      "Custom portrait instructions",
    );
    for (const path of paths) ws.writeText(path, custom);
    const extra = ".agents/skills/life-portrait/reference.md";
    ws.writeText(extra, "Custom material");
    stale();
    await upgradeWorkspace(ws);
    writeAgentsMd(ws);
    for (const path of paths) expect(ws.readText(path)).toBe(custom);
    expect(ws.readText(extra)).toBe("Custom material");
    const provider = new KaituSkillProvider(ws);
    const skill = (await provider.list({})).find((item) => item.name === "life-portrait");
    if (!skill) throw new Error("Portrait skill missing");
    expect((await provider.get(skill, {}))?.content).toContain("Custom portrait instructions");
    ws.writeText(paths[0], custom.replace("instructions", "replacement"));
    expect((await provider.get(skill, {}))?.content).toContain("Custom portrait replacement");

    const files = new (confinedFileSystem(LocalFileSystem, FsError, root))(ctx, {
      cwd: root,
      diffBasisMaxBytes: 1024 * 1024,
    });
    const path = "reviews/portrait/2026-11-01.html";
    const target = await files.resolve(path);
    const html = "<!doctype html><title>Synthetic portrait</title><p>Synthetic source</p>";
    await files.writeText(target, html, { kind: "createIfAbsent" });
    expect(await files.readText(target)).toBe(html);
    await expect(files.writeText(target, "overwrite", { kind: "createIfAbsent" })).rejects.toThrow();
    expect(await files.readText(target)).toBe(html);
    const next = await files.resolve("reviews/portrait/2026-11-01-2.html");
    await files.writeText(next, html, { kind: "createIfAbsent" });
    expect(await files.readText(next)).toBe(html);
    await expect(files.resolve("../outside.html")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    const native = dshFiles(ws);
    await native.open(path);
    expect(openNativePath).toHaveBeenCalledWith(ws.resolve(path), expect.any(AbortSignal));
    expect(openNativeAssociatedPath).not.toHaveBeenCalled();
    native.dispose();
  } finally {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
