import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { FsError } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { openNativeAssociatedPath, openNativePath } from "@deepseek-ai/dsh-native-command";
import { initWorkspace, upgradeWorkspace, writeAgentsMd } from "@kaitu/core";
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
  const setTemplateVersion = (template_version = "old") =>
    ws.writeJson(
      ".kaitu/config.json",
      { ...ws.readJson<object>(".kaitu/config.json"), template_version },
      { internal: true },
    );
  try {
    const original = ws.readText(paths[0]);
    expect(ws.readText(paths[1])).toBe(original);
    for (const path of paths) rmSync(ws.resolve(path));
    setTemplateVersion("ecdb0d8cead1");
    expect((await upgradeWorkspace(ws, { dryRun: true })).changes).toEqual(paths);
    expect(ws.exists(paths[0])).toBe(false);
    await upgradeWorkspace(ws);
    for (const path of paths) expect(ws.readText(path)).toBe(original);
    // 还原未发布 v1 ZIP 的三处环境适配，完整哈希保证使用真实旧候选。
    const oldCandidate = original
      .replace("按钮只填入：", "按钮只需发送：")
      .replace("`，由用户自己发送。", "`。")
      .replace(
        "在开图问问中用已有的文件写入工具保存 HTML，按工具提供的“仅当不存在时创建”语义防止竞争覆盖；`kaitu_workspace write` 只支持 Markdown/JSON，不能用于 HTML。",
        "",
      )
      .replace(/，并使用 Markdown 链接，例如 .*?不在开图内嵌执行。/, "；");
    expect(createHash("sha256").update(oldCandidate).digest("hex")).toBe(
      "c7ba29142055a7ef8762715b5a6e9ff64b32c95029ac8fb3e8fa9dca33e6f957",
    );
    const extras = paths.map((path) => path.replace("SKILL.md", "reference.md"));
    for (const extra of extras) ws.writeText(extra, "Custom material");
    for (const update of [() => writeAgentsMd(ws), () => upgradeWorkspace(ws)]) {
      for (const path of paths) ws.writeText(path, oldCandidate);
      setTemplateVersion();
      await update();
      for (const path of paths) expect(ws.readText(path)).toBe(original);
      for (const extra of extras) expect(ws.readText(extra)).toBe("Custom material");
    }
    const custom = `${original}\nCustom portrait instructions\n`; // 原 frontmatter 未改。
    ws.writeText(paths[0], oldCandidate);
    ws.writeText(paths[1], custom);
    setTemplateVersion();
    await upgradeWorkspace(ws);
    expect(ws.readText(paths[0])).toBe(original);
    expect(ws.readText(paths[1])).toBe(custom);
    ws.writeText(paths[0], custom);
    setTemplateVersion();
    await upgradeWorkspace(ws);
    writeAgentsMd(ws);
    for (const path of paths) expect(ws.readText(path)).toBe(custom);
    for (const extra of extras) expect(ws.readText(extra)).toBe("Custom material");
    const unrelated = [".agents", ".claude"].flatMap((base) =>
      ["SKILL.md", "reference.md"].map((name) => `${base}/skills/log-workout/${name}`),
    );
    for (const path of unrelated) ws.writeText(path, "Unrelated customization");
    setTemplateVersion("ecdb0d8cead1"); // cdca9959 的实际模板版本，不伪造一次全量升级。
    const config = ws.readText(".kaitu/config.json");
    ws.writeText(paths[0], oldCandidate);
    expect((await upgradeWorkspace(ws, { dryRun: true })).changes).toEqual([paths[0]]);
    expect(ws.readText(paths[0])).toBe(oldCandidate);
    expect(await upgradeWorkspace(ws)).toMatchObject({ changes: [paths[0]], version: null });
    expect(ws.readText(paths[0])).toBe(original);
    expect(ws.readText(paths[1])).toBe(custom);
    for (const path of unrelated) expect(ws.readText(path)).toBe("Unrelated customization");
    for (const extra of extras) expect(ws.readText(extra)).toBe("Custom material");
    expect(ws.readText(".kaitu/config.json")).toBe(config);
    expect((await upgradeWorkspace(ws)).changes).toEqual([]);
    ws.writeText(paths[0], custom);
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
