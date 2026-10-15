import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, stringifyFrontmatter } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { KaituSkillProvider } from "../src/skills.js";

it("工作区技能跨 cwd 可发现和加载，外部更新刷新目录与正文", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-skills-"));
  const lifecycle = new AbortController();
  vi.useFakeTimers();
  try {
    const ws = new Workspace(root, { maintain: false });
    const write = (name: string, value: number) =>
      ws.writeText(
        `.agents/skills/${name}/SKILL.md`,
        stringifyFrontmatter(
          { name, description: name, "user-invocable": false },
          `\n${JSON.stringify({ value })}\n`,
        ),
      );
    write("example", 1);
    const provider = new KaituSkillProvider(ws);
    let invalidations = 0;
    provider.watch({
      signal: lifecycle.signal,
      invalidate: () => {
        invalidations++;
      },
    });
    const [candidate] = await provider.list({ cwd: "/unrelated-session" });
    expect(candidate?.name).toBe("example");
    expect(candidate?.invocation).toEqual({ modelInvocable: true, userInvocable: false });
    if (!candidate) throw new Error("技能未发现");
    const first = await provider.get(candidate, { cwd: "/another-session" });
    expect(JSON.parse(first?.content.trim().split("\n").at(-1) ?? "")).toEqual({ value: 1 });
    write("example", 234);
    write("added", 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidations).toBeGreaterThan(0);
    expect((await provider.list({})).map((skill) => skill.name)).toEqual(["added", "example"]);
    const updated = await provider.get(candidate, {});
    expect(JSON.parse(updated?.content.trim().split("\n").at(-1) ?? "")).toEqual({ value: 234 });
    lifecycle.abort();
    write("later", 3);
    const before = invalidations;
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidations).toBe(before);
  } finally {
    lifecycle.abort();
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  }
});
