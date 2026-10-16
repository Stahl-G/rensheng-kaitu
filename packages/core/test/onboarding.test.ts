import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startUi } from "../../cli/src/ui/server.js";
import {
  addMemory,
  addRecord,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  history,
  initWorkspace,
  listMemories,
  onboardingStatus,
  parseFrontmatter,
  parseMemoryPaste,
  previewOnboardingMemory,
  previewOnboardingSetup,
  recordOnboardingAiConnection,
  resetOnboarding,
  restore,
  saveOnboardingChoices,
  stringifyFrontmatter,
  validateWorkspace,
} from "../src/index.js";

it("粘贴解析保留未知与不合格式行，处理列表、时间及已有和批内重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  try {
    const ws = await initWorkspace(join(root, "ws"));
    await addMemory(ws, { type: "preference", name: "language", text: "用中文" });
    const candidates = parseMemoryPaste(
      [
        "- [偏好] 用中文",
        "1. [人物] 小林是同事 (2026-09)",
        "[人物] 小林是同事 (2026-09)",
        "- [健康] 乳糖不耐 （2024）",
        "[没见过的类] 原样内容 (时间不详)",
        "格式没对上，别丢",
        "- 喜欢散步",
        "1. 喜欢散步",
        "",
        "[偏好]",
      ].join("\n"),
      listMemories(ws),
    );
    expect(candidates.map((item) => [item.type, item.text])).toEqual([
      ["person", "小林是同事 (2026-09)"],
      ["context", "乳糖不耐 （2024）"],
      ["context", "[没见过的类] 原样内容 (时间不详)"],
      ["context", "格式没对上，别丢"],
      ["context", "- 喜欢散步"],
      ["context", "[偏好]"],
    ]);
    expect(candidates[0]?.when).toBe("2026-09");
    expect(candidates[0]?.content).toBe("小林是同事");
    expect(candidates[2]?.raw).toBe(true);
    expect(listMemories(ws)).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("本地接口只确认预览中所选的记忆，整批一个版本并能撤销", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const previousState = process.env.KAITU_LOCAL_STATE_DIR;
  process.env.KAITU_LOCAL_STATE_DIR = join(root, "state");
  const ws = await initWorkspace(join(root, "ws"));
  const ui = await startUi(ws, { port: 0, open: false });
  const call = (method: string, args: unknown[], origin = ui.url) =>
    fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: origin },
      body: JSON.stringify(args),
    });
  try {
    const before = await history(ws);
    expect(
      (await call("onboardingMemoryPreview", ["不应写入", "claude"], "https://example.invalid")).status,
    ).toBe(403);
    const preview = await (
      await call("onboardingMemoryPreview", ["[偏好] 简洁\n[人物] 小张\n[工作] 写作", "claude"])
    ).json();
    expect(listMemories(ws)).toHaveLength(0);
    expect(await history(ws)).toEqual(before);
    expect((await call("onboardingMemoryConfirm", [preview.token, ["line-999"]])).status).toBe(400);
    const result = await (
      await call("onboardingMemoryConfirm", [preview.token, ["line-1", "line-2"]])
    ).json();
    expect(result.before).toBe(before[0]?.oid);
    expect(result.version).toBeTruthy();
    expect(
      listMemories(ws)
        .map((entry) => entry.text)
        .sort(),
    ).toEqual(["小张", "简洁"]);
    expect(new Set(listMemories(ws).map((entry) => entry.source))).toEqual(new Set(["从 Claude 搬来"]));
    expect(await history(ws)).toHaveLength(before.length + 1);
    expect((await call("onboardingMemoryConfirm", [preview.token, ["line-1"]])).status).toBe(409);
    const repeated = previewOnboardingMemory(ws, "[偏好] 简洁", "claude");
    expect(repeated.candidates).toEqual([]);
    await confirmOnboardingMemory(ws, repeated.token, []);
    expect(await history(ws)).toHaveLength(before.length + 1);
    await restore(ws, result.before);
    expect(listMemories(ws)).toHaveLength(0);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    await ui.close();
    if (previousState === undefined) Reflect.deleteProperty(process.env, "KAITU_LOCAL_STATE_DIR");
    else process.env.KAITU_LOCAL_STATE_DIR = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});

it("清单随实际数据与恢复变化，本机选择不改配置，已有资料换机不弹引导", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Ho_Chi_Minh" });
    const config = ws.readText(".kaitu/config.json");
    expect(onboardingStatus(ws, options).showGuide).toBe(true);
    await saveOnboardingChoices(
      ws,
      {
        seen: true,
        starts: ["health", "calendar", "projects", "news"],
        skipped: ["health"],
        aiChoice: "none",
      },
      options,
    );
    const before = await history(ws);
    await saveOnboardingChoices(ws, { starts: ["health", "calendar", "projects", "news"] }, options);
    expect(await history(ws)).toEqual(before);
    expect(
      parseFrontmatter<{ next: { id: string }[] }>(ws.readText("health/STATUS.md")).data.next,
    ).toHaveLength(1);
    expect(ws.readText(".kaitu/config.json")).toBe(config);
    const initial = onboardingStatus(ws, options);
    expect(initial.sources.map((source) => source.id)).toEqual(["calendar", "health", "projects", "news"]);
    expect(initial.checklist.completed).toBe(0);
    expect(initial.checklist.items.find((item) => item.id === "health")).toMatchObject({
      done: false,
      skipped: true,
    });
    await addMemory(ws, { type: "fact", name: "home", text: "住在甲城" });
    await addRecord(
      ws,
      "meal",
      {
        ts: "2026-10-16T12:00:00+07:00",
        meal: "午",
        items: [{ name: "午餐" }],
        kcal: 500,
        protein_g: 25,
        source: "synthetic",
      },
      { by: "user" },
    );
    recordOnboardingAiConnection(ws, "synthetic", options);
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter({
        date: "2026-10-16",
        generated_at: "2026-10-16T07:30:00+07:00",
        blocks: [],
        attention: [],
      }),
    );
    const folder = join(root, "project");
    mkdirSync(folder);
    const projectPreview = previewOnboardingSetup(
      ws,
      {
        source: "projects",
        project: { title: "Synthetic project", kind: "work", links: [{ path: folder, role: "folder" }] },
      },
      options,
    );
    const newsPreview = previewOnboardingSetup(ws, { source: "news", keywords: ["合成方向"] }, options);
    expect(onboardingStatus(ws, options).checklist.completed).toBe(4);
    await confirmOnboardingSetup(ws, projectPreview.token, options);
    await confirmOnboardingSetup(ws, newsPreview.token, options);
    expect(onboardingStatus(ws, options).checklist.completed).toBe(6);
    expect(onboardingStatus(ws, { stateRoot: join(root, "another-computer") }).showGuide).toBe(false);
    await restore(ws, before[0]?.oid as string);
    const restored = onboardingStatus(ws, options);
    expect(restored.checklist.items.find((item) => item.id === "memory")?.done).toBe(false);
    expect(restored.checklist.items.find((item) => item.id === "health")?.done).toBe(false);
    expect(restored.checklist.items.find((item) => item.id === "plan")?.done).toBe(false);
    expect(restored.checklist.items.find((item) => item.id === "ai")?.done).toBe(true);
    expect(resetOnboarding(ws, options).showGuide).toBe(false);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
