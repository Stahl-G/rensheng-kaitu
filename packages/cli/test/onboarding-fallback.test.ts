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
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { productRequest } from "../src/ui/product.js";

it("本机 AI 连接失败时保留原文，仍可只留原文、手动采纳或贴回外部草稿", async () => {
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
      expect(launches).toBeGreaterThan(0);
      expect(ask.list()).toEqual([]);
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

it("所选连接统一决定问问、整理和恢复的能力，切换普通模型降回资料范围且失败不留空会话", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-runtime-mode-"));
  const ws = await initWorkspace(join(root, "workspace"));
  const modes: string[] = [];
  let closed = 0;
  let fullOnly = true;
  let configured = true;
  let fail = false;
  const make = () =>
    createAskService({
      state: join(root, "state"),
      workspace: ws.root,
      settings: async () => ({
        configured,
        provider: "synthetic",
        model: "synthetic",
        fullOnly,
        backend: fullOnly ? "local" : "model",
      }),
      configure: async () => ({}),
      models: async () => [],
      runtime: async (mode): Promise<AskRuntime> => {
        modes.push(mode);
        let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
        return {
          onNotification(listener) {
            notify = listener;
            return () => {};
          },
          async request(_method, params) {
            if (fail) throw new Error("Synthetic connection failure");
            notify("session.event", {
              sessionId: params.sessionId,
              event: {
                type: "assistant/message",
                seq: 1,
                data: {
                  message: {
                    content: [
                      { type: "text", text: JSON.stringify({ goal: "散步", current: "", next: "走十分钟" }) },
                    ],
                  },
                },
              },
            });
            notify("session.status", { sessionId: params.sessionId, status: "idle" });
            return {};
          },
          async close() {
            closed++;
          },
        };
      },
    });
  let ask = make();
  const request = (method: string, args: unknown[]) => productRequest(ws, method, args, ask);
  try {
    const existing = await ask.create();
    expect(existing.mode).toBe("full");
    await ask.send(existing.id, "合成真实对话");
    expect((await ask.settings()).mode).toBe("full");
    const matter = (await request("onboardingMatterSave", ["合成：希望周末散步"])) as OnboardingMatter;
    const organized = (await request("onboardingMatterOrganize", [matter.source])) as OnboardingMatter;
    expect(organized.draft?.next).toBe("走十分钟");
    expect(listTasks(ws)).toEqual([]);
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    fail = true;
    await expect(request("onboardingMatterOrganize", [matter.source])).rejects.toBeInstanceOf(Error);
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    fail = false;
    await ask.close();
    fullOnly = false;
    ask = make();
    await ask.send(existing.id, "换普通模型继续原会话");
    expect((await ask.settings()).mode).toBe("scoped");
    expect(ask.list()[0]?.mode).toBe("scoped");
    await request("onboardingMatterOrganize", [matter.source]);
    expect(modes).toEqual(["full", "full", "full", "scoped", "scoped"]);
    const oversized = `${"文".repeat(100000)}\n\n会话引用：合成上一轮的内容`;
    const oversizedEmpty = await ask.create();
    await expect(ask.send(oversizedEmpty.id, oversized)).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    const savedEvents = ask.events(existing.id);
    await expect(ask.send(existing.id, oversized)).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    expect(ask.events(existing.id)).toEqual(savedEvents);
    fail = true;
    const empty = await ask.create();
    await expect(ask.send(empty.id, "失败的首次消息")).rejects.toBeInstanceOf(Error);
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    configured = false;
    await expect(ask.create()).rejects.toBeInstanceOf(Error);
    expect(ask.list().map((row) => row.id)).toEqual([existing.id]);
    configured = true;
    fullOnly = true;
    const phone = ask.background("phone-ask");
    await expect(phone.create()).rejects.toBeInstanceOf(Error);
    await phone.close();
    expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe("合成：希望周末散步");
    expect(closed).toBeGreaterThan(0);
  } finally {
    await ask.close();
    rmSync(root, { recursive: true, force: true });
  }
});
