import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  addGoalNext,
  addMemory,
  addRecord,
  adoptOnboardingMatter,
  changeOnboardingNext,
  confirmOnboardingMemory,
  directionsPrompt,
  handoverPack,
  initWorkspace,
  onboardingStatus,
  parseMatterAnswer,
  pasteDirections,
  pasteOnboardingMatter,
  previewOnboardingMemory,
  readExploration,
  readOverviewPage,
  saveOnboardingMatter,
  validateWorkspace,
} from "../src/index.js";

it("贴回自己 AI 的回答：标签行、英文路径和 JSON 都读成待核对草稿，缺项说明原因", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-clipboard-"));
  const options = { stateRoot: join(root, "state") };
  try {
    expect(
      parseMatterAnswer(
        "好的，整理如下：\n```\n【目标】三个月内转岗做产品\n【现状】做了四年运营，\n还没有作品集\n【下一步】这周写一份产品分析\n```\n祝顺利！",
      ),
    ).toEqual({
      goal: "三个月内转岗做产品",
      current: "做了四年运营， 还没有作品集",
      next: "这周写一份产品分析",
    });
    expect(
      parseMatterAnswer(
        "[Goal] Find work I enjoy\n[Now] Four years in ops, unsure\n[Path] Product | uses ops skills | which domain | shadow a PM for a day\n[Path] Research | likes depth | pay | write one study outline",
        "en",
      ),
    ).toMatchObject({
      goal: "Find work I enjoy",
      next: "",
      paths: [{ name: "Product" }, { name: "Research" }],
    });
    expect(parseMatterAnswer('{"goal":"跑完半马","current":"能跑 5 公里","next":"周六跑 8 公里"}').next).toBe(
      "周六跑 8 公里",
    );
    expect(() => parseMatterAnswer("【现状】只有现状")).toThrow("目标");
    expect(() => parseMatterAnswer("[Goal] x\n[Path] only one part", "en")).toThrow("[Path]");
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const matter = await saveOnboardingMatter(ws, "想每周练三次，但总坚持不了两周。");
    const draft = await pasteOnboardingMatter(
      ws,
      matter.source,
      "【目标】每周稳定练三次\n【现状】最长坚持过两周\n【下一步】周二晚上先练 20 分钟",
      options,
    );
    expect(draft.draft).toMatchObject({ goal: "每周稳定练三次", next: "周二晚上先练 20 分钟" });
    expect(onboardingStatus(ws, options).checklist.items.find((item) => item.id === "ai")?.done).toBe(true);
    const next = await adoptOnboardingMatter(ws, matter.source, draft.draft as never);
    expect(next.goal).toBe("每周稳定练三次");
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("资料包只带目标、结果、下一步和非敏感记忆；方向建议贴回后待采纳且不重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-handover-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const preview = previewOnboardingMemory(
      ws,
      "[目标] 半年内跑完半马\n[偏好] 喜欢早上运动",
      "claude",
      options,
    );
    await confirmOnboardingMemory(ws, preview.token, ["line-1", "line-2"], options);
    await addMemory(ws, { type: "fact", name: "secret", text: "合成敏感事实 X9", sensitive: true });
    await addMemory(ws, { type: "person", name: "friend", text: "朋友小周在杭州" });
    addRecord(
      ws,
      "meal",
      { meal: "午", items: [{ name: "合成午餐 Q7" }], kcal: 500, protein_g: 25, source: "synthetic" },
      { by: "user" },
    );
    const goal = (await readOverviewPage(ws)).plans.goals[0]?.id as string;
    const next = await addGoalNext(ws, goal, "周六跑 8 公里");
    await changeOnboardingNext(ws, next.id, next.rev, "complete", "跑完 8 公里，膝盖没事");
    await addGoalNext(ws, goal, "下周六跑 10 公里");
    const pack = handoverPack(ws, "zh-CN");
    expect(pack.text).toContain("半年内跑完半马（从 Claude 搬来");
    expect(pack.text).toContain("跑完 8 公里，膝盖没事");
    expect(pack.text).toMatch(/） · 下一步：下周六跑 10 公里/);
    expect(pack.text).toContain("喜欢早上运动");
    expect(pack.text).toContain("【目标】");
    for (const hidden of ["合成敏感事实 X9", "合成午餐 Q7", "朋友小周", ws.root])
      expect(pack.text).not.toContain(hidden);
    expect(pack.sections.find((section) => section.id === "people")).toMatchObject({ defaultOn: false });
    expect(handoverPack(ws, "en").text).toContain("Goals I'm working on");
    expect(handoverPack(ws, "en").text).toMatch(/\) · next: 下周六跑 10 公里/);
    expect(directionsPrompt(ws, "zh-CN")).toContain("半年内跑完半马");
    const answer = [
      "【方向】试试越野跑",
      "【为什么适合】喜欢早上运动；越野跑社群 2026 年在增长",
      "【假设】周末一次短途越野会更容易坚持。小实验：这周末跑 5 公里山路，看是否想再去",
      "【还不清楚】附近有没有安全路线",
      "【来源】https://example.org/trail-2026",
      "",
      "【方向】加入跑团",
      "【为什么适合】有人一起更能坚持",
    ].join("\n");
    const first = await pasteDirections(ws, answer, options);
    expect(first.ids).toHaveLength(2);
    const directions = readExploration(ws).directions.filter((item) => first.ids.includes(item.id));
    expect(directions.every((item) => item.status === "suggested")).toBe(true);
    expect(directions.find((item) => item.title === "试试越野跑")?.references).toEqual([
      { kind: "source", ref: "https://example.org/trail-2026" },
    ]);
    expect(await pasteDirections(ws, answer, options)).toEqual({ ids: [], skipped: 2 });
    await expect(pasteDirections(ws, "随便聊聊", options)).rejects.toThrow("方向");
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
