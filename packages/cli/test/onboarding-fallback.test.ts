import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type OnboardingMatter,
  countInboxNotes,
  initWorkspace,
  listTasks,
  readOnboardingMatter,
  validateWorkspace,
} from "@kaitu/core";
import { expect, it } from "vitest";
import { createAskService } from "../src/ui/ask.js";
import { productRequest } from "../src/ui/product.js";

it("本机 AI 权限不足时保留原文，仍可只留原文、手动采纳或贴回外部草稿", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-fallback-"));
  let launches = 0;
  const ws = await initWorkspace(join(root, "workspace"));
  const ask = createAskService({
    state: join(root, "state"),
    workspace: ws.root,
    settings: async () => ({
      configured: true,
      provider: "synthetic",
      model: "synthetic",
      fullOnly: true,
    }),
    configure: async () => ({}),
    models: async () => [],
    runtime: async () => {
      launches++;
      throw new Error("This synthetic runtime must not start");
    },
  });
  const request = (method: string, args: unknown[]) => productRequest(ws, method, args, ask);
  try {
    for (const fallback of ["keep", "manual", "paste"]) {
      const original = `合成目标 ${fallback}：想在周末多走一走`;
      const matter = (await request("onboardingMatterSave", [original])) as OnboardingMatter;
      await expect(request("onboardingMatterOrganize", [matter.source])).rejects.toMatchObject({
        code: "AI_CONNECTION",
      });
      expect(launches).toBe(0);
      expect(ask.list().every((thread) => thread.mode === "scoped")).toBe(true);
      expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe(original);
      const before = listTasks(ws).length;
      const draft = { goal: `周末散步 ${fallback}`, current: "", next: "周六到附近公园走十分钟" };
      if (fallback === "keep") {
        await request("onboardingMatterKeep", [matter.source]);
        expect(listTasks(ws)).toHaveLength(before);
        await request("onboardingMatterKeep", [matter.source]);
      } else {
        if (fallback === "paste") {
          expect(await request("onboardingMatterPrompt", [matter.source])).toContain(original);
          const pasted = (await request("onboardingMatterPaste", [
            matter.source,
            JSON.stringify(draft),
          ])) as OnboardingMatter;
          expect(pasted.draft).toEqual(draft);
          expect(listTasks(ws)).toHaveLength(before);
        }
        await request("onboardingMatterAdopt", [matter.source, draft, null]);
        expect(listTasks(ws)).toHaveLength(before + 1);
        expect(listTasks(ws).at(-1)).toMatchObject({ source: matter.source, title: draft.next });
      }
      expect(countInboxNotes(ws)).toBe(0);
      expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe(original);
    }
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    await ask.close();
    rmSync(root, { recursive: true, force: true });
  }
});
